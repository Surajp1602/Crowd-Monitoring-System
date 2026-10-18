"""Synthetic crowd for `simulated` cameras.

An agent-based model on the floor plane inside the camera's field of view. Agents walk
between the edges of the view along a dominant flow direction, keep personal space,
and population rises and falls on a slow cycle so analytics have a realistic shape.
On a timer the simulator stages incidents (a rush, a panic, a gathering, a loiterer,
an intrusion into a restricted zone, an abandoned bag, ...) so every downstream stage
- heatmap, anomaly detection, alerts, notifications - can be exercised end to end on a
laptop with no camera and no GPU.

Agents are rendered into a frame through `floor_to_image`, the exact inverse of the
pipeline's projection, and handed to the pipeline as ground-truth tracks. Everything
after detection and tracking runs exactly as it does for a real camera.

Per-camera options live under `Camera.config["simulation"]`:
    base_people (8), peak_people (28), cycle_s (600), fps (8),
    incident_every_s (75), incidents (all kinds), seed (derived from the camera id)
"""

import math
import random
import time
import zlib
from dataclasses import dataclass, field

import cv2
import numpy as np

from app.capture.source import Frame
from app.density.geometry import CameraGeometry, floor_to_image
from app.detection.types import Detection
from app.tracking.types import TrackedPerson

FRAME_WIDTH = 640
"""Matches the preview width, so simulated frames never need a resize before encoding."""
FRAME_HEIGHT = 360

WALK_SPEED = (0.9, 1.5)
RUN_SPEED = (3.2, 4.5)
PERSONAL_SPACE_M = 0.6
TRANSIT_S = 16.0
"""Rough time a walker takes to cross a camera's view; sets the steady arrival rate."""
CATCH_UP_S = 25.0

INCIDENT_KINDS = (
    "rush",
    "panic",
    "gathering",
    "loiter",
    "stop",
    "counter_flow",
    "surge",
    "intrusion",
    "abandoned_bag",
    "fight",
)


@dataclass
class Agent:
    id: int
    x: float
    y: float
    goal: tuple[float, float]
    speed: float
    mode: str = "walk"
    """walk | run | hold (stand near a point) | wander (small random walk) | fight."""
    mode_until: float = 0.0
    anchor: tuple[float, float] | None = None
    confidence: float = 0.9
    vx: float = 0.0
    vy: float = 0.0


@dataclass
class Bag:
    id: int
    x: float
    y: float
    expires_at: float


@dataclass
class SimulationConfig:
    base_people: int = 8
    peak_people: int = 28
    cycle_s: float = 600.0
    fps: float = 8.0
    incident_every_s: float = 75.0
    incidents: tuple[str, ...] = INCIDENT_KINDS
    seed: int = 0

    @classmethod
    def from_camera_config(cls, config: dict | None, camera_id: str) -> "SimulationConfig":
        raw = dict((config or {}).get("simulation") or {})
        incidents = tuple(k for k in raw.get("incidents", INCIDENT_KINDS) if k in INCIDENT_KINDS)
        return cls(
            base_people=int(raw.get("base_people", cls.base_people)),
            peak_people=int(raw.get("peak_people", cls.peak_people)),
            cycle_s=float(raw.get("cycle_s", cls.cycle_s)),
            fps=float(raw.get("fps", cls.fps)),
            incident_every_s=float(raw.get("incident_every_s", cls.incident_every_s)),
            incidents=incidents,
            seed=int(raw.get("seed", zlib.crc32(camera_id.encode()))),
        )


