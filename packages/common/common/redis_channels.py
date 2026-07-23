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
