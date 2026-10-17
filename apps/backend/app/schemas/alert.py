import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from common.enums import AlertSeverity, AlertStatus, AlertType, EventType


class AlertRead(ORMModel):
    id: uuid.UUID
    camera_id: Optional[uuid.UUID] = None
    zone_id: Optional[uuid.UUID] = None
    alert_type: AlertType
    severity: AlertSeverity
    status: AlertStatus
    title: str
    description: Optional[str] = None
    map_x: Optional[float] = None
    map_y: Optional[float] = None
    confidence: float
    snapshot_url: Optional[str] = None
    clip_url: Optional[str] = None
    acknowledged_by: Optional[uuid.UUID] = None
    acknowledged_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    metadata_json: dict = Field(default_factory=dict, serialization_alias="metadata")
    created_at: datetime


class AlertCreate(BaseModel):
    """Used by the internal ingest endpoint that ai-service calls for anomalies
    it cannot simply publish and forget (i.e. everything requiring persistence)."""

    camera_id: Optional[uuid.UUID] = None
    zone_id: Optional[uuid.UUID] = None
    alert_type: AlertType
    severity: AlertSeverity = AlertSeverity.MEDIUM
    title: str
    description: Optional[str] = None
    map_x: Optional[float] = None
    map_y: Optional[float] = None
    confidence: float = 0.0
    snapshot_url: Optional[str] = None
    clip_url: Optional[str] = None
    metadata: dict = Field(default_factory=dict)


class AlertUpdateStatus(BaseModel):
    status: AlertStatus


class AlertBulkStatus(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    status: AlertStatus


class EventRead(ORMModel):
    id: uuid.UUID
    camera_id: Optional[uuid.UUID] = None
    zone_id: Optional[uuid.UUID] = None
    track_id: Optional[uuid.UUID] = None
    event_type: EventType
    payload: dict
    occurred_at: datetime
