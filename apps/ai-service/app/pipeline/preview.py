"""Annotated, downsampled JPEG previews for the live camera wall. Sent inline over the
WebSocket a couple of times a second; never persisted."""

import base64

import cv2
import numpy as np

from app.pipeline.analysis import FrameAnalysis

PREVIEW_MAX_WIDTH = 640
PREVIEW_JPEG_QUALITY = 70


def _speed_color(speed_mps: float) -> tuple[int, int, int]:
    """BGR: calm walkers in paper, fast movers shift to the brand amber then red."""
    if speed_mps >= 3.0:
        return (60, 60, 235)
    if speed_mps >= 2.0:
        return (59, 169, 242)
    return (222, 232, 236)


def annotate(image: np.ndarray, analysis: FrameAnalysis) -> np.ndarray:
    out = image.copy()
    for obs in analysis.observations:
        p = obs.person
        color = _speed_color(obs.kinematics.speed_mps)
        fast = obs.kinematics.speed_mps >= 2.0
        cv2.rectangle(out, (int(p.x1), int(p.y1)), (int(p.x2), int(p.y2)), color, 2 if fast else 1, cv2.LINE_AA)
        if not fast:
            continue  # a label on every walker turns a crowded tile into noise; only fast movers get one
        label = f"#{p.track_id} {obs.kinematics.speed_mps:.1f}m/s"
        cv2.putText(
            out, label, (int(p.x1), max(12, int(p.y1) - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1, cv2.LINE_AA
        )
    return out


def annotate_evidence(image: np.ndarray, analysis: FrameAnalysis, track_ids: set[int], title: str) -> np.ndarray:
    """Alert snapshot: everyone dimmed, the people involved boxed in red, and a caption."""
    out = (image * 0.75).astype(np.uint8)
    for obs in analysis.observations:
        p = obs.person
        involved = p.track_id in track_ids
        color = (77, 72, 229) if involved else (110, 110, 110)
        cv2.rectangle(out, (int(p.x1), int(p.y1)), (int(p.x2), int(p.y2)), color, 2 if involved else 1, cv2.LINE_AA)
    cv2.rectangle(out, (0, 0), (out.shape[1], 26), (13, 14, 12), -1)
    cv2.putText(out, title[:80], (8, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (222, 232, 236), 1, cv2.LINE_AA)
    return out


def encode_jpeg(image: np.ndarray, quality: int = 85) -> bytes:
    ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return buf.tobytes() if ok else b""


def encode_preview(image: np.ndarray) -> str:
    h, w = image.shape[:2]
    if w > PREVIEW_MAX_WIDTH:
        scale = PREVIEW_MAX_WIDTH / w
        image = cv2.resize(image, (PREVIEW_MAX_WIDTH, int(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, PREVIEW_JPEG_QUALITY])
    if not ok:
        return ""
    return base64.b64encode(buf.tobytes()).decode()
