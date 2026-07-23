import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from common.enums import NotificationChannel, NotificationStatus


class NotificationHistoryRead(ORMModel):
    id: uuid.UUID
    alert_id: Optional[uuid.UUID] = None
    channel: NotificationChannel
    recipient: str
    status: NotificationStatus
    provider: str
    sent_at: Optional[datetime] = None
    created_at: datetime


class GeofenceSubscriptionCreate(BaseModel):
    display_name: Optional[str] = None
    device_token: Optional[str] = None
    phone_number: Optional[str] = None
    email: Optional[str] = None
    latitude: float
    longitude: float
    radius_m: float = 200.0
    channels: list[NotificationChannel] = Field(default_factory=lambda: [NotificationChannel.PUSH])


class GeofenceSubscriptionRead(ORMModel):
    id: uuid.UUID
    display_name: Optional[str] = None
    latitude: float
    longitude: float
    radius_m: float
    channels: list[str]
    is_active: bool
    created_at: datetime
