"""Canonical Redis pub/sub channel and key names shared by ai-service, backend, and worker."""


def detections_channel(camera_id: str) -> str:
    return f"stream:detections:{camera_id}"


def tracks_channel(camera_id: str) -> str:
    return f"stream:tracks:{camera_id}"


def anomalies_channel(camera_id: str) -> str:
    return f"stream:anomalies:{camera_id}"


def health_channel(camera_id: str) -> str:
    return f"stream:health:{camera_id}"


ALERTS_CHANNEL = "stream:alerts"
"""Fan-out channel the backend publishes to after persisting a new Alert row."""

CAMERA_COMMANDS_CHANNEL = "stream:camera-commands"
"""Backend -> ai-service control channel: start/stop/reconfigure a camera worker."""

HEATMAP_KEY_PREFIX = "heatmap:"
"""Redis key prefix (+ floor_id) for the latest serialized heatmap grid, set with a TTL."""

CAMERA_HEALTH_KEY_PREFIX = "camera:health:"
"""Redis key prefix (+ camera_id) holding the last-known CameraHealthMessage as a hash."""


def heatmap_channel(floor_id: str) -> str:
    return f"stream:heatmap:{floor_id}"


STREAM_PATTERN = "stream:*"
"""Everything the WebSocket gateway fans out to dashboards lives under this prefix."""

ALERTS_STREAM = "alerts:dispatch"
"""Redis Stream (XADD) of persisted alerts, consumed by the worker's notification
dispatcher through a consumer group so each alert is dispatched exactly once even
with several worker replicas. Pub/sub `stream:alerts` stays the live UI fan-out."""

WORKER_HEARTBEAT_KEY = "worker:heartbeat"
AI_SERVICE_HEARTBEAT_KEY = "ai-service:heartbeat"
