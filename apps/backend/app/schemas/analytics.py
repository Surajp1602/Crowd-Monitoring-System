import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.schemas.common import ORMModel
from common.enums import MetricScope


class MetricPoint(ORMModel):
    scope_type: MetricScope
    scope_id: Optional[uuid.UUID] = None
    metric_name: str
    value: float
    timestamp: datetime


class MetricIngest(BaseModel):
    scope_type: MetricScope
    scope_id: Optional[uuid.UUID] = None
    metric_name: str
    value: float
    timestamp: Optional[datetime] = None


class DashboardSummary(BaseModel):
    total_people: int
    average_density: float
    highest_density_zone_id: Optional[uuid.UUID] = None
    highest_density_zone_name: Optional[str] = None
    most_active_camera_id: Optional[uuid.UUID] = None
    most_active_camera_name: Optional[str] = None
    cameras_online: int
    cameras_total: int
    open_alerts: int
    critical_alerts: int
    avg_fps: float
    avg_inference_ms: float
