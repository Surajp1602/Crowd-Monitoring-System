"""Floor-level crowd density heatmap.

Every camera on a floor reports where its people stand (floor meters). Each person is
splatted onto the floor grid as a Gaussian whose weights sum to exactly one person, so
a cell's value is a true density in people per square meter and the grid integrates
to the head count. The instantaneous grid is blended into the published one with an
exponential moving average: a person who leaves fades out instead of blinking off.

Camera reports expire after `STALE_AFTER_S`, so a camera that drops out stops
contributing heat instead of freezing its last crowd onto the map.
"""

import base64
import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np

from common.schemas import HeatmapFrameMessage, ZoneOccupancyDTO

from app.pipeline.context import FloorInfo, ZoneInfo

STALE_AFTER_S = 3.0
SPLAT_SIGMA_M = 0.9
"""Roughly the radius of personal space: one person warms about 3 m² of floor."""
SCALE_MAX = 8.0
"""Upper end of the uint8 encoding, in people/m². Crush loading starts around 6."""
MAX_CELLS = 40_000
"""Resolution is coarsened automatically above this so huge floors stay cheap."""


@dataclass
class CameraReport:
    points: list[tuple[float, float]]
    zone_counts: dict
    ts: float


@dataclass
class FloorHeatmap:
    floor: FloorInfo
    resolution_m: float = 0.5
    decay_seconds: float = 8.0
    zones: list[ZoneInfo] = field(default_factory=list)

    def __post_init__(self) -> None:
        res = max(self.resolution_m, 0.1)
        while (self.floor.width_m / res) * (self.floor.depth_m / res) > MAX_CELLS:
            res *= 1.5
        self.resolution_m = res
        self.cols = max(1, math.ceil(self.floor.width_m / res))
        self.rows = max(1, math.ceil(self.floor.depth_m / res))
        self.grid = np.zeros((self.rows, self.cols), dtype=np.float32)
        self._reports: dict[str, CameraReport] = {}
        self._last_blend_at: float | None = None
        self._kernel = self._build_kernel()

    def _build_kernel(self) -> np.ndarray:
        radius = max(1, math.ceil(3 * SPLAT_SIGMA_M / self.resolution_m))
        axis = np.arange(-radius, radius + 1, dtype=np.float32) * self.resolution_m
        xx, yy = np.meshgrid(axis, axis)
        kernel = np.exp(-(xx**2 + yy**2) / (2 * SPLAT_SIGMA_M**2))
        # Normalize so the kernel integrates to one person over its cells' area.
        return kernel / (kernel.sum() * self.resolution_m**2)

    def report(self, camera_id: str, points: list[tuple[float, float]], zone_counts: dict, ts: float) -> None:
        self._reports[camera_id] = CameraReport(points=points, zone_counts=zone_counts, ts=ts)

    def drop_camera(self, camera_id: str) -> None:
        self._reports.pop(camera_id, None)

    def _live_reports(self, now: float) -> dict[str, CameraReport]:
        self._reports = {k: r for k, r in self._reports.items() if now - r.ts <= STALE_AFTER_S}
        return self._reports

    def instantaneous(self, now: float) -> np.ndarray:
        grid = np.zeros((self.rows, self.cols), dtype=np.float32)
        k = self._kernel
        r = k.shape[0] // 2
        for report in self._live_reports(now).values():
            for x, y in report.points:
                col = int(x / self.resolution_m)
                row = int(y / self.resolution_m)
                if not (0 <= row < self.rows and 0 <= col < self.cols):
                    continue
                r0, r1 = max(0, row - r), min(self.rows, row + r + 1)
                c0, c1 = max(0, col - r), min(self.cols, col + r + 1)
                grid[r0:r1, c0:c1] += k[r0 - (row - r) : r1 - (row - r), c0 - (col - r) : c1 - (col - r)]
        return grid

    def blend(self, now: float) -> np.ndarray:
        """EMA toward the instantaneous grid. A departed person's heat falls to ~5%
        after `decay_seconds` (three time constants)."""
        target = self.instantaneous(now)
        if self._last_blend_at is None:
            self.grid = target
        else:
            dt = max(0.0, now - self._last_blend_at)
            tau = max(self.decay_seconds, 0.3) / 3.0
            alpha = 1.0 - math.exp(-dt / tau)
            self.grid += alpha * (target - self.grid)
        self._last_blend_at = now
        return self.grid

    def zone_occupancy(self) -> list[ZoneOccupancyDTO]:
        totals: dict = {}
        for report in self._reports.values():
            for zone_id, count in report.zone_counts.items():
                totals[zone_id] = totals.get(zone_id, 0) + count
        result = []
        for zone in self.zones:
            count = totals.get(zone.id, 0)
            area = zone.area_sqm
            result.append(
                ZoneOccupancyDTO(
                    zone_id=str(zone.id),
                    name=zone.name,
                    count=count,
                    density=round(count / area, 3) if area > 0 else 0.0,
                    capacity_threshold=zone.capacity_threshold,
                    is_restricted=zone.is_restricted,
                )
            )
        return result

    def snapshot(self, now: float | None = None) -> HeatmapFrameMessage:
        now = time.time() if now is None else now
        grid = self.blend(now)
        encoded = np.clip(grid / SCALE_MAX * 255.0, 0, 255).astype(np.uint8)
        return HeatmapFrameMessage(
            floor_id=str(self.floor.id),
            ts=datetime.fromtimestamp(now, tz=timezone.utc),
            width_m=self.floor.width_m,
            depth_m=self.floor.depth_m,
            resolution_m=self.resolution_m,
            rows=self.rows,
            cols=self.cols,
            scale_max=SCALE_MAX,
            max_density=round(float(grid.max()) if grid.size else 0.0, 3),
            total_people=sum(len(r.points) for r in self._reports.values()),
            cells=base64.b64encode(encoded.tobytes()).decode(),
            zones=self.zone_occupancy(),
            camera_ids=sorted(self._reports),
        )


class HeatmapRegistry:
    """One FloorHeatmap per floor, shared by every camera worker on that floor."""

    def __init__(self) -> None:
        self._floors: dict[str, FloorHeatmap] = {}

    def configure(self, floor: FloorInfo, zones: list[ZoneInfo], resolution_m: float, decay_seconds: float) -> FloorHeatmap:
        key = str(floor.id)
        existing = self._floors.get(key)
        if (
            existing is None
            or existing.floor != floor
            or existing.zones != zones
            or existing.decay_seconds != decay_seconds
        ):
            heatmap = FloorHeatmap(floor=floor, resolution_m=resolution_m, decay_seconds=decay_seconds, zones=zones)
            if existing is not None:
                heatmap._reports = existing._reports
                if existing.grid.shape == heatmap.grid.shape:
                    heatmap.grid = existing.grid
            self._floors[key] = heatmap
        return self._floors[key]

    def get(self, floor_id: str) -> FloorHeatmap | None:
        return self._floors.get(floor_id)

    def retain(self, floor_ids: set[str]) -> None:
        self._floors = {k: v for k, v in self._floors.items() if k in floor_ids}

    def floors(self) -> list[FloorHeatmap]:
        return list(self._floors.values())


heatmap_registry = HeatmapRegistry()
