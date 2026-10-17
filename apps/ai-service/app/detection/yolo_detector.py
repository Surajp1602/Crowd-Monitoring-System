"""YOLO detector wrapping Ultralytics. Loaded once per process and shared across all
camera workers; inference is serialized behind a lock so concurrent camera threads
never interleave forward passes on the same model.

torch and ultralytics are imported lazily: they are large, GPU-specific dependencies
that the simulator, the unit tests and any CPU-only tooling never need.
"""

import logging
import threading

import numpy as np

from app.core.config import get_settings
from app.detection.types import Detection

logger = logging.getLogger("ccd.ai.detection")

COCO_PERSON_CLASS_ID = 0
COCO_BAG_CLASS_IDS = (24, 26, 28)
"""backpack, handbag, suitcase: the objects abandoned-object detection watches."""


def resolve_device(requested: str) -> str:
    if requested != "auto":
        return requested
    try:
        import torch
    except ImportError:
        return "cpu"
    return "cuda:0" if torch.cuda.is_available() else "cpu"


class YoloDetector:
    _instance: "YoloDetector | None" = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        from ultralytics import YOLO

        settings = get_settings()
        self.device = resolve_device(settings.DEVICE)
        logger.info("Loading YOLO model %s on device %s", settings.YOLO_MODEL, self.device)
        self.model = YOLO(settings.YOLO_MODEL)
        self.model.to(self.device)
        self._infer_lock = threading.Lock()

    @classmethod
    def shared(cls) -> "YoloDetector":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def detect(
        self,
        image: np.ndarray,
        confidence_threshold: float,
        iou_threshold: float,
        input_size: int,
    ) -> tuple[list[Detection], list[Detection], float]:
        """Runs inference and returns (people, bags, inference time in ms)."""
        with self._infer_lock:
            results = self.model.predict(
                image,
                classes=[COCO_PERSON_CLASS_ID, *COCO_BAG_CLASS_IDS],
                conf=confidence_threshold,
                iou=iou_threshold,
                imgsz=input_size,
                device=self.device,
                verbose=False,
            )
        result = results[0]
        inference_ms = float(result.speed.get("inference", 0.0)) if result.speed else 0.0

        people: list[Detection] = []
        bags: list[Detection] = []
        if result.boxes is not None:
            for box in result.boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                class_id = int(box.cls[0])
                det = Detection(x1=x1, y1=y1, x2=x2, y2=y2, confidence=float(box.conf[0]), class_id=class_id)
                (people if class_id == COCO_PERSON_CLASS_ID else bags).append(det)
        return people, bags, inference_ms
