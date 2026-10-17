"""Frame capture abstraction over OpenCV's VideoCapture, covering every stream
type the platform supports: RTSP, HTTP/MJPEG, ONVIF (RTSP under the hood, once
resolved via ONVIF media profile discovery), USB, local video files, and webcams.

`open()`/`read()`/`release()` is intentionally the entire surface — the pipeline
worker doesn't care how a frame arrived, only that it can request one.
"""

import logging
import time
from dataclasses import dataclass

import cv2
import numpy as np

from common.crypto import decrypt_secret
from common.enums import StreamType
from common.models import Camera

from app.core.config import get_settings
from app.detection.types import Detection
from app.tracking.types import TrackedPerson

logger = logging.getLogger("ccd.ai.capture")


@dataclass
class Frame:
    image: np.ndarray
    """BGR frame, as returned by OpenCV."""
    captured_at: float
    """time.time() at the moment the frame was read."""
    frame_index: int
    people: list[TrackedPerson] | None = None
    """Ground-truth tracked people, set only by the simulator (which needs no detector)."""
    objects: list[Detection] | None = None
    """Ground-truth bag detections, set only by the simulator."""


class CameraOpenError(RuntimeError):
    pass


def _build_capture_target(camera: Camera) -> int | str:
    """Resolves a Camera row to whatever cv2.VideoCapture accepts as its source."""
    settings = get_settings()

    if camera.stream_type == StreamType.USB:
        try:
            return int(camera.stream_url)
        except ValueError:
            return camera.stream_url

    if camera.stream_type == StreamType.WEBCAM:
        return int(camera.stream_url) if camera.stream_url.strip() else 0

    if camera.stream_type == StreamType.FILE:
        return camera.stream_url

    # RTSP / HTTP / ONVIF: inject credentials into the URL if the camera has them and
    # the URL doesn't already embed a userinfo component.
    url = camera.stream_url
    if camera.stream_username and "@" not in url.split("://", 1)[-1].split("/", 1)[0]:
        password = ""
        if camera.stream_password_encrypted:
            password = decrypt_secret(
                camera.stream_password_encrypted, settings.CAMERA_CREDENTIAL_ENCRYPTION_KEY
            )
        scheme, _, rest = url.partition("://")
        auth = f"{camera.stream_username}:{password}@" if password else f"{camera.stream_username}@"
        url = f"{scheme}://{auth}{rest}"
    return url


class FrameSource:
    """Thin wrapper around cv2.VideoCapture with reconnect-friendly open/close semantics."""

    def __init__(self, camera: Camera):
        self.camera_id = str(camera.id)
        self.stream_type = camera.stream_type
        self._target = _build_capture_target(camera)
        self._cap: cv2.VideoCapture | None = None
        self._frame_index = 0
        self._last_read_at = 0.0
        self.is_finite_source = camera.stream_type == StreamType.FILE

    def open(self) -> None:
        cap = cv2.VideoCapture(self._target)
        if self.stream_type in (StreamType.RTSP, StreamType.ONVIF):
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not cap.isOpened():
            cap.release()
            raise CameraOpenError(f"Could not open stream for camera {self.camera_id}")
        self._cap = cap
        logger.info("camera %s: stream opened (%s)", self.camera_id, self.stream_type.value)

    def read(self) -> Frame | None:
        if self._cap is None:
            raise RuntimeError("FrameSource.open() must be called before read()")
        if self.is_finite_source:
            # A file decodes far faster than real time. Pace it to its native frame rate,
            # otherwise wall-clock speeds (and so running/panic detection) are inflated.
            interval = 1.0 / (self.fps_hint or 25.0)
            wait = self._last_read_at + interval - time.time()
            if wait > 0:
                time.sleep(wait)
            self._last_read_at = time.time()
        ok, image = self._cap.read()
        if not ok or image is None:
            return None
        frame = Frame(image=image, captured_at=time.time(), frame_index=self._frame_index)
        self._frame_index += 1
        return frame

    def release(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    @property
    def fps_hint(self) -> float:
        if self._cap is None:
            return 0.0
        fps = self._cap.get(cv2.CAP_PROP_FPS)
        return fps if fps and fps > 0 else 0.0
