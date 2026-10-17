import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Enum as SAEnum
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from common.enums import CameraStatus, StreamType
from common.models.base import Base, TimestampMixin, UUIDPKMixin
from common.models.types import GUID, PortableJSON

if TYPE_CHECKING:
    from common.models.map import Building, Floor, Zone


class Camera(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "cameras"

    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    stream_type: Mapped[StreamType] = mapped_column(
        SAEnum(StreamType, name="stream_type", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    stream_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    stream_username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    stream_password_encrypted: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    onvif_port: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    building_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(), ForeignKey("buildings.id", ondelete="SET NULL"), nullable=True
    )
    floor_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(), ForeignKey("floors.id", ondelete="SET NULL"), nullable=True
    )
    zone_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(), ForeignKey("zones.id", ondelete="SET NULL"), nullable=True
    )

    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    map_x: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    map_y: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    map_z: Mapped[float] = mapped_column(Float, default=2.5, nullable=False)
    orientation_deg: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    """Yaw angle in degrees the camera faces, on the floor plane."""
    tilt_deg: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    fov_deg: Mapped[float] = mapped_column(Float, default=90.0, nullable=False)
    range_m: Mapped[float] = mapped_column(Float, default=15.0, nullable=False)

    status: Mapped[CameraStatus] = mapped_column(
        SAEnum(CameraStatus, name="camera_status", values_callable=lambda e: [m.value for m in e]),
        default=CameraStatus.OFFLINE,
        nullable=False,
        index=True,
    )
    fps: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    config: Mapped[dict] = mapped_column(PortableJSON, default=dict, nullable=False)
    """Per-camera AI settings: confidence threshold, frame skip, enabled detectors, etc."""

    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    building: Mapped[Optional["Building"]] = relationship()
    floor: Mapped[Optional["Floor"]] = relationship()
    zone: Mapped[Optional["Zone"]] = relationship()
