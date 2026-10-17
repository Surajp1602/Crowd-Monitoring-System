import math

import pytest

from app.density.estimator import estimate_density
from app.density.geometry import (
    CameraGeometry,
    coverage_area_sqm,
    floor_to_image,
    point_in_polygon,
    polygon_area,
    project_to_floor,
)

GEOMETRY = CameraGeometry(map_x=10.0, map_y=5.0, orientation_deg=90.0, fov_deg=80.0, range_m=20.0)
W, H = 960, 540


@pytest.mark.parametrize(
    "point",
    [(10.0, 15.0), (12.5, 20.0), (7.0, 10.0), (10.0, 24.0), (14.0, 12.0)],
)
def test_floor_to_image_inverts_projection(point):
    pixel = floor_to_image(GEOMETRY, *point, W, H)
    assert pixel is not None
    cx, foot_y = pixel
    bbox = (cx - 10, foot_y - 80, cx + 10, foot_y)
    x, y = project_to_floor(GEOMETRY, bbox, W, H)
    assert x == pytest.approx(point[0], abs=1e-6)
    assert y == pytest.approx(point[1], abs=1e-6)


def test_points_outside_view_are_not_visible():
    assert floor_to_image(GEOMETRY, 10.0, 0.0, W, H) is None  # behind the camera
    assert floor_to_image(GEOMETRY, 10.0, 30.0, W, H) is None  # beyond range
    assert floor_to_image(GEOMETRY, 30.0, 6.0, W, H) is None  # outside the FOV


def test_bearing_wraps_across_zero_degrees():
    facing_east = CameraGeometry(map_x=0, map_y=0, orientation_deg=0, fov_deg=90, range_m=10)
    above = floor_to_image(facing_east, 5, 1, W, H)
    below = floor_to_image(facing_east, 5, -1, W, H)
    assert above is not None and below is not None
    assert above[0] > W / 2 > below[0]


def test_center_of_frame_bottom_is_at_camera():
    x, y = project_to_floor(GEOMETRY, (470, 500, 490, H), W, H)
    assert math.hypot(x - 10, y - 5) < 0.5


def test_point_in_polygon_and_area():
    square = [{"x": 0, "y": 0}, {"x": 4, "y": 0}, {"x": 4, "y": 3}, {"x": 0, "y": 3}]
    assert point_in_polygon(2, 1, square)
    assert not point_in_polygon(5, 1, square)
    assert not point_in_polygon(2, 1, square[:2])
    assert polygon_area(square) == pytest.approx(12.0)


def test_density_uses_sector_area():
    area = coverage_area_sqm(GEOMETRY)
    assert area == pytest.approx(math.pi * 400 * 80 / 360)
    assert estimate_density(10, GEOMETRY) == pytest.approx(10 / area)
    assert estimate_density(5, CameraGeometry(0, 0, 0, 0, 10)) == 0.0
