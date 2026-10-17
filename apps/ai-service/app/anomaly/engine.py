"""Rule-based crowd anomaly detection.

Every detector reads the same per-frame `FrameAnalysis` (floor positions, speeds,
headings, dwell times, zone membership) plus a little per-track history kept here.
Each rule needs its condition to *persist* for a minimum time before it fires, and
every alert key has a cooldown, so one incident produces one alert, not one per frame.

Thresholds come from the live `anomaly` settings (operators tune them in the UI);
the durations and radii below are structural and documented where they are defined.

What these rules can and cannot see: they work on trajectories, not on pixels. A
"fight" is inferred from two or more people in close contact moving fast and
erratically, never from recognised violence, and alerts say so in their text.
"""

import math
import uuid
from collections import deque
from dataclasses import dataclass, field

from common.enums import AlertSeverity, AlertType

from app.density.geometry import project_to_floor
from app.detection.types import Detection
from app.pipeline.analysis import FrameAnalysis, PersonObservation
from app.pipeline.context import CameraContext

LOCAL_DENSITY_RADIUS_M = 1.5
"""Neighbourhood used for per-person local density; 1.5 m is ~7 m², enough samples to be stable."""
RUN_SUSTAIN_S = 1.0
PANIC_MIN_RUNNERS = 4
PANIC_RUNNER_SHARE = 0.3
STAMPEDE_MIN_SPEED = 1.4
CONGESTION_SUSTAIN_S = 10.0
RAPID_WINDOW_S = 30.0
RAPID_MIN_RISE = 10
"""Absolute floor: fewer than ten extra people in a view is never a crowd-safety surge."""
RAPID_MIN_RATIO = 1.5
RAPID_SMOOTH_S = 2.0
RAPID_BASELINE_S = 10.0
RAPID_SUSTAIN_S = 5.0
"""Noise spikes pass; a real influx stays. The rise must hold this long before it fires."""
"""Counts are averaged over this many seconds first, so detection flicker and a few
people crossing the frame edge never read as a surge."""
FLOW_MIN_COHERENCE = 0.55
"""Mean resultant length of headings; below this there is no dominant flow to run against."""
COUNTER_FLOW_SUSTAIN_S = 3.0
COUNTER_FLOW_MIN_SPEED = 0.6
STOP_SPEED = 0.35
STOP_MAX_DRIFT_M = 1.0
"""A stopped person is judged by drift from where they stopped, not instantaneous speed:
neighbours brushing past jostle them, which must not reset the timer."""
STOP_FLOW_MIN_MOVERS = 3
STOP_ISOLATION_RADIUS_M = 2.5
STOP_MAX_STILL_NEIGHBOURS = 1
"""Someone standing with a group is gathering, not stalled: only an isolated stopped
person (at most one other still person nearby) counts as abnormal stopping."""
LOITER_MAX_DISPLACEMENT_M = 6.0
GATHER_RADIUS_M = 2.5
GATHER_MIN_PEOPLE = 6
GATHER_MAX_SPEED = 0.5
GATHER_SUSTAIN_S = 25.0
INTRUSION_SUSTAIN_S = 1.0
FIGHT_RADIUS_M = 1.6
FIGHT_MIN_SPEED = 2.0
FIGHT_MIN_TURN_DEG = 70.0
FIGHT_SUSTAIN_S = 2.0
BAG_MATCH_RADIUS_M = 0.8
BAG_OWNER_RADIUS_M = 2.0
"""The person nearest a bag when it first appears (within this radius) is its owner. The bag is
unattended once its owner is farther than this or gone; passers-by never count as attending."""
BAG_UNATTENDED_S = 45.0
BAG_FORGET_S = 10.0

COOLDOWN_S: dict[AlertType, float] = {
    AlertType.RUNNING: 60,
    AlertType.PANIC: 120,
    AlertType.STAMPEDE: 120,
    AlertType.CROWD_CONGESTION: 180,
    AlertType.RAPID_DENSITY_INCREASE: 120,
    AlertType.COUNTER_FLOW: 90,
    AlertType.ABNORMAL_STOPPING: 180,
    AlertType.LOITERING: 300,
    AlertType.SUSPICIOUS_GATHERING: 180,
    AlertType.RESTRICTED_AREA_INTRUSION: 60,
    AlertType.FIGHTING: 120,
    AlertType.ABANDONED_OBJECT: 600,
}