@dataclass
class CrowdSimulator:
    geometry: CameraGeometry
    config: SimulationConfig
    restricted_points: list[tuple[float, float]] = field(default_factory=list)
    """Centroids of restricted zones on this camera's floor; intrusion incidents walk there."""

    def __post_init__(self) -> None:
        self.restricted_points = [p for p in self.restricted_points if self._visible(*p)]
        self.rng = random.Random(self.config.seed)
        self.agents: list[Agent] = []
        self.bags: list[Bag] = []
        self._next_id = 1
        self._started_at: float | None = None
        self._last_step_at: float | None = None
        self._next_incident_at = 0.0
        self._background: np.ndarray | None = None
        self.last_incident: str | None = None

    # ---- geometry helpers -------------------------------------------------------

    def _point(self, angle_frac: float, range_frac: float) -> tuple[float, float]:
        """A floor point at a fraction of the camera's FOV (-0.5..0.5) and range (0..1)."""
        g = self.geometry
        angle = math.radians(g.orientation_deg + angle_frac * g.fov_deg)
        r = g.range_m * range_frac
        return g.map_x + r * math.cos(angle), g.map_y + r * math.sin(angle)

    def _random_inside(self, margin: float = 0.1) -> tuple[float, float]:
        return self._point(
            self.rng.uniform(-0.5 + margin, 0.5 - margin), self.rng.uniform(0.25, 0.9)
        )

    def _flow_endpoints(self, reverse: bool = False) -> tuple[tuple[float, float], tuple[float, float]]:
        """Dominant flow crosses the view from the left edge to the right edge."""
        start = self._point(-0.47, self.rng.uniform(0.3, 0.9))
        goal = self._point(0.47, self.rng.uniform(0.3, 0.9))
        return (goal, start) if reverse else (start, goal)

    def _visible(self, x: float, y: float) -> bool:
        return floor_to_image(self.geometry, x, y, FRAME_WIDTH, FRAME_HEIGHT) is not None

    # ---- population -------------------------------------------------------------

    def _spawn(self, now: float, *, reverse: bool = False, at: tuple[float, float] | None = None) -> Agent:
        start, goal = self._flow_endpoints(reverse)
        if at is not None:
            start = at
        agent = Agent(
            id=self._next_id,
            x=start[0],
            y=start[1],
            goal=goal,
            speed=self.rng.uniform(*WALK_SPEED),
            confidence=self.rng.uniform(0.72, 0.96),
        )
        self._next_id += 1
        self.agents.append(agent)
        return agent

    def target_population(self, now: float) -> int:
        cfg = self.config
        elapsed = now - (self._started_at or now)
        phase = 0.5 - 0.5 * math.cos(2 * math.pi * elapsed / max(cfg.cycle_s, 1.0))
        return round(cfg.base_people + (cfg.peak_people - cfg.base_people) * phase)

    # ---- incidents --------------------------------------------------------------

    def _pick(self, n: int) -> list[Agent]:
        walkers = [a for a in self.agents if a.mode == "walk"]
        self.rng.shuffle(walkers)
        return walkers[:n]

    def _stage_incident(self, now: float) -> None:
        kinds = list(self.config.incidents)
        if not kinds:
            return
        kind = self.rng.choice(kinds)
        if kind == "intrusion" and not self.restricted_points:
            kind = "loiter"
        self.last_incident = kind

        if kind == "rush":
            heading = self._point(0.4, 0.95)
            for agent in self._pick(self.rng.randint(4, 7)):
                agent.mode, agent.mode_until = "run", now + 8
                agent.goal, agent.speed = heading, self.rng.uniform(*RUN_SPEED)
        elif kind == "panic":
            origin = self._random_inside(0.2)
            for _ in range(6):
                self._spawn(now, at=self._random_inside())
            for agent in self.agents:
                dx, dy = agent.x - origin[0], agent.y - origin[1]
                norm = math.hypot(dx, dy) or 1.0
                agent.mode, agent.mode_until = "run", now + 10
                agent.goal = (agent.x + dx / norm * 12, agent.y + dy / norm * 12)
                agent.speed = self.rng.uniform(3.6, 5.0)
        elif kind == "gathering":
            point = self._random_inside(0.2)
            for agent in self._pick(self.rng.randint(7, 10)):
                agent.mode, agent.mode_until, agent.anchor = "hold", now + 90, point
        elif kind == "loiter":
            # Anchored well inside the view so the loiterer is never jostled out of frame.
            agent = (self._pick(1) or [self._spawn(now)])[0]
            agent.mode, agent.mode_until, agent.anchor = "wander", now + 170, self._random_inside(0.2)
        elif kind == "stop":
            agent = (self._pick(1) or [self._spawn(now)])[0]
            agent.mode, agent.mode_until, agent.anchor = "hold", now + 80, self._random_inside(0.2)
        elif kind == "counter_flow":
            for _ in range(2):
                agent = self._spawn(now, reverse=True)
                agent.speed = self.rng.uniform(1.3, 1.8)
        elif kind == "surge":
            for _ in range(self.rng.randint(18, 26)):
                self._spawn(now, at=self._random_inside(0.15))
        elif kind == "intrusion":
            target = self.rng.choice(self.restricted_points)
            agent = self._spawn(now)
            agent.goal, agent.mode, agent.mode_until, agent.anchor = target, "hold", now + 45, target
        elif kind == "abandoned_bag":
            agent = (self._pick(1) or [self._spawn(now)])[0]
            self.bags.append(Bag(id=self._next_id, x=agent.x, y=agent.y, expires_at=now + 120))
            self._next_id += 1
        elif kind == "fight":
            center = self._random_inside(0.2)
            for agent in self._pick(2):
                agent.mode, agent.mode_until, agent.anchor = "fight", now + 12, center
                agent.speed = 3.0

    # ---- motion -----------------------------------------------------------------

    def _desired_velocity(self, agent: Agent, now: float) -> tuple[float, float]:
        if agent.mode in ("hold", "wander", "fight") and agent.anchor is not None:
            ax, ay = agent.anchor
            if agent.mode == "fight":
                # Erratic lunges around a shared point: high speed, constant direction changes.
                ax += self.rng.uniform(-0.8, 0.8)
                ay += self.rng.uniform(-0.8, 0.8)
            elif agent.mode == "wander":
                ax += 1.5 * math.sin(now / 9 + agent.id)
                ay += 1.5 * math.cos(now / 11 + agent.id)
            dx, dy = ax - agent.x, ay - agent.y
            dist = math.hypot(dx, dy)
            if dist < 0.15 and agent.mode == "hold":
                return 0.0, 0.0
            speed = agent.speed if agent.mode == "fight" else min(agent.speed, 0.5 + dist)
            if agent.mode == "wander":
                speed = 0.35
            return dx / (dist or 1) * speed, dy / (dist or 1) * speed

        dx, dy = agent.goal[0] - agent.x, agent.goal[1] - agent.y
        dist = math.hypot(dx, dy) or 1.0
        return dx / dist * agent.speed, dy / dist * agent.speed

    def step(self, now: float) -> None:
        if self._started_at is None:
            self._started_at = now
            self._last_step_at = now
            self._next_incident_at = now + self.config.incident_every_s * 0.5
            for _ in range(self.config.base_people):
                self._spawn(now, at=self._random_inside(0.05))
        dt = min(0.5, max(0.0, now - (self._last_step_at or now)))
        self._last_step_at = now

        if now >= self._next_incident_at:
            self._stage_incident(now)
            jitter = self.rng.uniform(0.7, 1.3)
            self._next_incident_at = now + self.config.incident_every_s * jitter

        # Arrivals are a Poisson process: at equilibrium target/TRANSIT_S people enter per
        # second (each crosses the view in roughly TRANSIT_S), plus a gentle correction
        # toward the target. Bursty catch-up spawning would look like a surge to detectors.
        target = self.target_population(now)
        walkers = sum(1 for a in self.agents if a.mode == "walk")
        rate = target / TRANSIT_S + max(0, target - walkers) / CATCH_UP_S
        if walkers > 1.2 * target:
            rate *= 0.5
        if self.rng.random() < 1 - math.exp(-rate * dt):
            self._spawn(now)

        for agent in self.agents:
            if agent.mode != "walk" and now >= agent.mode_until:
                agent.mode, agent.anchor = "walk", None
                agent.speed = self.rng.uniform(*WALK_SPEED)
                _, agent.goal = self._flow_endpoints()

            dvx, dvy = self._desired_velocity(agent, now)
            # Separation: push away from neighbours inside personal space.
            px = py = 0.0
            for other in self.agents:
                if other is agent:
                    continue
                ox, oy = agent.x - other.x, agent.y - other.y
                d = math.hypot(ox, oy)
                if 0 < d < PERSONAL_SPACE_M and agent.mode != "fight":
                    push = (PERSONAL_SPACE_M - d) / PERSONAL_SPACE_M
                    px += ox / d * push * 0.8
                    py += oy / d * push * 0.8
            vx, vy = dvx + px, dvy + py
            # Walking into someone: sidestep instead of pressing against them, so a walker
            # never pins itself against a standing group (people walk around obstacles).
            desired = math.hypot(dvx, dvy)
            if agent.mode in ("walk", "run") and desired > 0 and px * dvx + py * dvy < 0:
                side = 1.0 if agent.id % 2 else -1.0
                strength = math.hypot(px, py) * 1.5
                vx += -dvy / desired * strength * side
                vy += dvx / desired * strength * side
            agent.vx, agent.vy = vx, vy
            agent.x += vx * dt
            agent.y += vy * dt

        # Walkers leave once they reach their goal; anyone who drifts out of view is gone.
        self.agents = [
            a
            for a in self.agents
            if self._visible(a.x, a.y)
            and not (a.mode in ("walk", "run") and math.hypot(a.goal[0] - a.x, a.goal[1] - a.y) < 0.6)
        ]
        self.bags = [b for b in self.bags if b.expires_at > now]

    # ---- rendering --------------------------------------------------------------

    @staticmethod
    def _box_size(distance_m: float) -> tuple[float, float]:
        height = FRAME_HEIGHT * 0.55 / (1.0 + distance_m * 0.18)
        return height * 0.38, height

    def observe(self) -> tuple[list[TrackedPerson], list[Detection]]:
        people: list[TrackedPerson] = []
        for agent in self.agents:
            pixel = floor_to_image(self.geometry, agent.x, agent.y, FRAME_WIDTH, FRAME_HEIGHT)
            if pixel is None:
                continue
            cx, foot_y = pixel
            w, h = self._box_size(math.hypot(agent.x - self.geometry.map_x, agent.y - self.geometry.map_y))
            people.append(
                TrackedPerson(
                    track_id=agent.id,
                    x1=cx - w / 2,
                    y1=max(0.0, foot_y - h),
                    x2=cx + w / 2,
                    y2=foot_y,
                    confidence=agent.confidence,
                )
            )
        objects: list[Detection] = []
        for bag in self.bags:
            pixel = floor_to_image(self.geometry, bag.x, bag.y, FRAME_WIDTH, FRAME_HEIGHT)
            if pixel is None:
                continue
            cx, foot_y = pixel
            w, h = self._box_size(math.hypot(bag.x - self.geometry.map_x, bag.y - self.geometry.map_y))
            size = w * 0.6
            objects.append(
                Detection(x1=cx - size / 2, y1=foot_y - size, x2=cx + size / 2, y2=foot_y, confidence=0.8, class_id=28)
            )
        return people, objects

    def render(self, people: list[TrackedPerson], objects: list[Detection]) -> np.ndarray:
        if self._background is None:
            self._background = self._render_background()
        image = self._background.copy()

        for bag in objects:
            cv2.rectangle(image, (int(bag.x1), int(bag.y1)), (int(bag.x2), int(bag.y2)), (40, 90, 160), -1)

        # Painter's order: far (higher on screen) first.
        for person in sorted(people, key=lambda p: p.y2):
            color = _person_color(person.track_id)
            w = person.x2 - person.x1
            h = person.y2 - person.y1
            cx = int((person.x1 + person.x2) / 2)
            body_top = int(person.y1 + h * 0.2)
            cv2.ellipse(
                image,
                (cx, int((body_top + person.y2) / 2)),
                (max(2, int(w / 2)), max(3, int((person.y2 - body_top) / 2))),
                0, 0, 360, color, -1, cv2.LINE_AA,
            )
            cv2.circle(image, (cx, int(person.y1 + h * 0.1)), max(2, int(w * 0.28)), color, -1, cv2.LINE_AA)
        return image

    def _render_background(self) -> np.ndarray:
        """The empty scene: static for a camera's lifetime, so it is drawn once."""
        image = np.zeros((FRAME_HEIGHT, FRAME_WIDTH, 3), dtype=np.uint8)
        # Vertical gradient: a dim concourse ceiling fading into a lit floor.
        ramp = np.linspace(18, 46, FRAME_HEIGHT, dtype=np.float32)[:, None]
        image[:, :, 0] = (ramp * 1.15).astype(np.uint8)
        image[:, :, 1] = ramp.astype(np.uint8)
        image[:, :, 2] = (ramp * 0.85).astype(np.uint8)

        # Floor grid, projected through the camera so it reads as perspective.
        g = self.geometry
        for r_frac in (0.2, 0.4, 0.6, 0.8):
            pts = []
            for a in np.linspace(-0.5, 0.5, 24):
                px = floor_to_image(g, *self._point(a, r_frac), FRAME_WIDTH, FRAME_HEIGHT)
                if px is not None:
                    pts.append((int(px[0]), int(px[1])))
            for p, q in zip(pts, pts[1:]):
                cv2.line(image, p, q, (70, 62, 55), 1, cv2.LINE_AA)
        return image


