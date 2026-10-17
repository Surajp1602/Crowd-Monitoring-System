import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import ORMModel
from common.enums import ZoneType


class Point(BaseModel):
    x: float
    y: float


class Wall(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


class FloorLayout(BaseModel):
    """Structural geometry for the 3D map. Unknown keys are kept, so the layout can
    grow (doors, stairs, labels) without a migration."""

    model_config = ConfigDict(extra="allow")

    wall_height_m: float = Field(default=4.0, gt=0, le=30)
    walls: list[Wall] = Field(default_factory=list, max_length=2000)
    labels: list[dict] = Field(default_factory=list)


def _validate_polygon(value: list[dict] | None) -> list[dict] | None:
    if value is None:
        return value
    points = [Point.model_validate(p) for p in value]
    if len(points) < 3:
        raise ValueError("A zone polygon needs at least 3 points")
    if len(points) > 200:
        raise ValueError("A zone polygon may have at most 200 points")
    area = abs(sum(p.x * q.y - q.x * p.y for p, q in zip(points, points[1:] + points[:1]))) / 2
    if area < 0.25:
        raise ValueError("A zone polygon must enclose at least 0.25 m²")
    return [p.model_dump() for p in points]


def _validate_layout(value: dict | None) -> dict | None:
    if value is None:
        return value
    return FloorLayout.model_validate(value).model_dump()


class BuildingBase(BaseModel):
    name: str
    description: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class BuildingCreate(BuildingBase):
    pass


class BuildingUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class BuildingRead(BuildingBase, ORMModel):
    id: uuid.UUID


class FloorBase(BaseModel):
    name: str
    level_index: int = 0
    width_m: float = Field(default=100.0, gt=0, le=2000)
    depth_m: float = Field(default=100.0, gt=0, le=2000)
    layout: Optional[dict] = None

    @field_validator("layout")
    @classmethod
    def _check_layout(cls, value: dict | None) -> dict | None:
        return _validate_layout(value)


class FloorCreate(FloorBase):
    building_id: uuid.UUID


class FloorUpdate(BaseModel):
    name: Optional[str] = None
    level_index: Optional[int] = None
    width_m: Optional[float] = Field(default=None, gt=0, le=2000)
    depth_m: Optional[float] = Field(default=None, gt=0, le=2000)
    layout: Optional[dict] = None

    @field_validator("layout")
    @classmethod
    def _check_layout(cls, value: dict | None) -> dict | None:
        return _validate_layout(value)


class FloorRead(FloorBase, ORMModel):
    id: uuid.UUID
    building_id: uuid.UUID


class ZoneBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    zone_type: ZoneType = ZoneType.PUBLIC
    polygon: list[dict]
    color: str = Field(default="#3b82f6", pattern=r"^#[0-9a-fA-F]{6}$")
    capacity_threshold: Optional[int] = Field(default=None, ge=0)
    is_restricted: bool = False

    @field_validator("polygon")
    @classmethod
    def _check_polygon(cls, value: list[dict] | None) -> list[dict] | None:
        return _validate_polygon(value)


class ZoneCreate(ZoneBase):
    floor_id: uuid.UUID


class ZoneUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    zone_type: Optional[ZoneType] = None
    polygon: Optional[list[dict]] = None
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    capacity_threshold: Optional[int] = Field(default=None, ge=0)
    is_restricted: Optional[bool] = None

    @field_validator("polygon")
    @classmethod
    def _check_polygon(cls, value: list[dict] | None) -> list[dict] | None:
        return _validate_polygon(value)


class ZoneRead(ZoneBase, ORMModel):
    id: uuid.UUID
    floor_id: uuid.UUID
