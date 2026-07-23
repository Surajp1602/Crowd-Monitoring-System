import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from common.enums import CameraStatus, StreamType


class CameraBase(BaseModel):
    code: str = Field(min_length=2, max_length=50)
    name: str
    description: Optional[str] = None
    stream_type: StreamType
    stream_url: str
    stream_username: Optional[str] = None
    onvif_port: Optional[int] = None

    building_id: Optional[uuid.UUID] = None
    floor_id: Optional[uuid.UUID] = None
    zone_id: Optional[uuid.UUID] = None

    latitude: Optional[float] = None
    longitude: Optional[float] = None
    map_x: float = 0.0
    map_y: float = 0.0
    map_z: float = 2.5
    orientation_deg: float = 0.0
    tilt_deg: float = 0.0
    fov_deg: float = 90.0
    range_m: float = 15.0

    config: dict = Field(default_factory=dict)
    is_active: bool = True


class CameraCreate(CameraBase):
    stream_password: Optional[str] = None


class CameraUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    stream_type: Optional[StreamType] = None
    stream_url: Optional[str] = None
    stream_username: Optional[str] = None
    stream_password: Optional[str] = None
    onvif_port: Optional[int] = None
    building_id: Optional[uuid.UUID] = None
    floor_id: Optional[uuid.UUID] = None
    zone_id: Optional[uuid.UUID] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    map_x: Optional[float] = None
    map_y: Optional[float] = None
    map_z: Optional[float] = None
    orientation_deg: Optional[float] = None
    tilt_deg: Optional[float] = None
    fov_deg: Optional[float] = None
    range_m: Optional[float] = None
    config: Optional[dict] = None
    is_active: Optional[bool] = None


class CameraRead(ORMModel):
    id: uuid.UUID
    code: str
    name: str
    description: Optional[str] = None
    stream_type: StreamType
    stream_url: str
    stream_username: Optional[str] = None
    onvif_port: Optional[int] = None
    building_id: Optional[uuid.UUID] = None
    floor_id: Optional[uuid.UUID] = None
    zone_id: Optional[uuid.UUID] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    map_x: float
    map_y: float
    map_z: float
    orientation_deg: float
    tilt_deg: float
    fov_deg: float
    range_m: float
    status: CameraStatus
    fps: float
    latency_ms: float
    last_seen_at: Optional[datetime] = None
    last_error: Optional[str] = None
    config: dict
    is_active: bool
    created_at: datetime


class CameraHealthUpdate(BaseModel):
    status: CameraStatus
    fps: float
    latency_ms: float
    error: Optional[str] = None
