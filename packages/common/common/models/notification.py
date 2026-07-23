import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Enum as SAEnum
from sqlalchemy import DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import ForeignKey

from common.enums import NotificationChannel, NotificationStatus
from common.models.base import Base, TimestampMixin, UUIDPKMixin
from common.models.types import GUID, PortableJSON


class NotificationHistory(Base, UUIDPKMixin):
    __tablename__ = "notification_history"

    alert_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(), ForeignKey("alerts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    channel: Mapped[NotificationChannel] = mapped_column(
        SAEnum(NotificationChannel, name="notification_channel", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        index=True,
    )
    recipient: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[NotificationStatus] = mapped_column(
        SAEnum(NotificationStatus, name="notification_status", values_callable=lambda e: [m.value for m in e]),
        default=NotificationStatus.PENDING,
        nullable=False,
        index=True,
    )
    provider: Mapped[str] = mapped_column(String(100), nullable=False)
    provider_response: Mapped[dict] = mapped_column(PortableJSON, default=dict, nullable=False)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class GeofenceSubscription(Base, UUIDPKMixin, TimestampMixin):
    """A public/subscriber endpoint that receives alerts when inside a geofenced radius."""

    __tablename__ = "geofence_subscriptions"

    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    device_token: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    phone_number: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    radius_m: Mapped[float] = mapped_column(Float, default=200.0, nullable=False)
    channels: Mapped[list] = mapped_column(PortableJSON, default=list, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
