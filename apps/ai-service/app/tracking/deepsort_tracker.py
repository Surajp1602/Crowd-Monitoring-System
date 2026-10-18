"""Per-camera DeepSORT tracker. Each camera gets its own tracker instance because
track identity/state (Kalman filters, appearance gallery) must not leak between
independent camera feeds — cross-camera identity is a separate re-identification
step (see app/tracking/identity.py), not something DeepSORT itself does.
"""

import numpy as np

from app.detection.types import Detection
from app.tracking.types import TrackedPerson


class CameraTracker:
    def __init__(
        self,
        max_age: int = 30,
        n_init: int = 3,
        max_iou_distance: float = 0.7,
        max_cosine_distance: float = 0.3,
        nn_budget: int = 100,
        embedder_gpu: bool = False,
    ):
        from deep_sort_realtime.deepsort_tracker import DeepSort

        self._tracker = DeepSort(
            max_age=max_age,
            n_init=n_init,
            max_iou_distance=max_iou_distance,
            max_cosine_distance=max_cosine_distance,
            nn_budget=nn_budget,
            embedder="mobilenet",
            half=True,
            bgr=True,
            embedder_gpu=embedder_gpu,
        )

    def update(self, detections: list[Detection], frame: np.ndarray) -> list[TrackedPerson]:
        raw = [
            ([d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1], d.confidence, "person") for d in detections
        ]
        raw_tracks = self._tracker.update_tracks(raw, frame=frame)

        people: list[TrackedPerson] = []
        for t in raw_tracks:
            if not t.is_confirmed():
                continue
            x1, y1, x2, y2 = t.to_ltrb()
            people.append(
                TrackedPerson(
                    track_id=_stable_int_id(t.track_id),
                    x1=float(x1),
                    y1=float(y1),
                    x2=float(x2),
                    y2=float(y2),
                    confidence=float(t.get_det_conf() or 0.0),
                    confirmed=True,
                )
            )
        return people


def _stable_int_id(raw_id: object) -> int:
    """DeepSORT ids are numeric strings; fall back to a process-stable hash otherwise."""
    text = str(raw_id)
    if text.isdigit():
        return int(text)
    return abs(hash(text)) % 10_000_000
