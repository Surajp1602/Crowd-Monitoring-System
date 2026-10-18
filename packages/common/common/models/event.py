import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Enum as SAEnum
from sqlalchemy import DateTime, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from common.enums import AlertSeverity, AlertStatus, AlertType, EventType
from common.models.base import Base, TimestampMixin, UUIDPKMixin
from common.models.types import GUID, PortableJSON


class Event(Base, UUIDPKMixin):
    """Low-level occurrence log: entries, exits, zone crossings, handoffs, anomalies."""

    __tablename__ = "events"

    camera_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(), ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True, index=True
    )
    zone_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(), ForeignKey("zones.id", ondelete="SET NULL"), nullable=True, index=True
    )
    track_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(), ForeignKey("tracks.id", ondelete="SET NULL"), nullable=True
    )
    event_type: Mapped[EventType] = mapped_column(
        SAEnum(EventType, name="event_type", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        index=True,
    )
    payload: Mapped[dict] = mapped_column(PortableJSON, default=dict, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)


class Alert(Base, UUIDPKMixin, TimestampMixin):
    """Actionable anomaly requiring operator attention and/or public notification."""

    __tablename__ = "alerts"

    event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(), ForeignKey("events.id", ondelete="SET NULL"), nullable=True
    )
    camera_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(), ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True, index=True
    )
    zone_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(), ForeignKey("zones.id", ondelete="SET NULL"), nullable=True
    )
    alert_type: Mapped[AlertType] = mapped_column(
        SAEnum(AlertType, name="alert_type", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        index=True,
    )
    severity: Mapped[AlertSeverity] = mapped_column(
        SAEnum(AlertSeverity, name="alert_severity", values_callable=lambda e: [m.value for m in e]),
        default=AlertSeverity.MEDIUM,
        nullable=False,
        index=True,
    )
    status: Mapped[AlertStatus] = mapped_column(
        SAEnum(AlertStatus, name="alert_status", values_callable=lambda e: [m.value for m in e]),
        default=AlertStatus.OPEN,
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    map_x: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    map_y: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    snapshot_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    clip_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(PortableJSON, default=dict, nullable=False)

    acknowledged_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
