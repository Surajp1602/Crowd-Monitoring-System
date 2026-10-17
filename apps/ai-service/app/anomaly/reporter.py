"""Turns an AnomalyEvent into its three outputs: an evidence snapshot on the shared
media volume, a live `stream:anomalies:*` signal for dashboards, and a persisted Alert
via the backend's internal ingest endpoint (which handles fan-out and notifications)."""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from common.schemas import AnomalySignalMessage

from app.anomaly.engine import AnomalyEvent
from app.core.config import get_settings
from app.pipeline.analysis import FrameAnalysis
from app.pipeline.context import CameraContext
from app.pipeline.preview import annotate_evidence, encode_jpeg
from app.utils.backend_client import backend_client
from app.utils.redis_publisher import publish_anomaly

logger = logging.getLogger("ccd.ai.anomaly")


def _write_snapshot(image: np.ndarray, analysis: FrameAnalysis, event: AnomalyEvent) -> str | None:
    """Writes the evidence JPEG and returns its path relative to the media root."""
    now = datetime.now(timezone.utc)
    relative = Path("alerts") / now.strftime("%Y/%m/%d") / f"{uuid.uuid4().hex}.jpg"
    target = Path(get_settings().MEDIA_DIR) / relative
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(encode_jpeg(annotate_evidence(image, analysis, set(event.track_ids), event.title)))
    except OSError:
        logger.warning("Could not write alert snapshot to %s", target, exc_info=True)
        return None
    return relative.as_posix()


class AnomalyReporter:
    def __init__(self, context: CameraContext) -> None:
        self.context = context
        self._pending: set[asyncio.Task] = set()

    async def report(self, event: AnomalyEvent, image: np.ndarray, analysis: FrameAnalysis) -> None:
        camera_id = self.context.camera_id
        await publish_anomaly(
            AnomalySignalMessage(
                camera_id=camera_id,
                zone_id=str(event.zone_id) if event.zone_id else None,
                alert_type=event.alert_type.value,
                severity=event.severity.value,
                confidence=round(event.confidence, 3),
                ts=analysis.captured_at,
                map_x=event.map_x,
                map_y=event.map_y,
                description=event.description,
                metadata=event.metadata,
                track_ids=event.track_ids,
            )
        )
        # Snapshot encoding and the HTTP round trip run off the frame loop.
        task = asyncio.create_task(self._persist(event, image.copy(), analysis))
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def _persist(self, event: AnomalyEvent, image: np.ndarray, analysis: FrameAnalysis) -> None:
        snapshot = await asyncio.to_thread(_write_snapshot, image, analysis, event)
        floor = self.context.floor
        await backend_client.create_alert(
            {
                "camera_id": self.context.camera_id,
                "zone_id": str(event.zone_id) if event.zone_id else None,
                "alert_type": event.alert_type.value,
                "severity": event.severity.value,
                "title": event.title,
                "description": event.description,
                "map_x": event.map_x,
                "map_y": event.map_y,
                "confidence": round(event.confidence, 3),
                "snapshot_url": snapshot,
                "metadata": {
                    **event.metadata,
                    "track_ids": event.track_ids,
                    "floor_id": str(floor.id) if floor else None,
                    "people_in_view": analysis.person_count,
                },
            }
        )

    async def drain(self) -> None:
        if self._pending:
            await asyncio.gather(*self._pending, return_exceptions=True)
