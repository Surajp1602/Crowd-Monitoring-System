"""Turns a frame into tracked people. Real cameras go through YOLO + DeepSORT; the
simulator already knows where everyone is, so its frames carry ground truth and skip
the models entirely (which is what lets the platform run on a machine without a GPU).
"""

import asyncio
from dataclasses import dataclass, field
from typing import Protocol

from app.capture.source import Frame
from app.core.config import get_settings
from app.core.runtime_settings import runtime_settings
from app.detection.types import Detection
from app.tracking.types import TrackedPerson


@dataclass
class PerceptionResult:
    people: list[TrackedPerson]
    objects: list[Detection] = field(default_factory=list)
    avg_confidence: float = 0.0
    inference_ms: float = 0.0


class Perception(Protocol):
    async def perceive(self, frame: Frame) -> PerceptionResult: ...


class GroundTruthPerception:
    async def perceive(self, frame: Frame) -> PerceptionResult:
        people = frame.people or []
        avg = sum(p.confidence for p in people) / len(people) if people else 0.0
        return PerceptionResult(people=people, objects=frame.objects or [], avg_confidence=avg)


class ModelPerception:
    """YOLO detection followed by this camera's own DeepSORT tracker. Thresholds come
    from the camera's config first, then the live settings table, then env defaults."""

    def __init__(self, camera_config: dict | None) -> None:
        from app.detection.yolo_detector import YoloDetector, resolve_device
        from app.tracking.deepsort_tracker import CameraTracker

        settings = get_settings()
        tracking = runtime_settings.tracking
        self._config = camera_config or {}
        self._detector = YoloDetector.shared()
        self._tracker = CameraTracker(
            max_age=int(tracking.get("max_age", 30)),
            n_init=int(tracking.get("n_init", 3)),
            max_iou_distance=float(tracking.get("max_iou_distance", 0.7)),
            max_cosine_distance=float(tracking.get("max_cosine_distance", 0.3)),
            nn_budget=int(tracking.get("nn_budget", 100)),
            embedder_gpu=resolve_device(settings.DEVICE).startswith("cuda"),
        )

    def _threshold(self, key: str, default: float) -> float:
        return float(self._config.get(key, runtime_settings.yolo.get(key, default)))

    async def perceive(self, frame: Frame) -> PerceptionResult:
        settings = get_settings()
        people_dets, bags, inference_ms = await asyncio.to_thread(
            self._detector.detect,
            frame.image,
            self._threshold("confidence_threshold", settings.DEFAULT_CONFIDENCE_THRESHOLD),
            self._threshold("iou_threshold", settings.DEFAULT_IOU_THRESHOLD),
            int(self._threshold("input_size", settings.DEFAULT_INPUT_SIZE)),
        )
        people = await asyncio.to_thread(self._tracker.update, people_dets, frame.image)
        avg = sum(d.confidence for d in people_dets) / len(people_dets) if people_dets else 0.0
        return PerceptionResult(people=people, objects=bags, avg_confidence=avg, inference_ms=inference_ms)
