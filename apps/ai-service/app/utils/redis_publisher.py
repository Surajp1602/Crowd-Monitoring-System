from functools import lru_cache

import redis.asyncio as redis

from common.redis_channels import (
    CAMERA_HEALTH_KEY_PREFIX,
    HEATMAP_KEY_PREFIX,
    detections_channel,
    health_channel,
    heatmap_channel,
    tracks_channel,
)
from common.schemas import CameraHealthMessage, DetectionFrameMessage, HeatmapFrameMessage, TrackUpdateMessage

from app.core.config import get_settings


@lru_cache
def get_redis() -> redis.Redis:
    settings = get_settings()
    return redis.from_url(settings.REDIS_URL, decode_responses=True, socket_connect_timeout=3)


async def publish_detection_frame(message: DetectionFrameMessage) -> None:
    r = get_redis()
    await r.publish(detections_channel(message.camera_id), message.model_dump_json())


async def publish_track_update(message: TrackUpdateMessage) -> None:
    r = get_redis()
    await r.publish(tracks_channel(message.camera_id), message.model_dump_json())


async def publish_camera_health(message: CameraHealthMessage) -> None:
    r = get_redis()
    payload = message.model_dump_json()
    await r.publish(health_channel(message.camera_id), payload)
    await r.set(f"{CAMERA_HEALTH_KEY_PREFIX}{message.camera_id}", payload, ex=60)


async def publish_heatmap(message: HeatmapFrameMessage) -> None:
    r = get_redis()
    payload = message.model_dump_json()
    await r.publish(heatmap_channel(message.floor_id), payload)
    await r.set(f"{HEATMAP_KEY_PREFIX}{message.floor_id}", payload, ex=30)
