import uuid
from typing import Optional

from sqlalchemy import Enum as SAEnum
from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from common.enums import ZoneType
from common.models.base import Base, TimestampMixin, UUIDPKMixin
from common.models.types import GUID, PortableJSON


class Building(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "buildings"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    floors: Mapped[list["Floor"]] = relationship(back_populates="building", cascade="all, delete-orphan")


class Floor(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "floors"

    building_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("buildings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    level_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    width_m: Mapped[float] = mapped_column(Float, default=100.0, nullable=False)
    depth_m: Mapped[float] = mapped_column(Float, default=100.0, nullable=False)
    layout: Mapped[Optional[dict]] = mapped_column(PortableJSON, nullable=True)
    """Structural geometry for the 3D map: rooms, corridors, entrances, walls."""

    building: Mapped["Building"] = relationship(back_populates="floors")
    zones: Mapped[list["Zone"]] = relationship(back_populates="floor", cascade="all, delete-orphan")


class Zone(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "zones"

    floor_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("floors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    zone_type: Mapped[ZoneType] = mapped_column(
        SAEnum(ZoneType, name="zone_type", values_callable=lambda e: [m.value for m in e]),
        default=ZoneType.PUBLIC,
        nullable=False,
    )
    polygon: Mapped[list] = mapped_column(PortableJSON, nullable=False, default=list)
    """List of {x, y} points in floor-local meters describing the zone footprint."""
    color: Mapped[str] = mapped_column(String(20), default="#3b82f6", nullable=False)
    capacity_threshold: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_restricted: Mapped[bool] = mapped_column(default=False, nullable=False)

    floor: Mapped["Floor"] = relationship(back_populates="zones")
