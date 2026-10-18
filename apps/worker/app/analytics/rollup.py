"""Minute rollups into `analytics_metrics`, and data retention.

Per camera (from persisted DetectionFrames, which ai-service writes every ~2 s):
    people_avg, people_max, density_avg, inference_ms_avg
Per zone and floor (sampled from the live heatmap snapshots in Redis, which already
merge every camera on a floor and count each zone's occupants):
    people, density (zones) / people, peak_density (floors)
Global: people summed over floors.

Each minute bucket is claimed with a Redis SET NX, so any number of worker replicas
can run this loop and every bucket is written exactly once.

Retention deletes old raw data in batches. Rollups stay much longer than the raw
frames and track points that produced them.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

import orjson
from sqlalchemy import delete, func, select

from common.enums import MetricScope, TrackStatus
from common.models import AnalyticsMetric, DetectionFrame, Floor, Track, TrackPoint
from common.redis_channels import HEATMAP_KEY_PREFIX

from app.config import get_settings
from app.db import get_redis, session_scope

logger = logging.getLogger("ccd.worker.analytics")

RETENTION_BATCH = 5000


def bucket_start(ts: datetime) -> datetime:
    return ts.replace(second=0, microsecond=0)


async def _claim(key: str, ttl_s: int) -> bool:
    return bool(await get_redis().set(key, "1", ex=ttl_s, nx=True))


async def rollup_camera_minute(bucket: datetime) -> int:
    end = bucket + timedelta(minutes=1)
    async with session_scope() as db:
        rows = (
            await db.execute(
                select(
                    DetectionFrame.camera_id,
                    func.avg(DetectionFrame.person_count),
                    func.max(DetectionFrame.person_count),
                    func.avg(DetectionFrame.density_value),
                    func.avg(DetectionFrame.inference_ms),
                )
                .where(DetectionFrame.captured_at >= bucket, DetectionFrame.captured_at < end)
                .group_by(DetectionFrame.camera_id)
            )
        ).all()
        for camera_id, people_avg, people_max, density_avg, inference_avg in rows:
            for name, value in (
                ("people_avg", people_avg),
                ("people_max", people_max),
                ("density_avg", density_avg),
                ("inference_ms_avg", inference_avg),
            ):
                db.add(
                    AnalyticsMetric(
                        scope_type=MetricScope.CAMERA, scope_id=camera_id, metric_name=name,
                        value=float(value or 0), timestamp=bucket,
                    )
                )
        await db.commit()
    return len(rows)


async def sample_live_occupancy(bucket: datetime) -> int:
    r = get_redis()
    keys = [k async for k in r.scan_iter(match=f"{HEATMAP_KEY_PREFIX}*")]
    snapshots = [orjson.loads(v) for v in await r.mget(keys) if v] if keys else []
    if not snapshots:
        return 0
    async with session_scope() as db:
        floor_ids = {uuid.UUID(s["floor_id"]) for s in snapshots}
        building_of = {
            f.id: f.building_id for f in (await db.execute(select(Floor).where(Floor.id.in_(floor_ids)))).scalars()
        }
        total = 0
        per_building: dict[uuid.UUID, float] = {}
        for snap in snapshots:
            floor_id = uuid.UUID(snap["floor_id"])
            people = float(snap.get("total_people", 0))
            total += people
            if floor_id in building_of:
                per_building[building_of[floor_id]] = per_building.get(building_of[floor_id], 0) + people
            db.add(AnalyticsMetric(scope_type=MetricScope.FLOOR, scope_id=floor_id, metric_name="people", value=people, timestamp=bucket))
            db.add(AnalyticsMetric(scope_type=MetricScope.FLOOR, scope_id=floor_id, metric_name="peak_density",
                                   value=float(snap.get("max_density", 0)), timestamp=bucket))
            for zone in snap.get("zones", []):
                zid = uuid.UUID(zone["zone_id"])
                db.add(AnalyticsMetric(scope_type=MetricScope.ZONE, scope_id=zid, metric_name="people",
                                       value=float(zone["count"]), timestamp=bucket))
                db.add(AnalyticsMetric(scope_type=MetricScope.ZONE, scope_id=zid, metric_name="density",
                                       value=float(zone["density"]), timestamp=bucket))
        for building_id, people in per_building.items():
            db.add(AnalyticsMetric(scope_type=MetricScope.BUILDING, scope_id=building_id, metric_name="people", value=people, timestamp=bucket))
        db.add(AnalyticsMetric(scope_type=MetricScope.GLOBAL, scope_id=None, metric_name="people", value=total, timestamp=bucket))
        await db.commit()
    return len(snapshots)


async def run_minute(now: datetime | None = None) -> bool:
    """Rolls up the most recent complete minute. Returns False if another replica did."""
    now = now or datetime.now(timezone.utc)
    bucket = bucket_start(now) - timedelta(minutes=1)
    if not await _claim(f"rollup:minute:{bucket.isoformat()}", ttl_s=3600):
        return False
    cameras = await rollup_camera_minute(bucket)
    floors = await sample_live_occupancy(bucket)
    logger.debug("Rolled up %s: %d cameras, %d floors", bucket, cameras, floors)
    return True


async def _delete_older(model, column, cutoff: datetime, extra=()) -> int:
    removed = 0
    while True:
        async with session_scope() as db:
            ids = (await db.execute(select(model.id).where(column < cutoff, *extra).limit(RETENTION_BATCH))).scalars().all()
            if not ids:
                return removed
            await db.execute(delete(model).where(model.id.in_(ids)))
            await db.commit()
            removed += len(ids)


async def run_retention(now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(timezone.utc)
    if not await _claim(f"retention:{now.strftime('%Y-%m-%dT%H')}", ttl_s=7200):
        return {}
    s = get_settings()
    result = {
        "track_points": await _delete_older(TrackPoint, TrackPoint.ts, now - timedelta(days=s.RETENTION_DAYS_TRACK_POINTS)),
        "tracks": await _delete_older(
            Track, Track.last_seen_at, now - timedelta(days=s.RETENTION_DAYS_TRACK_POINTS), (Track.status != TrackStatus.ACTIVE,)
        ),
        "detection_frames": await _delete_older(DetectionFrame, DetectionFrame.captured_at, now - timedelta(days=s.RETENTION_DAYS_FRAMES)),
        "analytics_metrics": await _delete_older(AnalyticsMetric, AnalyticsMetric.timestamp, now - timedelta(days=s.RETENTION_DAYS_METRICS)),
    }
    if any(result.values()):
        logger.info("Retention removed %s", result)
    return result
