"""Drives the anomaly engine with the simulator's staged incidents: each incident is
the ground truth for the alert it should produce."""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from common.default_settings import DEFAULT_SETTINGS
from common.enums import AlertType

from app.anomaly.engine import AnomalyEngine
from app.capture.simulated import FRAME_HEIGHT, FRAME_WIDTH, CrowdSimulator, SimulationConfig
from app.density.geometry import CameraGeometry
from app.pipeline.analysis import FrameAnalyzer
from app.pipeline.context import CameraContext, ZoneInfo

GEOMETRY = CameraGeometry(map_x=0.0, map_y=0.0, orientation_deg=90.0, fov_deg=90.0, range_m=20.0)
VAULT = ZoneInfo(
    id=uuid.uuid4(), name="Vault", zone_type="restricted", is_restricted=True,
    polygon=[{"x": -2, "y": 9}, {"x": 2, "y": 9}, {"x": 2, "y": 13}, {"x": -2, "y": 13}],
)
DT = 0.125


def _context(zones=None) -> CameraContext:
    camera = SimpleNamespace(
        id=uuid.uuid4(), map_x=0.0, map_y=0.0, orientation_deg=90.0, fov_deg=90.0, range_m=20.0,
        updated_at=None, config={},
    )
    return CameraContext(camera=camera, zones=zones or [])


def run_incident(kind: str | None, seconds: float, *, people: int = 12, zones=None, settings=None, seed=5):
    """Warm up, stage `kind`, then run; returns every alert type raised after staging."""
    ctx = _context(zones)
    sim = CrowdSimulator(
        geometry=GEOMETRY,
        config=SimulationConfig(seed=seed, base_people=people, peak_people=people, incident_every_s=1e9,
                                incidents=(kind,) if kind else ()),
        restricted_points=[z.centroid for z in (zones or []) if z.is_restricted],
    )
    analyzer = FrameAnalyzer(ctx)
    engine = AnomalyEngine(ctx, {**DEFAULT_SETTINGS["anomaly"], **(settings or {})})
    raised: list = []

    def step(t: float, record: bool):
        sim.step(t)
        people_now, objects = sim.observe()
        analysis = analyzer.analyze(
            people_now, FRAME_WIDTH, FRAME_HEIGHT, ts=t,
            captured_at=datetime.fromtimestamp(t, tz=timezone.utc), avg_confidence=0.9, inference_ms=0,
        )
        events = engine.evaluate(analysis, objects)
        if record:
            raised.extend(events)

    t = 1000.0
    while t < 1010.0:  # warm-up: speeds settle, nothing staged yet
        step(t, record=False)
        t += DT
    # Warm-up builds history (baseline counts, speeds) but must not spend cooldowns.
    engine.reset_cooldowns()
    if kind:
        sim._next_incident_at = t
    end = t + seconds
    while t < end:
        step(t, record=True)
        t += DT
    return raised


def types(events) -> set[AlertType]:
    return {e.alert_type for e in events}


def test_normal_walking_raises_nothing():
    assert run_incident(None, 60) == []


def test_rush_raises_running_or_panic():
    raised = types(run_incident("rush", 12))
    assert raised & {AlertType.RUNNING, AlertType.PANIC}


def test_panic_raises_a_high_severity_panic():
    events = [e for e in run_incident("panic", 10) if e.alert_type == AlertType.PANIC]
    assert events and events[0].severity.value in ("high", "critical")
    assert events[0].metadata["runners"] >= 4


def test_intrusion_names_the_zone_once():
    events = [e for e in run_incident("intrusion", 40, people=3, zones=[VAULT]) if e.alert_type == AlertType.RESTRICTED_AREA_INTRUSION]
    assert len(events) == 1, "cooldown should collapse a lingering intruder to one alert"
    assert events[0].zone_id == VAULT.id and "Vault" in events[0].title


def test_loitering_after_the_configured_dwell():
    events = run_incident("loiter", 175, people=6, settings={"loitering_dwell_s": 120})
    assert AlertType.LOITERING in types(events)


def test_abnormal_stopping_in_a_moving_crowd():
    events = run_incident("stop", 75, people=10, settings={"abnormal_stop_s": 60})
    assert AlertType.ABNORMAL_STOPPING in types(events)


def test_gathering():
    assert AlertType.SUSPICIOUS_GATHERING in types(run_incident("gathering", 60, people=14))


def test_surge_raises_rapid_density_increase():
    assert AlertType.RAPID_DENSITY_INCREASE in types(run_incident("surge", 15, people=6))


def test_counter_flow():
    assert AlertType.COUNTER_FLOW in types(run_incident("counter_flow", 20, people=14))


def test_abandoned_bag():
    events = run_incident("abandoned_bag", 90, people=6)
    assert AlertType.ABANDONED_OBJECT in types(events)


def test_fight_is_flagged_as_motion_inference():
    events = [e for e in run_incident("fight", 14, people=8) if e.alert_type == AlertType.FIGHTING]
    assert events and "motion only" in events[0].description


def test_min_confidence_suppresses_weak_alerts():
    assert run_incident("rush", 12, settings={"min_confidence": 0.999}) == []


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_quiet_crowds_stay_quiet_across_seeds(seed):
    noisy = types(run_incident(None, 45, seed=seed)) - {AlertType.LOITERING}
    assert noisy == set()
