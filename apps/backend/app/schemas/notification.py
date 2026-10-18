import re
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.schemas.common import ORMModel
from common.enums import NotificationChannel, NotificationStatus

E164 = re.compile(r"^\+[1-9]\d{6,14}$")


class NotificationHistoryRead(ORMModel):
    id: uuid.UUID
    alert_id: Optional[uuid.UUID] = None
    channel: NotificationChannel
    recipient: str
    status: NotificationStatus
    provider: str
    provider_response: dict = Field(default_factory=dict)
    sent_at: Optional[datetime] = None
    created_at: datetime


PUBLIC_CHANNELS = {NotificationChannel.PUSH, NotificationChannel.SMS, NotificationChannel.WHATSAPP, NotificationChannel.EMAIL}


class GeofenceSubscriptionCreate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=255)
    device_token: Optional[str] = Field(default=None, max_length=512)
    phone_number: Optional[str] = None
    email: Optional[EmailStr] = None
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    radius_m: float = Field(default=200.0, ge=25, le=5000)
    channels: list[NotificationChannel] = Field(min_length=1, max_length=4)

    @field_validator("phone_number")
    @classmethod
    def _e164(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        value = re.sub(r"[\s\-()]", "", value)
        if not E164.match(value):
            raise ValueError("Use international format, e.g. +919812345678")
        return value

    @model_validator(mode="after")
    def _contact_for_each_channel(self):
        if set(self.channels) - PUBLIC_CHANNELS:
            raise ValueError("Public subscriptions support push, SMS, WhatsApp and email")
        needs = {
            NotificationChannel.SMS: self.phone_number,
            NotificationChannel.WHATSAPP: self.phone_number,
            NotificationChannel.EMAIL: self.email,
            NotificationChannel.PUSH: self.device_token,
        }
        missing = [c.value for c in self.channels if not needs[c]]
        if missing:
            raise ValueError(f"Missing contact details for: {', '.join(missing)}")
        return self


class GeofenceSubscriptionRead(ORMModel):
    """Contact details are masked: operators can see coverage, not harvest numbers."""

    id: uuid.UUID
    display_name: Optional[str] = None
    latitude: float
    longitude: float
    radius_m: float
    channels: list[str]
    contact: str = ""
    is_active: bool
    created_at: datetime


class GeofenceSubscriptionCreated(GeofenceSubscriptionRead):
    unsubscribe_token: str
    """Returned exactly once, to the subscriber, so they can unsubscribe later."""


class TestNotification(BaseModel):
    channel: NotificationChannel
    recipient: str = Field(min_length=3, max_length=512)
    message: Optional[str] = Field(default=None, max_length=500)