_COLOR_CACHE: dict[int, list[int]] = {}


def _person_color(track_id: int) -> list[int]:
    """A stable clothing colour per person (an HSV→BGR conversion is costly per frame)."""
    color = _COLOR_CACHE.get(track_id)
    if color is None:
        # Muted, varied tones like real clothing under station lighting, not a UI palette.
        hue = (track_id * 47) % 180
        sat = 35 + (track_id * 29) % 50
        val = 95 + (track_id * 53) % 90
        color = cv2.cvtColor(np.uint8([[[hue, sat, val]]]), cv2.COLOR_HSV2BGR)[0][0].tolist()
        if len(_COLOR_CACHE) > 5000:
            _COLOR_CACHE.clear()
        _COLOR_CACHE[track_id] = color
    return color


class SimulatedSource:
    """Drop-in replacement for FrameSource that produces simulated frames at a steady
    rate, with ground-truth tracks attached so the worker can skip detection."""

    is_finite_source = False

    def __init__(self, simulator: CrowdSimulator, camera_id: str) -> None:
        self.simulator = simulator
        self.camera_id = camera_id
        self._frame_index = 0
        self._last_read_at = 0.0
        self._opened = False

    def open(self) -> None:
        self._opened = True

    def read(self) -> Frame | None:
        if not self._opened:
            raise RuntimeError("SimulatedSource.open() must be called before read()")
        interval = 1.0 / max(self.simulator.config.fps, 0.5)
        wait = self._last_read_at + interval - time.time()
        if wait > 0:
            time.sleep(wait)
        now = time.time()
        self._last_read_at = now
        self.simulator.step(now)
        people, objects = self.simulator.observe()
        frame = Frame(
            image=self.simulator.render(people, objects),
            captured_at=now,
            frame_index=self._frame_index,
            people=people,
            objects=objects,
        )
        self._frame_index += 1
        return frame

    def release(self) -> None:
        self._opened = False

    @property
    def fps_hint(self) -> float:
        return self.simulator.config.fps
