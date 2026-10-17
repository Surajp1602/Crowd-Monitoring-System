import pytest

from app.tracking.identity import IdentityRegistry
from app.tracking.kinematics import KinematicsTracker


def test_speed_converges_to_true_speed():
    tracker = KinematicsTracker()
    state = None
    for i in range(30):
        state = tracker.update(1, ts=i * 0.5, map_x=i * 0.5 * 2.0, map_y=0.0)  # 2 m/s due east
    assert state.speed_mps == pytest.approx(2.0, rel=0.01)
    assert state.direction_deg == pytest.approx(0.0)
    assert state.dwell_time_s == pytest.approx(14.5)


def test_jitter_does_not_change_direction():
    tracker = KinematicsTracker()
    tracker.update(1, 0.0, 0.0, 0.0)
    tracker.update(1, 1.0, 0.0, 1.0)  # moving north
    state = tracker.update(1, 2.0, 0.01, 1.01)  # 1.4 cm wobble
    assert state.direction_deg == pytest.approx(90.0)


def test_stale_tracks_are_dropped_only_after_max_age():
    tracker = KinematicsTracker()
    tracker.update(1, 0.0, 0.0, 0.0)
    tracker.update(2, 0.0, 1.0, 1.0)
    tracker.drop_stale({2}, now=10.0, max_age_s=30.0)
    assert set(tracker._states) == {1, 2}
    tracker.drop_stale({2}, now=31.0, max_age_s=30.0)
    assert set(tracker._states) == {2}


def test_identity_is_stable_until_forgotten():
    registry = IdentityRegistry()
    first = registry.resolve(7)
    assert registry.resolve(7) == first
    registry.forget(7)
    assert registry.resolve(7) != first
