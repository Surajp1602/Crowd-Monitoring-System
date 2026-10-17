import logging
import uuid
from datetime import datetime, timedelta, timezone

import orjson
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from common.enums import AlertSeverity, AlertStatus, AlertType, EventType
from common.models import Alert, Camera, Event
from common.redis_channels import ALERTS_CHANNEL, ALERTS_STREAM

from app.core.media import sign_media_path
from app.core.redis import get_redis, publish_event
from app.repositories.entities import AlertRepository
from app.schemas.alert import AlertCreate, AlertRead

logger = logging.getLogger("ccd.alerts")

ALERTS_STREAM_MAXLEN = 10_000


def to_read(alert: Alert) -> AlertRead:
    """API representation: the stored relative snapshot path becomes a signed URL."""
    read = AlertRead.model_validate(alert)
    read.snapshot_url = sign_media_path(alert.snapshot_url)
    read.clip_url = sign_media_path(alert.clip_url)
    return read


def alert_event_payload(alert: Alert, event: str) -> dict:
    return {
        "event": event,
        "id": str(alert.id),
        "camera_id": str(alert.camera_id) if alert.camera_id else None,
        "zone_id": str(alert.zone_id) if alert.zone_id else None,
        "alert_type": alert.alert_type.value,
        "severity": alert.severity.value,
        "status": alert.status.value,
        "title": alert.title,
        "description": alert.description,
        "confidence": alert.confidence,
        "map_x": alert.map_x,
        "map_y": alert.map_y,
        "floor_id": (alert.metadata_json or {}).get("floor_id"),
        "snapshot_url": sign_media_path(alert.snapshot_url),
        "created_at": alert.created_at.isoformat(),
    }


async def _enqueue_dispatch(alert: Alert) -> None:
    """Durable hand-off to the notification dispatcher (Redis Stream + consumer group),
    separate from the best-effort live pub/sub fan-out."""
    try:
        await get_redis().xadd(
            ALERTS_STREAM,
            {"alert_id": str(alert.id), "payload": orjson.dumps(alert_event_payload(alert, "alert.created")).decode()},
            maxlen=ALERTS_STREAM_MAXLEN,
            approximate=True,
        )
    except Exception:  # noqa: BLE001 - the alert is persisted; the worker also sweeps for undispatched alerts
        logger.warning("Could not enqueue alert %s for dispatch", alert.id, exc_info=True)


GROUP_WINDOW = timedelta(minutes=10)
"""A repeat of the same alert type on the same camera and zone within this long of the last
occurrence joins the open alert instead of raising a new one."""

SEVERITY_RANK = {AlertSeverity.LOW: 0, AlertSeverity.MEDIUM: 1, AlertSeverity.HIGH: 2, AlertSeverity.CRITICAL: 3}


def _aware(ts: datetime) -> datetime:
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


async def _find_group(db: AsyncSession, payload: AlertCreate, now: datetime) -> Alert | None:
    if payload.alert_type == AlertType.CAMERA_OFFLINE:
        return None
    query = (
        select(Alert)
        .where(
            Alert.alert_type == payload.alert_type,
            Alert.status.in_((AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED)),
            Alert.camera_id.is_(None) if payload.camera_id is None else Alert.camera_id == payload.camera_id,
            Alert.zone_id.is_(None) if payload.zone_id is None else Alert.zone_id == payload.zone_id,
        )
        .order_by(Alert.created_at.desc())
        .limit(1)
    )
    alert = (await db.execute(query)).scalar_one_or_none()
    if alert is None:
        return None
    last_seen = (alert.metadata_json or {}).get("last_seen_at")
    last = _aware(datetime.fromisoformat(last_seen)) if last_seen else _aware(alert.created_at)
    return alert if now - last <= GROUP_WINDOW else None


async def _join_group(db: AsyncSession, alert: Alert, payload: AlertCreate, now: datetime) -> Alert:
    """Counts the repeat on the open alert. Only an escalation in severity notifies again."""
    escalated = SEVERITY_RANK[payload.severity] > SEVERITY_RANK[alert.severity]
    meta = dict(alert.metadata_json or {})
    meta["occurrences"] = int(meta.get("occurrences", 1)) + 1
    meta["last_seen_at"] = now.isoformat()
    fields: dict = {"metadata_json": meta, "confidence": max(alert.confidence, payload.confidence)}
    if escalated:
        fields.update(severity=payload.severity, title=payload.title, description=payload.description)
    if payload.snapshot_url:
        fields["snapshot_url"] = payload.snapshot_url
    if payload.map_x is not None and payload.map_y is not None:
        fields.update(map_x=payload.map_x, map_y=payload.map_y)
    alert = await AlertRepository(db).update(alert, **fields)
    await db.commit()
    await db.refresh(alert)
    await publish_event(ALERTS_CHANNEL, alert_event_payload(alert, "alert.updated"))
    if escalated:
        await _enqueue_dispatch(alert)
    return alert


