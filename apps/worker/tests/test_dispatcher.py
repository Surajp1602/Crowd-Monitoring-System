import uuid
from datetime import datetime, timedelta, timezone

import orjson
from sqlalchemy import select

from common.enums import NotificationStatus, RoleName
from common.models import (
    AnalyticsMetric,
    Building,
    Camera,
    DetectionFrame,
    GeofenceSubscription,
    NotificationHistory,
    Role,
    Setting,
    User,
)
from common.enums import StreamType
from common.redis_channels import ALERTS_STREAM

from app.dispatch.dispatcher import GROUP, OUTBOX_STREAM, Dispatcher


async def _seed(factory):
    async with factory() as db:
        officer = Role(name=RoleName.SECURITY_OFFICER.value)
        viewer = Role(name=RoleName.VIEWER.value)
        db.add_all([officer, viewer])
        await db.flush()
        db.add_all(
            [
                User(email="asha@ops.example", full_name="Asha", role_id=officer.id, phone_number="+919800000001"),
                User(email="off@ops.example", full_name="Off Shift", role_id=officer.id, notify_enabled=False),
                User(email="viewer@ops.example", full_name="Viewer", role_id=viewer.id),
            ]
        )
        building = Building(name="Central Station", latitude=12.9767, longitude=77.5713)
        db.add(building)
        await db.flush()
        camera = Camera(code="cam", name="Hall", stream_type=StreamType.SIMULATED, stream_url="sim://",
                        building_id=building.id, latitude=12.9767, longitude=77.5713, config={})
        db.add(camera)
        db.add(GeofenceSubscription(latitude=12.9768, longitude=77.5714, radius_m=300, channels=["sms"],
                                    phone_number="+919811111111"))
        db.add(Setting(key="notifications", value={"staff_channels": ["email", "sms"]}))
        await db.commit()
        return camera


def _alert(camera_id, severity="critical", alert_type="panic"):
    return {"id": str(uuid.uuid4()), "camera_id": str(camera_id), "severity": severity, "alert_type": alert_type,
            "title": "Possible panic", "description": "Many running."}


async def test_alert_dispatch_routes_records_and_masks(env, recording):
    camera = await _seed(env.factory)
    dispatcher = Dispatcher(recording)
    results = await dispatcher.dispatch_alert(_alert(camera.id))
    assert all(r.ok for r in results)

    assert [m.recipient for m in recording["email"].sent] == ["asha@ops.example"], "opted-out and non-staff users are skipped"
    assert sorted(m.recipient for m in recording["sms"].sent) == ["+919800000001", "+919811111111"]
    assert len(recording["public_announcement"].sent) == 1

    async with env.factory() as db:
        rows = (await db.execute(select(NotificationHistory))).scalars().all()
    recipients = {r.recipient for r in rows}
    assert "+919800000001" in recipients, "staff numbers are stored in full for audit"
    assert "+91****11" in recipients and "+919811111111" not in recipients, "public numbers are masked"
    assert all(r.status == NotificationStatus.SENT for r in rows)


async def test_recipient_cooldown_suppresses_repeats(env, recording):
    camera = await _seed(env.factory)
    dispatcher = Dispatcher(recording)
    await dispatcher.dispatch_alert(_alert(camera.id))
    await dispatcher.dispatch_alert(_alert(camera.id))
    assert len(recording["email"].sent) == 1
    # Announcements of panic are never throttled.
    assert len(recording["public_announcement"].sent) == 2


async def test_retries_transient_failures_and_records_permanent_ones(env, recording):
    from tests.conftest import RecordingProvider

    camera = await _seed(env.factory)
    recording["email"] = RecordingProvider("email", fail_times=2)
    recording["sms"] = RecordingProvider("sms", fail_times=5, retryable=False)
    dispatcher = Dispatcher(recording)
    await dispatcher.dispatch_alert(_alert(camera.id, severity="high", alert_type="restricted_area_intrusion"))
    assert len(recording["email"].sent) == 1

    async with env.factory() as db:
        rows = (await db.execute(select(NotificationHistory))).scalars().all()
    email = next(r for r in rows if r.channel.value == "email")
    sms = next(r for r in rows if r.channel.value == "sms")
    assert email.status == NotificationStatus.SENT and email.provider_response["attempts"] == 3
    assert sms.status == NotificationStatus.FAILED and sms.provider_response["attempts"] == 1


