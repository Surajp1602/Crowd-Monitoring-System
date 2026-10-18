import math
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.capture.simulated import (
    FRAME_HEIGHT,
    FRAME_WIDTH,
    INCIDENT_KINDS,
    CrowdSimulator,
    SimulationConfig,
)
from app.density.geometry import CameraGeometry
from app.pipeline.analysis import FrameAnalyzer
from app.pipeline.context import CameraContext, ZoneInfo
from app.pipeline.preview import annotate, encode_preview

GEOMETRY = CameraGeometry(map_x=0.0, map_y=0.0, orientation_deg=90.0, fov_deg=90.0, range_m=18.0)


def _sim(**overrides) -> CrowdSimulator:
    config = SimulationConfig(seed=42, incident_every_s=1e9, **overrides)
    return CrowdSimulator(geometry=GEOMETRY, config=config)


def _run(sim: CrowdSimulator, seconds: float, dt: float = 0.125, start: float = 1000.0) -> float:
    t = start
    while t < start + seconds:
        sim.step(t)
        t += dt
    return t


def _context(zones=None) -> CameraContext:
    camera = SimpleNamespace(
        id=uuid.uuid4(), map_x=0.0, map_y=0.0, orientation_deg=90.0, fov_deg=90.0, range_m=18.0,
        updated_at=None, config={},
    )
    return CameraContext(camera=camera, zones=zones or [])


def test_config_reads_camera_options_and_ignores_unknown_incidents():
    cfg = SimulationConfig.from_camera_config(
        {"simulation": {"base_people": 3, "incidents": ["rush", "teleport"]}}, "cam"
    )
    assert cfg.base_people == 3
    assert cfg.incidents == ("rush",)
    assert SimulationConfig.from_camera_config({}, "cam").incidents == INCIDENT_KINDS


def test_same_seed_is_deterministic():
    a, b = _sim(), _sim()
    _run(a, 20)
    _run(b, 20)
    assert [(p.track_id, round(p.x1, 6)) for p in a.observe()[0]] == [
        (p.track_id, round(p.x1, 6)) for p in b.observe()[0]
    ]


def test_population_follows_the_cycle_and_stays_in_view():
    sim = _sim(base_people=5, peak_people=30, cycle_s=120)
    _run(sim, 60)  # half a cycle: at the peak
    people, _ = sim.observe()
    assert 15 <= len(people) <= 45
    for p in people:
        assert 0 <= (p.x1 + p.x2) / 2 <= FRAME_WIDTH
        assert 0 < p.y2 <= FRAME_HEIGHT


def test_analyzer_recovers_simulated_positions_and_walking_speed():
    sim = _sim(base_people=6, peak_people=6)
    analyzer = FrameAnalyzer(_context())
    t, analysis = 1000.0, None
    for _ in range(80):
        sim.step(t)
        people, _ = sim.observe()
        analysis = analyzer.analyze(
            people, FRAME_WIDTH, FRAME_HEIGHT, ts=t,
            captured_at=datetime.fromtimestamp(t, tz=timezone.utc), avg_confidence=0.9, inference_ms=0,
        )
        t += 0.125

    by_id = {a.id: a for a in sim.agents}
    assert analysis.person_count > 0
    for obs in analysis.observations:
        agent = by_id[obs.person.track_id]
        assert math.hypot(obs.map_x - agent.x, obs.map_y - agent.y) < 1e-6
        if obs.kinematics.dwell_time_s > 3 and agent.mode == "walk":
            assert 0.5 < obs.kinematics.speed_mps < 2.2


def test_rush_incident_makes_people_run():
    sim = _sim(base_people=10, peak_people=10, incidents=("rush",))
    analyzer = FrameAnalyzer(_context())
    t = _run(sim, 5)
    sim._next_incident_at = t
    fastest = 0.0
    for _ in range(40):
        sim.step(t)
        analysis = analyzer.analyze(
            sim.observe()[0], FRAME_WIDTH, FRAME_HEIGHT, ts=t,
            captured_at=datetime.fromtimestamp(t, tz=timezone.utc), avg_confidence=0.9, inference_ms=0,
        )
        fastest = max([fastest] + [o.kinematics.speed_mps for o in analysis.observations])
        t += 0.125
    assert sim.last_incident == "rush"
    assert fastest > 2.8


def test_intrusion_walks_into_the_restricted_zone():
    zone = ZoneInfo(
        id=uuid.uuid4(), name="Vault", zone_type="restricted", is_restricted=True,
        polygon=[{"x": -2, "y": 8}, {"x": 2, "y": 8}, {"x": 2, "y": 12}, {"x": -2, "y": 12}],
    )
    sim = CrowdSimulator(
        geometry=GEOMETRY,
        config=SimulationConfig(seed=1, base_people=2, peak_people=2, incident_every_s=1e9, incidents=("intrusion",)),
        restricted_points=[zone.centroid],
    )
    analyzer = FrameAnalyzer(_context([zone]))
    t = _run(sim, 1)
    sim._next_incident_at = t
    inside = 0
    for _ in range(240):
        sim.step(t)
        analysis = analyzer.analyze(
            sim.observe()[0], FRAME_WIDTH, FRAME_HEIGHT, ts=t,
            captured_at=datetime.fromtimestamp(t, tz=timezone.utc), avg_confidence=0.9, inference_ms=0,
        )
        inside = max(inside, analysis.zone_counts.get(zone.id, 0))
        t += 0.125
    assert inside >= 1


def test_abandoned_bag_is_observed_and_rendered():
    sim = _sim(incidents=("abandoned_bag",))
    t = _run(sim, 2)
    sim._next_incident_at = t
    sim.step(t)
    people, objects = sim.observe()
    assert len(objects) == 1 and objects[0].class_id == 28
    image = sim.render(people, objects)
    assert image.shape == (FRAME_HEIGHT, FRAME_WIDTH, 3)
    assert image.std() > 3


@pytest.mark.parametrize("kind", INCIDENT_KINDS)
def test_every_incident_runs_without_error(kind):
    sim = _sim(incidents=(kind,))
    t = _run(sim, 2)
    sim._next_incident_at = t
    _run(sim, 15, start=t)
    assert sim.last_incident in (kind, "loiter")  # intrusion falls back without restricted zones


def test_preview_encodes_annotated_frame():
    sim = _sim()
    _run(sim, 3)
    people, objects = sim.observe()
    analyzer = FrameAnalyzer(_context())
    analysis = analyzer.analyze(
        people, FRAME_WIDTH, FRAME_HEIGHT, ts=1.0,
        captured_at=datetime.now(timezone.utc), avg_confidence=0.9, inference_ms=0,
    )
    encoded = encode_preview(annotate(sim.render(people, objects), analysis))
    assert len(encoded) > 1000
    boxes = analysis.boxes()
    assert all(0 <= b.x1 <= 1 and 0 <= b.y2 <= 1 for b in boxes)
