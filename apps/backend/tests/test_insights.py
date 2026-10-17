import time
import uuid
from datetime import datetime, timedelta, timezone

import orjson

from common.enums import MetricScope
from common.models import AnalyticsMetric, Building, Floor, Zone


async def _admin(client, admin_credentials):
    resp = await client.post("/api/v1/auth/login", json=admin_credentials)
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _history(db, hours=6):
    """Global people rising through the day, plus a zone at 3/4 of its capacity at peak."""
    building = Building(name="B")
    db.add(building)
    await db.flush()
    floor = Floor(building_id=building.id, name="F", width_m=10, depth_m=10)
    db.add(floor)
    await db.flush()
    zone = Zone(floor_id=floor.id, name="Hall", polygon=[], capacity_threshold=40)
    db.add(zone)
    await db.flush()
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    for m in range(hours * 60):
        ts = now - timedelta(minutes=m)
        db.add(AnalyticsMetric(scope_type=MetricScope.GLOBAL, metric_name="people", value=100 + (m % 60), timestamp=ts))
        db.add(AnalyticsMetric(scope_type=MetricScope.ZONE, scope_id=zone.id, metric_name="people", value=10 + m % 21, timestamp=ts))
        db.add(AnalyticsMetric(scope_type=MetricScope.ZONE, scope_id=zone.id, metric_name="density", value=0.5, timestamp=ts))
    await db.commit()
    return zone


async def test_timeseries_buckets_and_csv(client, admin_credentials, db_session):
    await _history(db_session)
    headers = await _admin(client, admin_credentials)
    since = (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()
    data = (await client.get("/api/v1/analytics/timeseries", headers=headers,
                             params={"metric": "people", "scope_type": "global", "since": since, "bucket": "hour"})).json()
    assert data["bucket"] == "hour"
    points = data["series"][0]["points"]
    assert 5 <= len(points) <= 6
    full = points[1]
    assert full["min"] == 100 and full["max"] == 159 and full["avg"] == 129.5

    auto = (await client.get("/api/v1/analytics/timeseries", headers=headers, params={"since": since})).json()
    assert auto["bucket"] == "minute"

    csv = await client.get("/api/v1/analytics/timeseries.csv", headers=headers, params={"since": since, "bucket": "hour"})
    assert csv.headers["content-type"].startswith("text/csv")
    assert csv.text.splitlines()[0] == "scope_type,scope_id,metric,bucket_start,avg,min,max"


async def test_window_is_bounded(client, admin_credentials):
    headers = await _admin(client, admin_credentials)
    since = (datetime.now(timezone.utc) - timedelta(days=120)).isoformat()
    assert (await client.get("/api/v1/analytics/timeseries", headers=headers, params={"since": since})).status_code == 422


async def test_zone_comparison_and_peak_hours(client, admin_credentials, db_session):
    zone = await _history(db_session)
    headers = await _admin(client, admin_credentials)
    [row] = (await client.get("/api/v1/analytics/zones", headers=headers)).json()
    assert row["zone_id"] == str(zone.id) and row["peak_people"] == 30 and row["peak_utilisation"] == 0.75

    peaks = (await client.get("/api/v1/analytics/peak-hours", headers=headers, params={"days": 1, "tz_offset_minutes": 330})).json()
    assert peaks["cells"] and peaks["busiest"]["avg"] > 0


async def test_alerts_by_day(client, admin_credentials):
    headers = await _admin(client, admin_credentials)
    internal = {"X-Internal-Api-Key": "dev-internal-service-key-change-me"}
    # Different types, so the three do not group into one alert.
    for alert_type, severity in (("panic", "critical"), ("fighting", "high"), ("running", "high")):
        await client.post("/api/v1/alerts", headers=internal, json={"alert_type": alert_type, "severity": severity, "title": "x"})
    [day] = (await client.get("/api/v1/analytics/alerts-by-day", headers=headers)).json()
    assert day["critical"] == 1 and day["high"] == 2 and day["total"] == 3


async def test_system_health_reports_each_service(client, admin_credentials, fake_redis):
    headers = await _admin(client, admin_credentials)
    report = (await client.get("/api/v1/system/health", headers=headers)).json()
    assert report["services"]["database"]["status"] == "ok"
    assert report["services"]["ai_service"]["status"] == "down" and report["status"] == "degraded"

    beat = {"ts": time.time(), "cameras": ["a", "b"], "device": "cuda:0", "cpu_pct": 30, "gpus": [{"name": "GTX"}]}
    await fake_redis.set("ai-service:heartbeat", orjson.dumps(beat).decode(), ex=30)
    await fake_redis.set("worker:heartbeat", orjson.dumps({"ts": time.time(), "sent": 1, "failed": 0}).decode(), ex=30)
    report = (await client.get("/api/v1/system/health", headers=headers)).json()
    assert report["services"]["ai_service"]["active_cameras"] == 2
    assert report["services"]["worker"]["status"] == "ok"
    assert report["status"] == "ok"


async def test_system_health_is_staff_only(client):
    guest = (await client.post("/api/v1/auth/guest")).json()["access_token"]
    resp = await client.get("/api/v1/system/health", headers={"Authorization": f"Bearer {guest}"})
    assert resp.status_code == 403


async def test_bootstrap_admin_is_protected(client, admin_credentials):
    headers = await _admin(client, admin_credentials)
    me = (await client.get("/api/v1/users", headers=headers)).json()["items"][0]
    assert (await client.patch(f"/api/v1/users/{me['id']}", headers=headers, json={"is_active": False})).status_code == 400
    assert (await client.delete(f"/api/v1/users/{me['id']}", headers=headers)).status_code == 400
    roles = (await client.get("/api/v1/users/roles", headers=headers)).json()
    assert {r["name"] for r in roles} >= {"admin", "viewer", "guest"}