async def test_stream_consumption_acks_and_reclaims(env, recording, monkeypatch):
    camera = await _seed(env.factory)
    dispatcher = Dispatcher(recording)
    await dispatcher.ensure_groups()
    await env.redis.xadd(ALERTS_STREAM, {"alert_id": "x", "payload": orjson.dumps(_alert(camera.id)).decode()})
    await env.redis.xadd(OUTBOX_STREAM, {"payload": orjson.dumps({"channel": "email", "recipient": "t@example.com"}).decode()})

    batches = await env.redis.xreadgroup(GROUP, "dead-consumer", {ALERTS_STREAM: ">", OUTBOX_STREAM: ">"})
    assert sum(len(e) for _, e in batches) == 2
    # The dead consumer never acks; a live one reclaims after the idle window.
    monkeypatch.setattr(dispatcher.settings, "CLAIM_IDLE_MS", 0)
    for stream in (ALERTS_STREAM, OUTBOX_STREAM):
        _, claimed, _ = await env.redis.xautoclaim(stream, GROUP, dispatcher.consumer, min_idle_time=0)
        for entry_id, fields in claimed:
            await dispatcher._handle(stream, entry_id, fields)
    assert all(not g["pending"] for g in env.redis.groups.values())
    assert "t@example.com" in [m.recipient for m in recording["email"].sent]


async def test_new_group_does_not_replay_history(env, recording):
    camera = await _seed(env.factory)
    await env.redis.xadd(ALERTS_STREAM, {"payload": orjson.dumps(_alert(camera.id)).decode()})
    dispatcher = Dispatcher(recording)
    await dispatcher.ensure_groups()
    assert await env.redis.xreadgroup(GROUP, "c", {ALERTS_STREAM: ">"}) == []


async def test_minute_rollup_is_claimed_once(env):
    from app.analytics.rollup import run_minute

    camera = await _seed(env.factory)
    now = datetime(2026, 10, 17, 12, 0, 30, tzinfo=timezone.utc)
    async with env.factory() as db:
        # 11:59:40, 11:59:50, 11:59:55 — all inside the 11:59 bucket.
        for offset, count in ((50, 10), (40, 14), (35, 18)):
            db.add(DetectionFrame(camera_id=camera.id, captured_at=now - timedelta(seconds=offset),
                                  person_count=count, density_value=0.2, avg_confidence=0.9, inference_ms=12, boxes=[]))
        await db.commit()
    floor_id = str(uuid.uuid4())
    zone_id = str(uuid.uuid4())
    await env.redis.set(f"heatmap:{floor_id}", orjson.dumps(
        {"floor_id": floor_id, "total_people": 42, "max_density": 1.3,
         "zones": [{"zone_id": zone_id, "count": 12, "density": 0.4}]}).decode())

    assert await run_minute(now) is True
    assert await run_minute(now) is False

    async with env.factory() as db:
        metrics = {(m.scope_type.value, m.metric_name): m.value for m in (await db.execute(select(AnalyticsMetric))).scalars()}
    assert metrics[("camera", "people_avg")] == 14 and metrics[("camera", "people_max")] == 18
    assert metrics[("floor", "people")] == 42 and metrics[("zone", "people")] == 12
    assert metrics[("global", "people")] == 42


async def test_retention_deletes_only_expired_rows(env):
    from app.analytics.rollup import run_retention

    camera = await _seed(env.factory)
    now = datetime.now(timezone.utc)
    async with env.factory() as db:
        for age_days in (1, 30):
            db.add(DetectionFrame(camera_id=camera.id, captured_at=now - timedelta(days=age_days), person_count=1,
                                  density_value=0, avg_confidence=1, inference_ms=0, boxes=[]))
        await db.commit()
    removed = await run_retention(now)
    assert removed["detection_frames"] == 1
    async with env.factory() as db:
        assert len((await db.execute(select(DetectionFrame))).scalars().all()) == 1


async def test_backfill_only_touches_the_demo_building_once(env):
    from app.analytics.backfill import DEMO_BUILDING, backfill, transit_curve

    async with env.factory() as db:
        db.add(Building(name="Real HQ"))
        await db.commit()
    assert await backfill(days=1) == 0, "no demo building, nothing written"

    async with env.factory() as db:
        demo = Building(name=DEMO_BUILDING)
        db.add(demo)
        await db.commit()
    written = await backfill(days=2)
    assert written > 0
    assert await backfill(days=2) == 0, "second run must not duplicate history"

    weekday_rush = transit_curve(datetime(2026, 10, 14, 9, 0))
    weekday_night = transit_curve(datetime(2026, 10, 14, 3, 0))
    assert weekday_rush > 0.8 > 0.1 > weekday_night
