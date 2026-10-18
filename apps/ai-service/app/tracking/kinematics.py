"""Per-track motion state: speed, direction, and dwell time, computed incrementally
as each frame's tracker output arrives. State lives in-process per camera worker,
keyed by the local DeepSORT track_id — cheap, and naturally garbage collected when
a worker drops a stale track (see CameraWorker._prune_stale_tracks).
"""

import math
from dataclasses import dataclass, field


@dataclass
class TrackKinematics:
    first_seen_at: float
    last_seen_at: float
    last_map_x: float
    last_map_y: float
    speed_mps: float = 0.0
    direction_deg: float | None = None
    _speed_ema_alpha: float = field(default=0.4, repr=False)

    @property
    def dwell_time_s(self) -> float:
        return max(0.0, self.last_seen_at - self.first_seen_at)

    def update(self, ts: float, map_x: float, map_y: float) -> None:
        dt = ts - self.last_seen_at
        if dt > 1e-3:
            dx = map_x - self.last_map_x
            dy = map_y - self.last_map_y
            distance = math.hypot(dx, dy)
            instant_speed = distance / dt
            # Smooth so a single noisy detection doesn't spike the reported speed.
            self.speed_mps = (
                self._speed_ema_alpha * instant_speed + (1 - self._speed_ema_alpha) * self.speed_mps
            )
            if distance > 0.05:  # ignore direction updates from sub-5cm jitter
                self.direction_deg = math.degrees(math.atan2(dy, dx)) % 360
        self.last_seen_at = ts
        self.last_map_x = map_x
        self.last_map_y = map_y


class KinematicsTracker:
    """Owns TrackKinematics for every currently-active local track_id on one camera."""

    def __init__(self) -> None:
        self._states: dict[int, TrackKinematics] = {}

    def update(self, track_id: int, ts: float, map_x: float, map_y: float) -> TrackKinematics:
        state = self._states.get(track_id)
        if state is None:
            state = TrackKinematics(
                first_seen_at=ts, last_seen_at=ts, last_map_x=map_x, last_map_y=map_y
            )
            self._states[track_id] = state
        else:
            state.update(ts, map_x, map_y)
        return state

    def drop_stale(self, active_track_ids: set[int], now: float, max_age_s: float = 30.0) -> None:
        stale = [
            tid
            for tid, state in self._states.items()
            if tid not in active_track_ids and (now - state.last_seen_at) > max_age_s
        ]
        for tid in stale:
            del self._states[tid]
