import uuid
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from common.enums import ZoneType


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
    width_m: float = 100.0
    depth_m: float = 100.0
    layout: Optional[dict] = None


class FloorCreate(FloorBase):
    building_id: uuid.UUID


class FloorUpdate(BaseModel):
    name: Optional[str] = None
    level_index: Optional[int] = None
    width_m: Optional[float] = None
    depth_m: Optional[float] = None
    layout: Optional[dict] = None


class FloorRead(FloorBase, ORMModel):
    id: uuid.UUID
    building_id: uuid.UUID


class ZoneBase(BaseModel):
    name: str
    zone_type: ZoneType = ZoneType.PUBLIC
    polygon: list[dict] = Field(default_factory=list)
    color: str = "#3b82f6"
    capacity_threshold: Optional[int] = None
    is_restricted: bool = False


class ZoneCreate(ZoneBase):
    floor_id: uuid.UUID


class ZoneUpdate(BaseModel):
    name: Optional[str] = None
    zone_type: Optional[ZoneType] = None
    polygon: Optional[list[dict]] = None
    color: Optional[str] = None
    capacity_threshold: Optional[int] = None
    is_restricted: Optional[bool] = None


class ZoneRead(ZoneBase, ORMModel):
    id: uuid.UUID
    floor_id: uuid.UUID
