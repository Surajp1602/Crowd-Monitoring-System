"""Pixel -> floor-plane projection.

This is a deliberately simple placeholder: it assumes the camera looks straight
along `orientation_deg` from its (map_x, map_y), spreading `fov_deg` across the
frame width, and maps the detection's vertical position linearly to distance
within `range_m` (bottom of frame = right at the camera, top of frame = max
range). That is NOT a calibrated homography — it will be visibly wrong for
cameras mounted at a steep angle or a long focal length. It exists so the rest
of the pipeline (density, trajectories, the map, anomaly detection) has real
floor coordinates to work with end-to-end today.

Replacing it: swap `project_to_floor` for a per-camera homography computed from
calibration points (a natural fit for the camera-placement UI in Phase 5) —
every caller here only depends on this function's signature, not its internals.
"""

import math
from dataclasses import dataclass


@dataclass
class CameraGeometry:
    map_x: float
    map_y: float
    orientation_deg: float
    fov_deg: float
    range_m: float


def project_to_floor(
    geometry: CameraGeometry,
    bbox: tuple[float, float, float, float],
    frame_width: int,
    frame_height: int,
) -> tuple[float, float]:
    x1, y1, x2, y2 = bbox
    center_x = (x1 + x2) / 2
    foot_y = y2  # bottom of the bounding box approximates where the person stands

    u = max(0.0, min(1.0, center_x / frame_width)) if frame_width else 0.5
    v = max(0.0, min(1.0, foot_y / frame_height)) if frame_height else 0.5

    angle_offset = (u - 0.5) * geometry.fov_deg
    bearing_deg = geometry.orientation_deg + angle_offset
    distance_m = geometry.range_m * (1.0 - v)

    bearing_rad = math.radians(bearing_deg)
    map_x = geometry.map_x + distance_m * math.cos(bearing_rad)
    map_y = geometry.map_y + distance_m * math.sin(bearing_rad)
    return map_x, map_y


def floor_to_image(
    geometry: CameraGeometry,
    map_x: float,
    map_y: float,
    frame_width: int,
    frame_height: int,
) -> tuple[float, float] | None:
    """Exact inverse of `project_to_floor` for a point: the pixel (center_x, foot_y) a
    person standing at (map_x, map_y) appears at, or None when the point is outside
    the camera's field of view or range. The simulator renders synthetic people with
    it, so projecting their boxes lands back on their true floor position.
    """
    dx = map_x - geometry.map_x
    dy = map_y - geometry.map_y
    distance_m = math.hypot(dx, dy)
    if geometry.fov_deg <= 0 or geometry.range_m <= 0 or distance_m > geometry.range_m:
        return None
    bearing_deg = math.degrees(math.atan2(dy, dx))
    offset = (bearing_deg - geometry.orientation_deg + 180.0) % 360.0 - 180.0
    if abs(offset) > geometry.fov_deg / 2:
        return None
    u = offset / geometry.fov_deg + 0.5
    v = 1.0 - distance_m / geometry.range_m
    return u * frame_width, v * frame_height


def point_in_polygon(x: float, y: float, polygon: list) -> bool:
    """Ray-casting test. Accepts zone polygons as stored ([{x, y}, ...]) or as (x, y) tuples."""
    points = [(p["x"], p["y"]) if isinstance(p, dict) else (p[0], p[1]) for p in polygon]
    if len(points) < 3:
        return False
    inside = False
    j = len(points) - 1
    for i in range(len(points)):
        xi, yi = points[i]
        xj, yj = points[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def polygon_area(polygon: list[dict]) -> float:
    """Shoelace area, in square meters, of a zone polygon ([{x, y}, ...])."""
    if len(polygon) < 3:
        return 0.0
    total = 0.0
    for i, p in enumerate(polygon):
        q = polygon[(i + 1) % len(polygon)]
        total += p["x"] * q["y"] - q["x"] * p["y"]
    return abs(total) / 2.0


def coverage_area_sqm(geometry: CameraGeometry) -> float:
    """Approximate ground area covered by the camera's field of view, treating
    it as a circular sector of radius `range_m` and angle `fov_deg`."""
    fraction = max(0.0, min(1.0, geometry.fov_deg / 360.0))
    return math.pi * geometry.range_m**2 * fraction
