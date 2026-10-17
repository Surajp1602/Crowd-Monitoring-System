import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from common.enums import AlertStatus
from common.models import Alert
from common.redis_channels import ALERTS_CHANNEL

from app.core.redis import publish_event
from app.repositories.entities import AlertRepository
from app.schemas.alert import AlertCreate


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
        "snapshot_url": alert.snapshot_url,
        "created_at": alert.created_at.isoformat(),
    }


async def create_alert(db: AsyncSession, payload: AlertCreate) -> Alert:
    repo = AlertRepository(db)
    data = payload.model_dump(exclude={"metadata"})
    alert = await repo.create(**data, metadata_json=payload.metadata)
    await db.commit()
    await db.refresh(alert)
    await publish_event(ALERTS_CHANNEL, alert_event_payload(alert, "alert.created"))
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
    alert = await repo.update(alert, **fields)
    await db.commit()
    await db.refresh(alert)
    await publish_event(ALERTS_CHANNEL, alert_event_payload(alert, "alert.updated"))
    return alert
