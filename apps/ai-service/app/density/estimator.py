from app.density.geometry import CameraGeometry, coverage_area_sqm


def estimate_density(person_count: int, geometry: CameraGeometry) -> float:
    """People per square meter within the camera's covered ground area."""
    area = coverage_area_sqm(geometry)
    if area <= 0:
        return 0.0
    return person_count / area