@dataclass
class AnomalyEvent:
    alert_type: AlertType
    severity: AlertSeverity
    confidence: float
    title: str
    description: str
    dedupe_key: str
    map_x: float | None = None
    map_y: float | None = None
    zone_id: uuid.UUID | None = None
    track_ids: list[int] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)


@dataclass
class _TrackState:
    running_since: float | None = None
    stopped_since: float | None = None
    stop_anchor: tuple[float, float] | None = None
    alone_stopped_since: float | None = None
    """Runs only while stopped *and* isolated; time spent standing in a group never counts."""
    counter_since: float | None = None
    restricted_since: float | None = None
    fight_since: float | None = None
    last_heading: float | None = None
    turn_rate: float = 0.0
    positions: deque = field(default_factory=lambda: deque(maxlen=600))


@dataclass
class _Bag:
    id: int
    x: float
    y: float
    first_seen: float
    last_seen: float
    owner_track_id: int | None = None
    unattended_since: float | None = None


def _angle_diff(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


def _centroid(obs: list[PersonObservation]) -> tuple[float, float]:
    return sum(o.map_x for o in obs) / len(obs), sum(o.map_y for o in obs) / len(obs)


class AnomalyEngine:
    def __init__(self, context: CameraContext, settings: dict) -> None:
        self.context = context
        self.settings = settings
        self._tracks: dict[int, _TrackState] = {}
        self._counts: deque[tuple[float, int]] = deque()
        self._smoothed: deque[tuple[float, int]] = deque()
        self._surge_since: float | None = None
        self._congested_since: float | None = None
        self._gather_since: dict[tuple[int, int], float] = {}
        self._bags: list[_Bag] = []
        self._next_bag_id = 1
        self._last_fired: dict[str, float] = {}

    def reset_cooldowns(self) -> None:
        """Forget which alerts were recently raised (keeps all detection history)."""
        self._last_fired.clear()

    # ---- helpers ----------------------------------------------------------------

    def _s(self, key: str, default: float) -> float:
        return float(self.settings.get(key, default))

    def _cooldown_ok(self, event: AnomalyEvent, now: float) -> bool:
        last = self._last_fired.get(event.dedupe_key)
        if last is not None and now - last < COOLDOWN_S.get(event.alert_type, 120):
            return False
        self._last_fired[event.dedupe_key] = now
        return True

    def _zone_label(self, zone_id: uuid.UUID | None) -> str:
        zone = next((z for z in self.context.zones if z.id == zone_id), None)
        return f" in {zone.name}" if zone else ""

    def _zone_at(self, x: float, y: float) -> uuid.UUID | None:
        zone = self.context.zone_at(x, y)
        return zone.id if zone else None

    @staticmethod
    def _local_density(target: PersonObservation, everyone: list[PersonObservation]) -> float:
        r2 = LOCAL_DENSITY_RADIUS_M**2
        n = sum(1 for o in everyone if (o.map_x - target.map_x) ** 2 + (o.map_y - target.map_y) ** 2 <= r2)
        return n / (math.pi * r2)

    # ---- main entry -------------------------------------------------------------

    def evaluate(self, analysis: FrameAnalysis, objects: list[Detection] | None = None) -> list[AnomalyEvent]:
        now = analysis.ts
        obs = analysis.observations
        self._update_tracks(obs, now)

        candidates: list[AnomalyEvent] = []
        candidates += self._running_and_panic(obs, now)
        candidates += self._density_rules(obs, analysis, now)
        candidates += self._counter_flow(obs, now)
        candidates += self._stopping_and_loitering(obs, now)
        candidates += self._gathering(obs, now)
        candidates += self._intrusion(obs, now)
        candidates += self._fighting(obs, now)
        candidates += self._abandoned_objects(objects or [], obs, analysis, now)

        min_conf = self._s("min_confidence", 0.6)
        return [e for e in candidates if e.confidence >= min_conf and self._cooldown_ok(e, now)]

    def _update_tracks(self, obs: list[PersonObservation], now: float) -> None:
        live = set()
        for o in obs:
            tid = o.person.track_id
            live.add(tid)
            st = self._tracks.setdefault(tid, _TrackState())
            st.positions.append((now, o.map_x, o.map_y))
            heading = o.kinematics.direction_deg
            if heading is not None and st.last_heading is not None:
                st.turn_rate = 0.7 * st.turn_rate + 0.3 * _angle_diff(heading, st.last_heading)
            st.last_heading = heading
        for tid in [t for t in self._tracks if t not in live]:
            del self._tracks[tid]

    # ---- detectors --------------------------------------------------------------

    def _running_and_panic(self, obs: list[PersonObservation], now: float) -> list[AnomalyEvent]:
        run_speed = self._s("running_speed_mps", 2.5)
        panic_speed = self._s("panic_speed_mps", 3.5)
        runners: list[PersonObservation] = []
        for o in obs:
            st = self._tracks[o.person.track_id]
            if o.kinematics.speed_mps >= run_speed:
                st.running_since = st.running_since or now
                if now - st.running_since >= RUN_SUSTAIN_S:
                    runners.append(o)
            else:
                st.running_since = None

        events: list[AnomalyEvent] = []
        fast = [o for o in runners if o.kinematics.speed_mps >= panic_speed]
        if len(runners) >= PANIC_MIN_RUNNERS and len(runners) >= PANIC_RUNNER_SHARE * max(len(obs), 1):
            share = len(runners) / max(len(obs), 1)
            cx, cy = _centroid(runners)
            zone_id = self._zone_at(cx, cy)
            severity = AlertSeverity.CRITICAL if len(fast) >= PANIC_MIN_RUNNERS else AlertSeverity.HIGH
            events.append(
                AnomalyEvent(
                    alert_type=AlertType.PANIC,
                    severity=severity,
                    confidence=min(0.99, 0.6 + 0.4 * share + 0.05 * len(fast)),
                    title=f"Possible panic{self._zone_label(zone_id)}",
                    description=(
                        f"{len(runners)} of {len(obs)} people in view are running "
                        f"(fastest {max(o.kinematics.speed_mps for o in runners):.1f} m/s)."
                    ),
                    dedupe_key="panic",
                    map_x=cx,
                    map_y=cy,
                    zone_id=zone_id,
                    track_ids=[o.person.track_id for o in runners],
                    metadata={"runners": len(runners), "people": len(obs), "share": round(share, 2)},
                )
            )
        elif runners:
            o = max(runners, key=lambda r: r.kinematics.speed_mps)
            zone_id = self._zone_at(o.map_x, o.map_y)
            events.append(
                AnomalyEvent(
                    alert_type=AlertType.RUNNING,
                    severity=AlertSeverity.MEDIUM if len(runners) > 1 else AlertSeverity.LOW,
                    confidence=min(0.95, 0.6 + 0.08 * (o.kinematics.speed_mps - run_speed) + 0.05 * len(runners)),
                    title=f"Running detected{self._zone_label(zone_id)}",
                    description=f"{len(runners)} running, fastest at {o.kinematics.speed_mps:.1f} m/s.",
                    dedupe_key="running",
                    map_x=o.map_x,
                    map_y=o.map_y,
                    zone_id=zone_id,
                    track_ids=[r.person.track_id for r in runners],
                    metadata={"speed_mps": round(o.kinematics.speed_mps, 2)},
                )
            )
        return events

    def _density_rules(self, obs: list[PersonObservation], analysis: FrameAnalysis, now: float) -> list[AnomalyEvent]:
        events: list[AnomalyEvent] = []
        self._counts.append((now, len(obs)))
        while self._counts and now - self._counts[0][0] > RAPID_WINDOW_S:
            self._counts.popleft()

        # Rapid increase: the smoothed head count rose sharply above the window's low.
        recent = [c for t, c in self._counts if now - t <= RAPID_SMOOTH_S]
        current = round(sum(recent) / len(recent)) if recent else len(obs)
        self._smoothed.append((now, current))
        while self._smoothed and now - self._smoothed[0][0] > RAPID_WINDOW_S:
            self._smoothed.popleft()
        # Baseline: the mean of the window's oldest RAPID_BASELINE_S, not its minimum (the
        # minimum of a noisy count is biased low). A rise must clear ~3 sigma of Poisson
        # noise (3 * sqrt(baseline)) as well as the absolute and relative floors.
        start = self._smoothed[0][0] if self._smoothed else now
        early = [c for t, c in self._smoothed if t <= start + RAPID_BASELINE_S]
        if early and now - start >= RAPID_BASELINE_S + RAPID_SMOOTH_S:
            low = round(sum(early) / len(early))
            rise = current - low
            surging = rise >= max(RAPID_MIN_RISE, 3 * math.sqrt(max(low, 1))) and current >= RAPID_MIN_RATIO * max(low, 1)
            self._surge_since = (self._surge_since or now) if surging else None
            if surging and now - self._surge_since >= RAPID_SUSTAIN_S:
                cx, cy = _centroid(obs) if obs else (None, None)
                events.append(
                    AnomalyEvent(
                        alert_type=AlertType.RAPID_DENSITY_INCREASE,
                        severity=AlertSeverity.HIGH if rise >= 2 * RAPID_MIN_RISE else AlertSeverity.MEDIUM,
                        confidence=min(0.97, 0.62 + 0.02 * rise),
                        title="Rapid rise in crowd density",
                        description=f"People in view went from {low} to {current} within {int(RAPID_WINDOW_S)} s.",
                        dedupe_key="rapid",
                        map_x=cx,
                        map_y=cy,
                        metadata={"from": low, "to": current, "window_s": RAPID_WINDOW_S},
                    )
                )

        # Congestion and stampede use local density around each person.
        if not obs:
            self._congested_since = None
            return events
        congestion = self._s("congestion_density_per_sqm", 4.0)
        stampede = self._s("stampede_density_per_sqm", 6.0)
        local = [(o, self._local_density(o, obs)) for o in obs]
        peak_obs, peak = max(local, key=lambda t: t[1])
        zone_id = self._zone_at(peak_obs.map_x, peak_obs.map_y)

        crowded = [o for o, d in local if d >= stampede]
        moving_crowded = [o for o in crowded if o.kinematics.speed_mps >= STAMPEDE_MIN_SPEED]
        if len(moving_crowded) >= 4:
            cx, cy = _centroid(moving_crowded)
            events.append(
                AnomalyEvent(
                    alert_type=AlertType.STAMPEDE,
                    severity=AlertSeverity.CRITICAL,
                    confidence=min(0.98, 0.7 + 0.03 * len(moving_crowded)),
                    title=f"Stampede risk{self._zone_label(zone_id)}",
                    description=(
                        f"{len(moving_crowded)} people moving at speed through {peak:.1f} people/m²."
                    ),
                    dedupe_key=f"stampede:{zone_id}",
                    map_x=cx,
                    map_y=cy,
                    zone_id=zone_id,
                    track_ids=[o.person.track_id for o in moving_crowded],
                    metadata={"local_density": round(peak, 2)},
                )
            )

        over_capacity = [
            z for z in self.context.zones
            if z.capacity_threshold and analysis.zone_counts.get(z.id, 0) > z.capacity_threshold
        ]
        if peak >= congestion or over_capacity:
            self._congested_since = self._congested_since or now
            if now - self._congested_since >= CONGESTION_SUSTAIN_S:
                if over_capacity:
                    z = over_capacity[0]
                    count = analysis.zone_counts.get(z.id, 0)
                    cx, cy = z.centroid
                    desc = f"{count} people in {z.name}, above its capacity of {z.capacity_threshold}."
                    key, zid = f"congestion:{z.id}", z.id
                else:
                    cx, cy, zid = peak_obs.map_x, peak_obs.map_y, zone_id
                    desc = f"Local density has held at {peak:.1f} people/m² for {int(now - self._congested_since)} s."
                    key = f"congestion:{zone_id}"
                events.append(
                    AnomalyEvent(
                        alert_type=AlertType.CROWD_CONGESTION,
                        severity=AlertSeverity.CRITICAL if peak >= stampede else AlertSeverity.HIGH,
                        confidence=min(0.97, 0.7 + 0.05 * max(peak - congestion, 0) + (0.1 if over_capacity else 0)),
                        title=f"Crowd congestion{self._zone_label(zid)}",
                        description=desc,
                        dedupe_key=key,
                        map_x=cx,
                        map_y=cy,
                        zone_id=zid,
                        metadata={"local_density": round(peak, 2)},
                    )
                )
        else:
            self._congested_since = None
        return events

    def _counter_flow(self, obs: list[PersonObservation], now: float) -> list[AnomalyEvent]:
        movers = [o for o in obs if o.kinematics.speed_mps >= COUNTER_FLOW_MIN_SPEED and o.kinematics.direction_deg is not None]
        if len(movers) < 5:
            for st in self._tracks.values():
                st.counter_since = None
            return []
        sx = sum(math.cos(math.radians(o.kinematics.direction_deg)) for o in movers)
        sy = sum(math.sin(math.radians(o.kinematics.direction_deg)) for o in movers)
        coherence = math.hypot(sx, sy) / len(movers)
        if coherence < FLOW_MIN_COHERENCE:
            return []
        flow = math.degrees(math.atan2(sy, sx)) % 360
        limit = self._s("counter_flow_angle_deg", 135)

        offenders = []
        for o in movers:
            st = self._tracks[o.person.track_id]
            if _angle_diff(o.kinematics.direction_deg, flow) >= limit:
                st.counter_since = st.counter_since or now
                if now - st.counter_since >= COUNTER_FLOW_SUSTAIN_S:
                    offenders.append(o)
            else:
                st.counter_since = None
        if not offenders:
            return []
        o = offenders[0]
        zone_id = self._zone_at(o.map_x, o.map_y)
        return [
            AnomalyEvent(
                alert_type=AlertType.COUNTER_FLOW,
                severity=AlertSeverity.MEDIUM,
                confidence=min(0.95, 0.55 + 0.4 * coherence),
                title=f"Counter-flow movement{self._zone_label(zone_id)}",
                description=(
                    f"{len(offenders)} moving against a flow of {len(movers)} people "
                    f"(flow heading {flow:.0f}°, coherence {coherence:.2f})."
                ),
                dedupe_key=f"counter:{zone_id}",
                map_x=o.map_x,
                map_y=o.map_y,
                zone_id=zone_id,
                track_ids=[x.person.track_id for x in offenders],
                metadata={"flow_deg": round(flow), "coherence": round(coherence, 2)},
            )
        ]

    def _stopping_and_loitering(self, obs: list[PersonObservation], now: float) -> list[AnomalyEvent]:
        events: list[AnomalyEvent] = []
        stop_after = self._s("abnormal_stop_s", 60)
        loiter_after = self._s("loitering_dwell_s", 120)
        movers = sum(1 for o in obs if o.kinematics.speed_mps >= COUNTER_FLOW_MIN_SPEED)
        iso_r2 = STOP_ISOLATION_RADIUS_M**2
        # Update every track's stopped state first, so neighbours are judged consistently.
        for o in obs:
            st = self._tracks[o.person.track_id]
            if st.stopped_since is None:
                if o.kinematics.speed_mps < STOP_SPEED:
                    st.stopped_since, st.stop_anchor = now, (o.map_x, o.map_y)
            elif math.hypot(o.map_x - st.stop_anchor[0], o.map_y - st.stop_anchor[1]) > STOP_MAX_DRIFT_M:
                st.stopped_since, st.stop_anchor = None, None
        # Jostled group members can briefly exceed STOP_SPEED; stopped state or slow speed counts.
        still = [
            o for o in obs
            if self._tracks[o.person.track_id].stopped_since is not None or o.kinematics.speed_mps < GATHER_MAX_SPEED
        ]
        for o in obs:
            st = self._tracks[o.person.track_id]

            zone_id = self._zone_at(o.map_x, o.map_y)
            still_neighbours = sum(
                1 for s in still if s is not o and (s.map_x - o.map_x) ** 2 + (s.map_y - o.map_y) ** 2 <= iso_r2
            )
            if st.stopped_since is not None and still_neighbours <= STOP_MAX_STILL_NEIGHBOURS:
                st.alone_stopped_since = st.alone_stopped_since or now
            else:
                st.alone_stopped_since = None
            if (
                st.alone_stopped_since is not None
                and now - st.alone_stopped_since >= stop_after
                and movers >= STOP_FLOW_MIN_MOVERS
            ):
                events.append(
                    AnomalyEvent(
                        alert_type=AlertType.ABNORMAL_STOPPING,
                        severity=AlertSeverity.MEDIUM,
                        confidence=min(0.9, 0.6 + 0.002 * (now - st.alone_stopped_since)),
                        title=f"Person stopped in a moving crowd{self._zone_label(zone_id)}",
                        description=(
                            f"Track #{o.person.track_id} has not moved for {int(now - st.alone_stopped_since)} s "
                            f"while {movers} people move around them. They may need assistance."
                        ),
                        dedupe_key=f"stop:{zone_id}",
                        map_x=o.map_x,
                        map_y=o.map_y,
                        zone_id=zone_id,
                        track_ids=[o.person.track_id],
                    )
                )

            dwell = o.kinematics.dwell_time_s
            if dwell >= loiter_after and len(st.positions) > 2:
                xs = [p[1] for p in st.positions]
                ys = [p[2] for p in st.positions]
                spread = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
                if spread <= LOITER_MAX_DISPLACEMENT_M:
                    events.append(
                        AnomalyEvent(
                            alert_type=AlertType.LOITERING,
                            severity=AlertSeverity.LOW,
                            confidence=min(0.9, 0.6 + 0.001 * (dwell - loiter_after) + 0.03 * (LOITER_MAX_DISPLACEMENT_M - spread)),
                            title=f"Loitering{self._zone_label(zone_id)}",
                            description=f"Track #{o.person.track_id} has stayed within {spread:.1f} m for {int(dwell)} s.",
                            dedupe_key=f"loiter:{zone_id}",
                            map_x=o.map_x,
                            map_y=o.map_y,
                            zone_id=zone_id,
                            track_ids=[o.person.track_id],
                            metadata={"dwell_s": int(dwell), "spread_m": round(spread, 1)},
                        )
                    )
        return events

    def _gathering(self, obs: list[PersonObservation], now: float) -> list[AnomalyEvent]:
        still = [o for o in obs if o.kinematics.speed_mps <= GATHER_MAX_SPEED]
        events: list[AnomalyEvent] = []
        seen_cells: set[tuple[int, int]] = set()
        r2 = GATHER_RADIUS_M**2
        for o in still:
            group = [g for g in still if (g.map_x - o.map_x) ** 2 + (g.map_y - o.map_y) ** 2 <= r2]
            if len(group) < GATHER_MIN_PEOPLE:
                continue
            cx, cy = _centroid(group)
            cell = (int(cx // (GATHER_RADIUS_M * 2)), int(cy // (GATHER_RADIUS_M * 2)))
            if cell in seen_cells:
                continue
            seen_cells.add(cell)
            since = self._gather_since.setdefault(cell, now)
            if now - since >= GATHER_SUSTAIN_S:
                zone_id = self._zone_at(cx, cy)
                events.append(
                    AnomalyEvent(
                        alert_type=AlertType.SUSPICIOUS_GATHERING,
                        severity=AlertSeverity.MEDIUM,
                        confidence=min(0.92, 0.6 + 0.04 * len(group)),
                        title=f"Group gathering{self._zone_label(zone_id)}",
                        description=f"{len(group)} people have stood together within {GATHER_RADIUS_M} m for {int(now - since)} s.",
                        dedupe_key=f"gather:{cell}",
                        map_x=cx,
                        map_y=cy,
                        zone_id=zone_id,
                        track_ids=[g.person.track_id for g in group],
                        metadata={"size": len(group)},
                    )
                )
        self._gather_since = {c: t for c, t in self._gather_since.items() if c in seen_cells}
        return events

    def _intrusion(self, obs: list[PersonObservation], now: float) -> list[AnomalyEvent]:
        events: list[AnomalyEvent] = []
        for o in obs:
            st = self._tracks[o.person.track_id]
            if o.zone is not None and o.zone.is_restricted:
                st.restricted_since = st.restricted_since or now
                if now - st.restricted_since >= INTRUSION_SUSTAIN_S:
                    events.append(
                        AnomalyEvent(
                            alert_type=AlertType.RESTRICTED_AREA_INTRUSION,
                            severity=AlertSeverity.HIGH,
                            confidence=min(0.97, 0.8 + 0.15 * o.person.confidence),
                            title=f"Restricted area entered: {o.zone.name}",
                            description=f"Track #{o.person.track_id} entered {o.zone.name}.",
                            dedupe_key=f"intrusion:{o.zone.id}",
                            map_x=o.map_x,
                            map_y=o.map_y,
                            zone_id=o.zone.id,
                            track_ids=[o.person.track_id],
                        )
                    )
            else:
                st.restricted_since = None
        return events

    def _fighting(self, obs: list[PersonObservation], now: float) -> list[AnomalyEvent]:
        agitated = [
            o for o in obs
            if o.kinematics.speed_mps >= FIGHT_MIN_SPEED and self._tracks[o.person.track_id].turn_rate >= FIGHT_MIN_TURN_DEG
        ]
        r2 = FIGHT_RADIUS_M**2
        involved: list[PersonObservation] = []
        for o in agitated:
            if any(p is not o and (p.map_x - o.map_x) ** 2 + (p.map_y - o.map_y) ** 2 <= r2 for p in agitated):
                involved.append(o)
        active = {o.person.track_id for o in involved}
        for tid, st in self._tracks.items():
            if tid in active:
                st.fight_since = st.fight_since or now
            else:
                st.fight_since = None
        sustained = [o for o in involved if now - (self._tracks[o.person.track_id].fight_since or now) >= FIGHT_SUSTAIN_S]
        if len(sustained) < 2:
            return []
        cx, cy = _centroid(sustained)
        zone_id = self._zone_at(cx, cy)
        return [
            AnomalyEvent(
                alert_type=AlertType.FIGHTING,
                severity=AlertSeverity.HIGH,
                confidence=min(0.9, 0.6 + 0.08 * len(sustained)),
                title=f"Possible altercation{self._zone_label(zone_id)}",
                description=(
                    f"{len(sustained)} people in close contact moving fast and erratically. "
                    "Inferred from motion only: verify on camera before responding."
                ),
                dedupe_key=f"fight:{zone_id}",
                map_x=cx,
                map_y=cy,
                zone_id=zone_id,
                track_ids=[o.person.track_id for o in sustained],
            )
        ]

    def _abandoned_objects(
        self, objects: list[Detection], obs: list[PersonObservation], analysis: FrameAnalysis, now: float
    ) -> list[AnomalyEvent]:
        geometry = self.context.geometry
        for det in objects:
            x, y = project_to_floor(geometry, (det.x1, det.y1, det.x2, det.y2), analysis.frame_width, analysis.frame_height)
            match = min(
                (b for b in self._bags if math.hypot(b.x - x, b.y - y) <= BAG_MATCH_RADIUS_M),
                key=lambda b: math.hypot(b.x - x, b.y - y),
                default=None,
            )
            if match is None:
                owner = min(
                    (o for o in obs if math.hypot(o.map_x - x, o.map_y - y) <= BAG_OWNER_RADIUS_M),
                    key=lambda o: math.hypot(o.map_x - x, o.map_y - y),
                    default=None,
                )
                self._bags.append(
                    _Bag(id=self._next_bag_id, x=x, y=y, first_seen=now, last_seen=now,
                         owner_track_id=owner.person.track_id if owner else None)
                )
                self._next_bag_id += 1
            else:
                match.x, match.y, match.last_seen = 0.8 * match.x + 0.2 * x, 0.8 * match.y + 0.2 * y, now
        self._bags = [b for b in self._bags if now - b.last_seen <= BAG_FORGET_S]

        events: list[AnomalyEvent] = []
        r2 = BAG_OWNER_RADIUS_M**2
        by_id = {o.person.track_id: o for o in obs}
        for bag in self._bags:
            owner = by_id.get(bag.owner_track_id) if bag.owner_track_id is not None else None
            attended = owner is not None and (owner.map_x - bag.x) ** 2 + (owner.map_y - bag.y) ** 2 <= r2
            if attended:
                bag.unattended_since = None
                continue
            bag.unattended_since = bag.unattended_since or now
            alone = now - bag.unattended_since
            if alone >= BAG_UNATTENDED_S:
                zone_id = self._zone_at(bag.x, bag.y)
                events.append(
                    AnomalyEvent(
                        alert_type=AlertType.ABANDONED_OBJECT,
                        severity=AlertSeverity.HIGH,
                        confidence=min(0.93, 0.65 + 0.003 * alone),
                        title=f"Unattended bag{self._zone_label(zone_id)}",
                        description=(
                            f"A bag has been left for {int(alone)} s; the person who set it down "
                            f"is no longer within {BAG_OWNER_RADIUS_M:.0f} m."
                        ),
                        dedupe_key=f"bag:{bag.id}",
                        map_x=bag.x,
                        map_y=bag.y,
                        zone_id=zone_id,
                        metadata={"unattended_s": int(alone)},
                    )
                )
        return events
