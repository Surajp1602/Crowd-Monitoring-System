"""Pydantic payloads exchanged over Redis pub/sub between ai-service, backend, and
the WebSocket gateway. Keeping these in the shared package means both producer and
consumer validate against the same contract.
"""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class BoxDTO(BaseModel):
    track_id: int
    global_person_id: Optional[str] = None
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float


class DetectionFrameMessage(BaseModel):
    """Published by ai-service on `stream:detections:{camera_id}` after each processed frame."""

    camera_id: str
    captured_at: datetime
    frame_index: int
    person_count: int
    density_value: float
    avg_confidence: float
    inference_ms: float
    boxes: list[BoxDTO] = Field(default_factory=list)
    jpeg_b64: Optional[str] = None
    """Annotated preview frame, base64 JPEG, downsampled for WS broadcast (not persisted)."""


class TrackUpdateMessage(BaseModel):
    """Published by ai-service on `stream:tracks:{camera_id}` for each active track per frame."""

    camera_id: str
    track_id: int
    global_person_id: str
    ts: datetime
    map_x: float
    map_y: float
    speed_mps: float
    direction_deg: Optional[float] = None
    dwell_time_s: float
    status: Literal["active", "lost", "handed_off"]


class AnomalySignalMessage(BaseModel):
    """Published by ai-service's anomaly module on `stream:anomalies:{camera_id}`."""

    camera_id: str
    zone_id: Optional[str] = None
    alert_type: str
    severity: str
    confidence: float
    ts: datetime
    map_x: Optional[float] = None
    map_y: Optional[float] = None
    description: str
    metadata: dict = Field(default_factory=dict)
    track_ids: list[int] = Field(default_factory=list)


class CameraHealthMessage(BaseModel):
    """Published by ai-service on `stream:health:{camera_id}` at a low frequency heartbeat."""

    camera_id: str
    status: Literal["online", "offline", "error", "starting"]
    fps: float
    latency_ms: float
    ts: datetime
    error: Optional[str] = None