async def create_alert(db: AsyncSession, payload: AlertCreate) -> Alert:
    now = datetime.now(timezone.utc)
    existing = await _find_group(db, payload, now)
    if existing is not None:
        return await _join_group(db, existing, payload, now)

    event = Event(
        camera_id=payload.camera_id,
        zone_id=payload.zone_id,
        event_type=EventType.ANOMALY,
        payload={
            "alert_type": payload.alert_type.value,
            "severity": payload.severity.value,
            "confidence": payload.confidence,
            "map_x": payload.map_x,
            "map_y": payload.map_y,
            **{k: v for k, v in payload.metadata.items() if k in ("track_ids", "floor_id")},
        },
        occurred_at=now,
    )
    db.add(event)
    await db.flush()

    repo = AlertRepository(db)
    data = payload.model_dump(exclude={"metadata"})
    alert = await repo.create(**data, metadata_json=payload.metadata, event_id=event.id)
    await db.commit()
    await db.refresh(alert)
    await publish_event(ALERTS_CHANNEL, alert_event_payload(alert, "alert.created"))
    await _enqueue_dispatch(alert)
    return alert


async def get_alert_or_404(db: AsyncSession, alert_id: uuid.UUID) -> Alert:
    alert = await AlertRepository(db).get(alert_id)
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    return alert


async def set_alert_status(db: AsyncSession, alert: Alert, new_status: AlertStatus, user_id: uuid.UUID | None) -> Alert:
    repo = AlertRepository(db)
    fields: dict = {"status": new_status}
    now = datetime.now(timezone.utc)
    if new_status == AlertStatus.ACKNOWLEDGED:
        fields["acknowledged_by"] = user_id
        fields["acknowledged_at"] = now
    elif new_status in (AlertStatus.RESOLVED, AlertStatus.FALSE_POSITIVE):
        fields["resolved_at"] = now
        if alert.acknowledged_at is None:
            fields["acknowledged_by"] = user_id
            fields["acknowledged_at"] = now
    elif new_status == AlertStatus.OPEN:
        fields.update(acknowledged_by=None, acknowledged_at=None, resolved_at=None)
    alert = await repo.update(alert, **fields)
    await db.commit()
    await db.refresh(alert)
    await publish_event(ALERTS_CHANNEL, alert_event_payload(alert, "alert.updated"))
    return alert


# ---- camera connectivity alerts ------------------------------------------------


async def on_camera_status_change(db: AsyncSession, camera: Camera, previous: str, current: str, error: str | None) -> None:
    """A stream failure raises one camera-offline alert; recovery resolves it.

    Only `error` counts as a failure: workers report `offline` on deliberate stops
    (restarts after a config change, shutdown), which must not page anyone.
    """
    open_stmt = select(Alert).where(
        Alert.camera_id == camera.id,
        Alert.alert_type == AlertType.CAMERA_OFFLINE,
        Alert.status.in_([AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED]),
    )
    existing = (await db.execute(open_stmt)).scalars().all()

    if current == "error" and previous != "error" and not existing:
        await create_alert(
            db,
            AlertCreate(
                camera_id=camera.id,
                zone_id=camera.zone_id,
                alert_type=AlertType.CAMERA_OFFLINE,
                severity=AlertSeverity.MEDIUM,
                title=f"Camera unavailable: {camera.name}",
                description=error or "The stream stopped delivering frames.",
                map_x=camera.map_x,
                map_y=camera.map_y,
                confidence=1.0,
                metadata={"camera_code": camera.code, "floor_id": str(camera.floor_id) if camera.floor_id else None},
            ),
        )
    elif current == "online" and existing:
        for alert in existing:
            await set_alert_status(db, alert, AlertStatus.RESOLVED, None)


async def alert_stats(db: AsyncSession, hours: int) -> dict:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    async def grouped(column) -> dict[str, int]:
        rows = await db.execute(select(column, func.count()).where(Alert.created_at >= since).group_by(column))
        return {k.value: v for k, v in rows.all()}

    total = (await db.execute(select(func.count()).select_from(Alert).where(Alert.created_at >= since))).scalar_one()
    return {
        "window_hours": hours,
        "total": total,
        "by_status": await grouped(Alert.status),
        "by_severity": await grouped(Alert.severity),
        "by_type": await grouped(Alert.alert_type),
    }
