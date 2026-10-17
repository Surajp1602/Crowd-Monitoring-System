import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Enum as SAEnum
from sqlalchemy import DateTime, Float, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from common.enums import TrackStatus
from common.models.base import Base, UUIDPKMixin
from common.models.types import GUID, PortableJSON


class DetectionFrame(Base, UUIDPKMixin):
    """One processed video frame's aggregate detection result for a camera."""

    __tablename__ = "detection_frames"

    camera_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    person_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    density_value: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    """People per square meter within the camera's covered area."""
    avg_confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    inference_ms: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    boxes: Mapped[list] = mapped_column(PortableJSON, default=list, nullable=False)
    """[{track_id, x1, y1, x2, y2, confidence}] in normalized frame coordinates."""


class Track(Base, UUIDPKMixin):
    """A tracked person, scoped to a single camera's local tracker (DeepSORT track)."""

    __tablename__ = "tracks"

    camera_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    local_track_id: Mapped[int] = mapped_column(Integer, nullable=False)
    """The raw DeepSORT track id, unique only within (camera_id, tracker session)."""
    global_person_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    """Cross-camera identity, assigned by the re-identification/handoff logic."""

    status: Mapped[TrackStatus] = mapped_column(
        SAEnum(TrackStatus, name="track_status", values_callable=lambda e: [m.value for m in e]),
        default=TrackStatus.ACTIVE,
        nullable=False,
        index=True,
    )
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    dwell_time_s: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    last_map_x: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_map_y: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_speed_mps: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    last_direction_deg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    appearance_embedding: Mapped[Optional[list]] = mapped_column(PortableJSON, nullable=True)
    """ReID feature vector used to match this track across cameras."""

    points: Mapped[list["TrackPoint"]] = relationship(
        back_populates="track", cascade="all, delete-orphan", order_by="TrackPoint.ts"
    )


class TrackPoint(Base, UUIDPKMixin):
    """A single trajectory sample for a track, used for speed/direction/path analysis."""

    __tablename__ = "track_points"

    track_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    map_x: Mapped[float] = mapped_column(Float, nullable=False)
    map_y: Mapped[float] = mapped_column(Float, nullable=False)
    bbox: Mapped[list] = mapped_column(PortableJSON, nullable=False)
    speed_mps: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    direction_deg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    track: Mapped["Track"] = relationship(back_populates="points")
