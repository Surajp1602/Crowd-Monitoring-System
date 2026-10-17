"""Annotated, downsampled JPEG previews for the live camera wall. Sent inline over the
WebSocket a couple of times a second; never persisted."""

import base64

import cv2
import numpy as np

from app.pipeline.analysis import FrameAnalysis

PREVIEW_MAX_WIDTH = 640
PREVIEW_JPEG_QUALITY = 70


def _speed_color(speed_mps: float) -> tuple[int, int, int]:
    """BGR: calm walkers in cyan, fast movers shift to amber then red."""
    if speed_mps >= 3.0:
        return (60, 60, 235)
    if speed_mps >= 2.0:
        return (40, 170, 245)
    return (230, 200, 60)


def annotate(image: np.ndarray, analysis: FrameAnalysis) -> np.ndarray:
    out = image.copy()
    for obs in analysis.observations:
        p = obs.person
        color = _speed_color(obs.kinematics.speed_mps)
        cv2.rectangle(out, (int(p.x1), int(p.y1)), (int(p.x2), int(p.y2)), color, 2, cv2.LINE_AA)
        label = f"#{p.track_id} {obs.kinematics.speed_mps:.1f}m/s"
        cv2.putText(
            out, label, (int(p.x1), max(12, int(p.y1) - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1, cv2.LINE_AA
        )
    return out


def encode_preview(image: np.ndarray) -> str:
    h, w = image.shape[:2]
    if w > PREVIEW_MAX_WIDTH:
        scale = PREVIEW_MAX_WIDTH / w
        image = cv2.resize(image, (PREVIEW_MAX_WIDTH, int(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, PREVIEW_JPEG_QUALITY])
    if not ok:
        return ""
    return base64.b64encode(buf.tobytes()).decode()
