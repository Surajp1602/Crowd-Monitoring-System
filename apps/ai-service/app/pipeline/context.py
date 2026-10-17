"""Everything a camera worker needs to know about where its camera sits: the camera
row itself, the floor it is mounted on, and that floor's zones. Built by the pipeline
manager on each reconcile pass so workers never query the map tables per frame.
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime

from common.models import Camera

from app.density.geometry import CameraGeometry, point_in_polygon, polygon_area


@dataclass(frozen=True)
class ZoneInfo:
    id: uuid.UUID
    name: str
    zone_type: str
    polygon: list[dict]
    is_restricted: bool
    capacity_threshold: int | None = None

    @property
    def area_sqm(self) -> float:
        return polygon_area(self.polygon)

    def contains(self, x: float, y: float) -> bool:
        return point_in_polygon(x, y, self.polygon)

    @property
    def centroid(self) -> tuple[float, float]:
        if not self.polygon:
            return 0.0, 0.0
        n = len(self.polygon)
        return sum(p["x"] for p in self.polygon) / n, sum(p["y"] for p in self.polygon) / n


@dataclass(frozen=True)
class FloorInfo:
    id: uuid.UUID
    name: str
    width_m: float
    depth_m: float


@dataclass
class CameraContext:
    camera: Camera
    floor: FloorInfo | None = None
    zones: list[ZoneInfo] = field(default_factory=list)

    @property
    def camera_id(self) -> str:
        return str(self.camera.id)

    @property
    def version(self) -> tuple:
        """Changes whenever the camera row or its floor's zones are edited; the manager
        restarts the worker when it does, so geometry and zone edits apply live."""
        zone_key = tuple(sorted((str(z.id), str(z.polygon), z.is_restricted) for z in self.zones))
        updated_at: datetime | None = self.camera.updated_at
        return (updated_at, zone_key)

    @property
    def geometry(self) -> CameraGeometry:
        return CameraGeometry(
            map_x=self.camera.map_x,
            map_y=self.camera.map_y,
            orientation_deg=self.camera.orientation_deg,
            fov_deg=self.camera.fov_deg,
            range_m=self.camera.range_m,
        )

    def zone_at(self, x: float, y: float) -> ZoneInfo | None:
        for zone in self.zones:
            if zone.contains(x, y):
                return zone
        return None
