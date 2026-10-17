"""Demo facility: a two-level transit station with zones, walls and simulated cameras.

Seeded on startup when SEED_DEMO_DATA is true and the database has no buildings yet,
so a fresh `docker compose up` shows a living platform - heatmaps, a populated 3D
map, anomalies and alerts - without any camera hardware. Delete the building (or
set SEED_DEMO_DATA=false before first boot) to start from a clean slate.

Floor coordinates are meters: x runs along the width, y along the depth, origin at
the floor's south-west corner. Camera orientation is the yaw on that plane (0 = +x,
90 = +y), matching the ai-service projection.
"""

import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from common.enums import CameraStatus, StreamType, ZoneType
from common.models import Building, Camera, Floor, Zone

logger = logging.getLogger("ccd.seed.demo")


def _rect(x0: float, y0: float, x1: float, y1: float) -> list[dict]:
    return [{"x": x0, "y": y0}, {"x": x1, "y": y0}, {"x": x1, "y": y1}, {"x": x0, "y": y1}]


def _wall(x1: float, y1: float, x2: float, y2: float) -> dict:
    return {"x1": x1, "y1": y1, "x2": x2, "y2": y2}


def _outer(w: float, d: float, gaps: list[tuple[str, float, float]]) -> list[dict]:
    """Perimeter walls with door gaps: (side, start, end) along that side."""
    walls = []
    for side, length in (("south", w), ("north", w), ("west", d), ("east", d)):
        cuts = sorted((a, b) for s, a, b in gaps if s == side)
        pos = 0.0
        for a, b in cuts + [(length, length)]:
            if a > pos:
                if side == "south":
                    walls.append(_wall(pos, 0, a, 0))
                elif side == "north":
                    walls.append(_wall(pos, d, a, d))
                elif side == "west":
                    walls.append(_wall(0, pos, 0, a))
                else:
                    walls.append(_wall(w, pos, w, a))
            pos = b
    return walls


CONCOURSE = {
    "name": "Concourse (L0)",
    "level_index": 0,
    "width_m": 60.0,
    "depth_m": 40.0,
    "layout": {
        "wall_height_m": 4.5,
        "walls": _outer(60, 40, [("south", 24, 36), ("north", 20, 40), ("east", 10, 30)])
        + [
            _wall(0, 26, 10, 26),  # staff room, door at x 10-14
            _wall(14, 26, 14, 40),
            _wall(46, 6, 46, 14),  # platform access screen
            _wall(46, 22, 46, 34),
        ],
        "labels": [
            {"text": "Platforms", "x": 58, "y": 20},
            {"text": "Street", "x": 30, "y": -2},
        ],
    },
    "zones": [
        ("Main Entrance", ZoneType.ENTRANCE, _rect(24, 0, 36, 6), "#38bdf8", 60, False),
        ("Ticket Hall", ZoneType.OPEN_SPACE, _rect(14, 6, 46, 20), "#22c55e", 220, False),
        ("Food Court", ZoneType.PUBLIC, _rect(0, 6, 14, 26), "#eab308", 120, False),
        ("Platform Access", ZoneType.CORRIDOR, _rect(46, 6, 60, 34), "#a78bfa", 160, False),
        ("Central Concourse", ZoneType.OPEN_SPACE, _rect(14, 20, 46, 34), "#2dd4bf", 260, False),
        ("Staff Only", ZoneType.RESTRICTED, _rect(0, 26, 14, 40), "#ef4444", 8, True),
        ("Exit B", ZoneType.EXIT, _rect(20, 34, 40, 40), "#f97316", 70, False),
    ],
    "cameras": [
        ("CAM-L0-ENT", "Main entrance", (30, 1, 4.5), 90, 95, 20, {"base_people": 18, "peak_people": 55}),
        ("CAM-L0-HALL", "Ticket hall", (45, 19, 5), 180, 85, 24, {"base_people": 22, "peak_people": 70}),
        ("CAM-L0-FOOD", "Food court", (1, 7, 4), 60, 90, 20, {"base_people": 12, "peak_people": 45}),
        ("CAM-L0-STAFF", "Staff corridor", (13, 39, 3.5), 225, 80, 16, {"base_people": 0, "peak_people": 0, "incidents": ["intrusion"], "incident_every_s": 150}),
        ("CAM-L0-PLAT", "Platform access", (53, 35, 5), 270, 70, 30, {"base_people": 14, "peak_people": 50}),
    ],
}

