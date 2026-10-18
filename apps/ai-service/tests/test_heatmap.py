import base64
import uuid

import numpy as np
import pytest

from app.heatmap.engine import STALE_AFTER_S, FloorHeatmap, HeatmapRegistry
from app.pipeline.context import FloorInfo, ZoneInfo

FLOOR = FloorInfo(id=uuid.uuid4(), name="Concourse", width_m=40.0, depth_m=20.0)
ZONE = ZoneInfo(
    id=uuid.uuid4(), name="Hall", zone_type="public", is_restricted=False, capacity_threshold=50,
    polygon=[{"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 10, "y": 10}, {"x": 0, "y": 10}],
)


def _decode(msg) -> np.ndarray:
    raw = np.frombuffer(base64.b64decode(msg.cells), dtype=np.uint8).reshape(msg.rows, msg.cols)
    return raw.astype(np.float32) / 255.0 * msg.scale_max


def test_grid_integrates_to_head_count():
    hm = FloorHeatmap(floor=FLOOR, resolution_m=0.5)
    hm.report("cam-a", [(10, 10), (20, 5), (30, 15)], {}, ts=100.0)
    grid = hm.instantaneous(100.0)
    assert grid.sum() * hm.resolution_m**2 == pytest.approx(3.0, rel=1e-3)


def test_people_near_the_edge_lose_only_the_off_floor_part():
    hm = FloorHeatmap(floor=FLOOR, resolution_m=0.5)
    hm.report("cam-a", [(0.1, 0.1)], {}, ts=100.0)
    total = hm.instantaneous(100.0).sum() * hm.resolution_m**2
    assert 0.2 < total < 0.4  # roughly a quarter of the kernel lands on the floor


def test_multiple_cameras_merge_and_stale_cameras_expire():
    hm = FloorHeatmap(floor=FLOOR, resolution_m=1.0)
    hm.report("cam-a", [(5, 5)], {}, ts=100.0)
    hm.report("cam-b", [(25, 5), (26, 6)], {}, ts=101.0)
    assert hm.instantaneous(101.5).sum() == pytest.approx(3.0, rel=1e-3)
    later = 100.0 + STALE_AFTER_S + 0.5
    assert hm.instantaneous(later).sum() == pytest.approx(2.0, rel=1e-3)


def test_heat_fades_after_people_leave():
    hm = FloorHeatmap(floor=FLOOR, resolution_m=1.0, decay_seconds=6.0)
    hm.report("cam-a", [(10, 10)] * 4, {}, ts=0.0)
    hm.blend(0.0)
    peak = hm.grid.max()
    hm.report("cam-a", [], {}, ts=1.0)
    hm.blend(3.0)  # one and a half time constants
    assert 0.1 * peak < hm.grid.max() < 0.4 * peak
    hm.report("cam-a", [], {}, ts=6.0)
    hm.blend(6.0)  # three time constants in total
    assert hm.grid.max() < 0.06 * peak


def test_snapshot_encodes_density_and_zone_occupancy():
    hm = FloorHeatmap(floor=FLOOR, resolution_m=0.5, zones=[ZONE])
    people = [(5 + 0.3 * i, 5) for i in range(10)]
    hm.report("cam-a", people, {ZONE.id: 10}, ts=50.0)
    msg = hm.snapshot(50.0)
    grid = _decode(msg)
    assert grid.shape == (40, 80)
    assert msg.total_people == 10
    assert msg.max_density == pytest.approx(float(hm.grid.max()), abs=1e-3)
    assert grid.max() == pytest.approx(min(msg.max_density, msg.scale_max), abs=msg.scale_max / 255 + 1e-6)
    [zone] = msg.zones
    assert zone.count == 10 and zone.density == pytest.approx(0.1)
    assert msg.camera_ids == ["cam-a"]


def test_large_floors_are_coarsened():
    huge = FloorInfo(id=uuid.uuid4(), name="Arena", width_m=400, depth_m=300)
    hm = FloorHeatmap(floor=huge, resolution_m=0.5)
    assert hm.rows * hm.cols <= 40_000
    assert hm.resolution_m > 0.5


def test_registry_keeps_reports_across_reconfiguration():
    registry = HeatmapRegistry()
    hm = registry.configure(FLOOR, [], resolution_m=0.5, decay_seconds=8)
    hm.report("cam-a", [(1, 1)], {}, ts=10.0)
    same = registry.configure(FLOOR, [], resolution_m=0.5, decay_seconds=8)
    assert same is hm
    changed = registry.configure(FLOOR, [ZONE], resolution_m=0.5, decay_seconds=8)
    assert changed is not hm and "cam-a" in changed._reports
    registry.retain(set())
    assert registry.floors() == []
