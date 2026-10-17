"""One asyncio task per active camera: capture -> perceive (detect + track, or the
simulator's ground truth) -> analyze (project, kinematics, identity, zones, density)
-> publish -> (periodically) persist.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone

from common.enums import CameraStatus, StreamType
from common.schemas import CameraHealthMessage, DetectionFrameMessage, TrackUpdateMessage

from app.capture.simulated import CrowdSimulator, SimulatedSource, SimulationConfig
from app.capture.source import CameraOpenError, FrameSource
from app.core.config import get_settings
from app.core.runtime_settings import runtime_settings
from app.pipeline.analysis import FrameAnalysis, FrameAnalyzer
from app.pipeline.context import CameraContext
from app.pipeline.perception import GroundTruthPerception, ModelPerception, Perception
from app.pipeline.persistence import mark_tracks_lost, persist_detection_frame, upsert_tracks
from app.pipeline.preview import annotate, encode_preview
from app.utils.backend_client import backend_client
from app.utils.redis_publisher import publish_camera_health, publish_detection_frame, publish_track_update

logger = logging.getLogger("ccd.ai.worker")


class CameraWorker:
    def __init__(self, context: CameraContext):
        self.context = context
        self.camera = context.camera
        self.camera_id = context.camera_id
        self.version = context.version
        self._stop_event = asyncio.Event()
        self._task: asyncio.Task | None = None

        self._analyzer = FrameAnalyzer(context)
        self._perception: Perception | None = None

        self._fps_window_start = time.time()
        self._fps_window_frames = 0
        self._current_fps = 0.0
        self._latency_ms = 0.0
        self._last_persist_at = 0.0
        self._last_health_report_at = 0.0
        self._last_preview_at = 0.0
        self._persisted_active_ids: set[int] = set()

    @property
    def is_simulated(self) -> bool:
        return self.camera.stream_type == StreamType.SIMULATED

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name=f"camera-worker-{self.camera_id}")

    async def stop(self) -> None:
        self._stop_event.set()
        if self._task:
            await self._task

    def _build_source(self) -> FrameSource | SimulatedSource:
        if self.is_simulated:
            restricted = [z.centroid for z in self.context.zones if z.is_restricted]
            simulator = CrowdSimulator(
                geometry=self.context.geometry,
                config=SimulationConfig.from_camera_config(self.camera.config, self.camera_id),
                restricted_points=restricted,
            )
            return SimulatedSource(simulator, self.camera_id)
        return FrameSource(self.camera)

    def _build_perception(self) -> Perception:
        if self.is_simulated:
            return GroundTruthPerception()
        return ModelPerception(self.camera.config)

    async def _run(self) -> None:
        settings = get_settings()
        backoff = settings.RECONNECT_BACKOFF_S

        while not self._stop_event.is_set():
            source = self._build_source()
            try:
                await asyncio.to_thread(source.open)
                if self._perception is None:
                    # Loading YOLO can take seconds on first use; keep it off the event loop.
                    self._perception = await asyncio.to_thread(self._build_perception)
                backoff = settings.RECONNECT_BACKOFF_S
                await self._stream_loop(source)
            except CameraOpenError as exc:
                logger.warning("camera %s: %s", self.camera_id, exc)
                await self._report_health(CameraStatus.ERROR, error=str(exc))
            except Exception:
                logger.exception("camera %s: worker loop crashed", self.camera_id)
                await self._report_health(CameraStatus.ERROR, error="internal pipeline error")
            finally:
                await asyncio.to_thread(source.release)

            if self._stop_event.is_set():
                break

            await self._report_health(CameraStatus.OFFLINE)
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=backoff)
            except asyncio.TimeoutError:
                pass
            backoff = min(backoff * 2, settings.MAX_RECONNECT_BACKOFF_S)

        await self._report_health(CameraStatus.OFFLINE)

    def _frame_skip(self) -> int:
        settings = get_settings()
        config = self.camera.config or {}
        value = config.get("frame_skip", runtime_settings.yolo.get("frame_skip", settings.DEFAULT_FRAME_SKIP))
        return max(1, int(value))

    async def _stream_loop(self, source: FrameSource | SimulatedSource) -> None:
        settings = get_settings()
        frame_skip = 1 if self.is_simulated else self._frame_skip()
        frames_read = 0
        assert self._perception is not None

        await self._report_health(CameraStatus.ONLINE)

        while not self._stop_event.is_set():
            frame = await asyncio.to_thread(source.read)
            if frame is None:
                if source.is_finite_source:
                    logger.info("camera %s: end of file, looping", self.camera_id)
                    await asyncio.to_thread(source.release)
                    await asyncio.to_thread(source.open)
                    continue
                raise CameraOpenError("Stream ended unexpectedly")

            frames_read += 1
            if frames_read % frame_skip != 0:
                continue

            result = await self._perception.perceive(frame)
            height, width = frame.image.shape[:2]
            analysis = self._analyzer.analyze(
                result.people,
                width,
                height,
                ts=frame.captured_at,
                captured_at=datetime.fromtimestamp(frame.captured_at, tz=timezone.utc),
                avg_confidence=result.avg_confidence,
                inference_ms=result.inference_ms,
            )

            await self._publish(analysis, frame.image)
            self._record_timing(frame.captured_at)

            if time.time() - self._last_persist_at >= settings.DB_PERSIST_INTERVAL_S:
                self._last_persist_at = time.time()
                await self._persist(analysis)

            await self._maybe_report_health()

    async def _publish(self, analysis: FrameAnalysis, image) -> None:
        settings = get_settings()
        for obs in analysis.observations:
            await publish_track_update(
                TrackUpdateMessage(
                    camera_id=self.camera_id,
                    track_id=obs.person.track_id,
                    global_person_id=str(obs.global_id),
                    ts=analysis.captured_at,
                    map_x=obs.map_x,
                    map_y=obs.map_y,
                    speed_mps=obs.kinematics.speed_mps,
                    direction_deg=obs.kinematics.direction_deg,
                    dwell_time_s=obs.kinematics.dwell_time_s,
                    status="active",
                )
            )

        jpeg_b64 = None
        if time.time() - self._last_preview_at >= 1.0 / max(settings.PREVIEW_FPS, 0.1):
            self._last_preview_at = time.time()
            jpeg_b64 = await asyncio.to_thread(lambda: encode_preview(annotate(image, analysis))) or None

        await publish_detection_frame(
            DetectionFrameMessage(
                camera_id=self.camera_id,
                captured_at=analysis.captured_at,
                frame_index=int(analysis.ts * 1000),
                person_count=analysis.person_count,
                density_value=analysis.density_value,
                avg_confidence=analysis.avg_confidence,
                inference_ms=analysis.inference_ms,
                boxes=analysis.boxes(),
                jpeg_b64=jpeg_b64,
            )
        )

    async def _persist(self, analysis: FrameAnalysis) -> None:
        boxes_json = [b.model_dump() for b in analysis.boxes()]
        await persist_detection_frame(
            self.camera.id,
            analysis.captured_at,
            analysis.person_count,
            analysis.density_value,
            analysis.avg_confidence,
            analysis.inference_ms,
            boxes_json,
        )
        await upsert_tracks(self.camera.id, analysis.observations, analysis.captured_at)

        active = analysis.active_track_ids
        lost = self._persisted_active_ids - active
        await mark_tracks_lost(self.camera.id, list(lost), analysis.captured_at)
        self._analyzer.forget(lost)
        self._persisted_active_ids = active

    def _record_timing(self, captured_at: float) -> None:
        self._fps_window_frames += 1
        latency = (time.time() - captured_at) * 1000
        self._latency_ms = latency if self._latency_ms == 0 else 0.8 * self._latency_ms + 0.2 * latency

    async def _maybe_report_health(self) -> None:
        settings = get_settings()
        elapsed = time.time() - self._fps_window_start
        if elapsed >= 1.0:
            self._current_fps = self._fps_window_frames / elapsed
            self._fps_window_frames = 0
            self._fps_window_start = time.time()

        if time.time() - self._last_health_report_at >= settings.HEALTH_REPORT_INTERVAL_S:
            self._last_health_report_at = time.time()
            await self._report_health(CameraStatus.ONLINE)

    async def _report_health(self, status: CameraStatus, error: str | None = None) -> None:
        message = CameraHealthMessage(
            camera_id=self.camera_id,
            status=status.value,
            fps=round(self._current_fps, 2),
            latency_ms=round(self._latency_ms, 1),
            ts=datetime.now(timezone.utc),
            error=error,
        )
        try:
            await publish_camera_health(message)
        except Exception:
            logger.warning("camera %s: could not publish health to Redis", self.camera_id, exc_info=True)
        await backend_client.report_camera_health(
            self.camera_id, status.value, message.fps, message.latency_ms, error
        )
