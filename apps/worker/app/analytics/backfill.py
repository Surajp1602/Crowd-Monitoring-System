"""Synthetic occupancy history for the *demo* station only, so analytics pages have
weeks of shape on a fresh install.

Safety rails: it only touches scopes belonging to the building named by DEMO_BUILDING
(the one `SEED_DEMO_DATA` creates), and only when those scopes have no metrics older
than a day, so real history is never overwritten or mixed. Alerts are never
backfilled; alert analytics always reflect real detections.

Run once:  python -m app.analytics.backfill --days 14
"""

import argparse
import asyncio
import logging
import math
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, insert, select

from common.enums import MetricScope
from common.models import AnalyticsMetric, Building, Floor, Zone

from app.db import session_scope

logger = logging.getLogger("ccd.worker.backfill")

DEMO_BUILDING = "Central Station (demo)"
STEP = timedelta(minutes=5)
TZ_OFFSET = timedelta(hours=5, minutes=30)
"""The demo station's local time (it is seeded at Bengaluru coordinates)."""


def transit_curve(local: datetime) -> float:
    """0..1 occupancy for a commuter station: morning and evening peaks on weekdays,
    a broad midday hump at weekends, near-empty overnight."""
    h = local.hour + local.minute / 60
    if local.weekday() >= 5:
        return 0.08 + 0.55 * math.exp(-((h - 14.5) ** 2) / 12)
    morning = math.exp(-((h - 9.0) ** 2) / 1.6)
    evening = math.exp(-((h - 18.3) ** 2) / 2.2)
    midday = 0.35 * math.exp(-((h - 13.0) ** 2) / 6)
    night = 0.04 if h < 5.5 or h > 23 else 0.0
    return max(0.03, min(1.0, 0.92 * morning + evening + midday - night))


async def backfill(days: int = 14, seed: int = 11) -> int:
    rng = random.Random(seed)
    async with session_scope() as db:
        building = (await db.execute(select(Building).where(Building.name == DEMO_BUILDING))).scalar_one_or_none()
        if building is None:
            logger.info("Demo building not found; nothing to backfill")
            return 0
        floors = (await db.execute(select(Floor).where(Floor.building_id == building.id))).scalars().all()
        zones = (await db.execute(select(Zone).where(Zone.floor_id.in_([f.id for f in floors])))).scalars().all()
        scope_ids = [building.id, *(f.id for f in floors), *(z.id for z in zones)]
        cutoff = datetime.now(timezone.utc) - timedelta(days=1)
        existing = (
            await db.execute(
                select(func.count()).select_from(AnalyticsMetric).where(
                    AnalyticsMetric.scope_id.in_(scope_ids), AnalyticsMetric.timestamp < cutoff
                )
            )
        ).scalar_one()
        if existing:
            logger.info("Demo scopes already have history; skipping backfill")
            return 0

        # Each zone's typical share of its floor and its peak, from capacity.
        capacity = {z.id: z.capacity_threshold or 50 for z in zones}
        end = datetime.now(timezone.utc).replace(second=0, microsecond=0) - timedelta(hours=1)
        t = end - timedelta(days=days)
        rows: list[dict] = []
        total = 0
        while t < end:
            load = transit_curve(t + TZ_OFFSET)
            site = 0.0
            for floor in floors:
                floor_people = 0.0
                for zone in (z for z in zones if z.floor_id == floor.id):
                    if zone.is_restricted:
                        people = 1.0 if rng.random() < 0.01 else 0.0
                    else:
                        people = max(0.0, capacity[zone.id] * 0.55 * load * rng.uniform(0.82, 1.18))
                    floor_people += people
                    area = _area(zone.polygon) or 1.0
                    rows.append(dict(scope_type=MetricScope.ZONE, scope_id=zone.id, metric_name="people", value=round(people, 1), timestamp=t))
                    rows.append(dict(scope_type=MetricScope.ZONE, scope_id=zone.id, metric_name="density", value=round(people / area, 3), timestamp=t))
                rows.append(dict(scope_type=MetricScope.FLOOR, scope_id=floor.id, metric_name="people", value=round(floor_people, 1), timestamp=t))
                rows.append(dict(scope_type=MetricScope.FLOOR, scope_id=floor.id, metric_name="peak_density",
                                 value=round(0.2 + 2.4 * load * rng.uniform(0.8, 1.2), 3), timestamp=t))
                site += floor_people
            rows.append(dict(scope_type=MetricScope.BUILDING, scope_id=building.id, metric_name="people", value=round(site, 1), timestamp=t))
            rows.append(dict(scope_type=MetricScope.GLOBAL, scope_id=None, metric_name="people", value=round(site, 1), timestamp=t))
            if len(rows) >= 5000:
                await db.execute(insert(AnalyticsMetric), rows)
                total += len(rows)
                rows = []
            t += STEP
        if rows:
            await db.execute(insert(AnalyticsMetric), rows)
            total += len(rows)
        await db.commit()
    logger.info("Backfilled %d demo metric rows over %d days", total, days)
    return total


def _area(polygon: list[dict]) -> float:
    if len(polygon) < 3:
        return 0.0
    return abs(sum(p["x"] * q["y"] - q["x"] * p["y"] for p, q in zip(polygon, polygon[1:] + polygon[:1]))) / 2


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=14)
    asyncio.run(backfill(parser.parse_args().days))