MEZZANINE = {
    "name": "Mezzanine (L1)",
    "level_index": 1,
    "width_m": 60.0,
    "depth_m": 40.0,
    "layout": {
        "wall_height_m": 4.0,
        "walls": _outer(60, 40, [])
        + [
            _wall(0, 20, 26, 20),  # shopfronts, walkway opening at x 26-34
            _wall(34, 20, 60, 20),
            _wall(48, 28, 48, 40),  # server room, door from the walkway
            _wall(48, 28, 54, 28),
        ],
        "labels": [{"text": "Escalators", "x": 30, "y": 24}],
    },
    "zones": [
        ("Retail Arcade", ZoneType.PUBLIC, _rect(0, 0, 30, 20), "#f472b6", 150, False),
        ("Lounge", ZoneType.PUBLIC, _rect(30, 0, 60, 20), "#60a5fa", 90, False),
        ("Gallery Walkway", ZoneType.CORRIDOR, _rect(0, 20, 60, 28), "#34d399", 120, False),
        ("Event Space", ZoneType.ASSEMBLY_POINT, _rect(0, 28, 48, 40), "#fbbf24", 200, False),
        ("Server Room", ZoneType.RESTRICTED, _rect(48, 28, 60, 40), "#ef4444", 2, True),
    ],
    "cameras": [
        ("CAM-L1-RETAIL", "Retail arcade", (15, 21, 4), 270, 90, 20, {"base_people": 14, "peak_people": 48}),
        ("CAM-L1-EVENT", "Event space", (24, 39, 4), 270, 100, 18, {"base_people": 10, "peak_people": 50}),
        ("CAM-L1-SERVER", "Server room door", (49, 29, 3), 45, 90, 14, {"base_people": 0, "peak_people": 0, "incidents": ["intrusion"], "incident_every_s": 200}),
    ],
}


async def seed_demo_facility(db: AsyncSession) -> bool:
    """Returns True if the demo facility was created."""
    if (await db.execute(select(func.count()).select_from(Building))).scalar_one() > 0:
        return False

    building = Building(
        name="Central Station (demo)",
        description="Two-level transit hub with simulated cameras. Safe to delete.",
        address="Demo facility",
        latitude=12.9767,
        longitude=77.5713,
    )
    db.add(building)
    await db.flush()

    for spec in (CONCOURSE, MEZZANINE):
        floor = Floor(
            building_id=building.id,
            name=spec["name"],
            level_index=spec["level_index"],
            width_m=spec["width_m"],
            depth_m=spec["depth_m"],
            layout=spec["layout"],
        )
        db.add(floor)
        await db.flush()

        zone_ids = {}
        for name, zone_type, polygon, color, capacity, restricted in spec["zones"]:
            zone = Zone(
                floor_id=floor.id,
                name=name,
                zone_type=zone_type,
                polygon=polygon,
                color=color,
                capacity_threshold=capacity,
                is_restricted=restricted,
            )
            db.add(zone)
            await db.flush()
            zone_ids[name] = zone

        for code, name, (x, y, z), yaw, fov, rng, sim in spec["cameras"]:
            home = next((zn for zn in zone_ids.values() if _contains(zn.polygon, x, y)), None)
            db.add(
                Camera(
                    code=code,
                    name=name,
                    description="Simulated crowd feed",
                    stream_type=StreamType.SIMULATED,
                    stream_url="simulated://demo",
                    building_id=building.id,
                    floor_id=floor.id,
                    zone_id=home.id if home else None,
                    latitude=building.latitude,
                    longitude=building.longitude,
                    map_x=x,
                    map_y=y,
                    map_z=z,
                    orientation_deg=yaw,
                    tilt_deg=-25.0,
                    fov_deg=fov,
                    range_m=rng,
                    status=CameraStatus.STARTING,
                    config={"simulation": sim},
                    is_active=True,
                )
            )
    await db.flush()
    logger.info("Seeded demo facility %s with simulated cameras", building.name)
    return True


def _contains(polygon: list[dict], x: float, y: float) -> bool:
    xs = [p["x"] for p in polygon]
    ys = [p["y"] for p in polygon]
    return min(xs) <= x <= max(xs) and min(ys) <= y <= max(ys)
