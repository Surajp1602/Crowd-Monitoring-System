"""Historical analytics over `analytics_metrics` (minute rollups written by the worker)
and `alerts`.

Bucketing happens in Python rather than with `date_trunc`, so the same code runs on
Postgres and on the SQLite test database. Queries are bounded by scope, metric and
time window; a month of minute rows for one scope is ~43k rows, comfortably small.
"""

import csv
import io
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from common.enums import MetricScope
from common.models import Alert, AnalyticsMetric, Floor, Zone

BUCKETS = {"minute": 60, "5min": 300, "15min": 900, "hour": 3600, "day": 86400}


def _aware(ts: datetime) -> datetime:
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _bucket(ts: datetime, seconds: int) -> datetime:
    epoch = int(_aware(ts).timestamp())
    return datetime.fromtimestamp(epoch - epoch % seconds, tz=timezone.utc)


def pick_bucket(since: datetime, until: datetime) -> str:
    span = (until - since).total_seconds()
    if span <= 6 * 3600:
        return "minute"
    if span <= 2 * 86400:
        return "15min"
    if span <= 14 * 86400:
        return "hour"
    return "day"


async def _rows(db: AsyncSession, metric: str, scope_type: MetricScope, scope_ids: list[uuid.UUID] | None,
                since: datetime, until: datetime):
    stmt = select(AnalyticsMetric).where(
        AnalyticsMetric.metric_name == metric,
        AnalyticsMetric.scope_type == scope_type,
        AnalyticsMetric.timestamp >= since,
        AnalyticsMetric.timestamp < until,
    )
    if scope_ids:
        stmt = stmt.where(AnalyticsMetric.scope_id.in_(scope_ids))
    return (await db.execute(stmt.order_by(AnalyticsMetric.timestamp))).scalars().all()


async def timeseries(db: AsyncSession, metric: str, scope_type: MetricScope, scope_ids: list[uuid.UUID] | None,
                     since: datetime, until: datetime, bucket: str | None) -> dict:
    bucket = bucket or pick_bucket(since, until)
    seconds = BUCKETS[bucket]
    series: dict[str, dict[datetime, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in await _rows(db, metric, scope_type, scope_ids, since, until):
        series[str(row.scope_id) if row.scope_id else "global"][_bucket(row.timestamp, seconds)].append(row.value)
    return {
        "metric": metric,
        "scope_type": scope_type.value,
        "bucket": bucket,
        "series": [
            {
                "scope_id": scope,
                "points": [
                    {"t": t.isoformat(), "avg": round(sum(v) / len(v), 3), "max": round(max(v), 3), "min": round(min(v), 3)}
                    for t, v in sorted(points.items())
                ],
            }
            for scope, points in series.items()
        ],
    }


async def peak_hours(db: AsyncSession, scope_type: MetricScope, scope_id: uuid.UUID | None, days: int,
                     tz_offset_minutes: int) -> dict:
    """Average occupancy by weekday x hour, in the caller's local time."""
    until = datetime.now(timezone.utc)
    since = until - timedelta(days=days)
    grid: dict[tuple[int, int], list[float]] = defaultdict(list)
    shift = timedelta(minutes=tz_offset_minutes)
    for row in await _rows(db, "people", scope_type, [scope_id] if scope_id else None, since, until):
        local = _aware(row.timestamp) + shift
        grid[(local.weekday(), local.hour)].append(row.value)
    cells = [
        {"weekday": d, "hour": h, "avg": round(sum(v) / len(v), 2), "max": round(max(v), 2)}
        for (d, h), v in sorted(grid.items())
    ]
    busiest = max(cells, key=lambda c: c["avg"], default=None)
    return {"days": days, "cells": cells, "busiest": busiest}


async def zone_comparison(db: AsyncSession, floor_id: uuid.UUID | None, since: datetime, until: datetime) -> list[dict]:
    zone_stmt = select(Zone)
    if floor_id:
        zone_stmt = zone_stmt.where(Zone.floor_id == floor_id)
    zones = (await db.execute(zone_stmt)).scalars().all()
    if not zones:
        return []
    by_zone: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for metric in ("people", "density"):
        for row in await _rows(db, metric, MetricScope.ZONE, [z.id for z in zones], since, until):
            by_zone[str(row.scope_id)][metric].append(row.value)
    floors = {f.id: f.name for f in (await db.execute(select(Floor))).scalars()}
    out = []
    for z in zones:
        people = by_zone[str(z.id)]["people"]
        density = by_zone[str(z.id)]["density"]
        peak = max(people, default=0.0)
        out.append(
            {
                "zone_id": str(z.id),
                "name": z.name,
                "floor": floors.get(z.floor_id),
                "is_restricted": z.is_restricted,
                "capacity": z.capacity_threshold,
                "avg_people": round(sum(people) / len(people), 2) if people else 0.0,
                "peak_people": peak,
                "avg_density": round(sum(density) / len(density), 3) if density else 0.0,
                "peak_density": round(max(density, default=0.0), 3),
                "peak_utilisation": round(peak / z.capacity_threshold, 3) if z.capacity_threshold else None,
                "samples": len(people),
            }
        )
    return sorted(out, key=lambda r: (r["peak_utilisation"] or 0, r["peak_people"]), reverse=True)


async def alerts_by_day(db: AsyncSession, since: datetime, until: datetime, tz_offset_minutes: int) -> list[dict]:
    rows = (
        await db.execute(select(Alert.created_at, Alert.severity).where(Alert.created_at >= since, Alert.created_at < until))
    ).all()
    shift = timedelta(minutes=tz_offset_minutes)
    days: dict[str, dict[str, int]] = defaultdict(lambda: {"low": 0, "medium": 0, "high": 0, "critical": 0})
    for created, severity in rows:
        day = (_aware(created) + shift).date().isoformat()
        days[day][severity.value] += 1
    return [{"day": d, **counts, "total": sum(counts.values())} for d, counts in sorted(days.items())]


def to_csv(series: dict) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["scope_type", "scope_id", "metric", "bucket_start", "avg", "min", "max"])
    for s in series["series"]:
        for p in s["points"]:
            writer.writerow([series["scope_type"], s["scope_id"], series["metric"], p["t"], p["avg"], p["min"], p["max"]])
    return buf.getvalue()
