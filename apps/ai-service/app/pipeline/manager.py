"""Reconciles running CameraWorker tasks against the `cameras` table: starts a worker
for every active camera, stops one when a camera is deleted or disabled, restarts one
when its camera row or its floor's zones change, and periodically refreshes the
shared runtime settings cache.

Polling keeps the service eventually consistent with the DB even if it missed a
message or was restarted; the backend's `stream:camera-commands` messages only make
it react immediately instead of on the next poll.
"""

import asyncio
import logging

import orjson
from sqlalchemy import select

from common.models import Camera, Floor, Zone
from common.redis_channels import CAMERA_COMMANDS_CHANNEL

from app.core.config import get_settings
from app.core.runtime_settings import runtime_settings
from app.db.session import session_scope
from app.pipeline.camera_worker import CameraWorker
from app.pipeline.context import CameraContext, FloorInfo, ZoneInfo
from app.utils.redis_publisher import get_redis

logger = logging.getLogger("ccd.ai.manager")


async def load_camera_contexts() -> dict[str, CameraContext]:
    async with session_scope() as db:
        cameras = (await db.execute(select(Camera).where(Camera.is_active.is_(True)))).scalars().all()
        floor_ids = {c.floor_id for c in cameras if c.floor_id}
        floors: dict = {}
        zones_by_floor: dict = {}
        if floor_ids:
            for f in (await db.execute(select(Floor).where(Floor.id.in_(floor_ids)))).scalars().all():
                floors[f.id] = FloorInfo(id=f.id, name=f.name, width_m=f.width_m, depth_m=f.depth_m)
            for z in (await db.execute(select(Zone).where(Zone.floor_id.in_(floor_ids)))).scalars().all():
                zones_by_floor.setdefault(z.floor_id, []).append(
                    ZoneInfo(
                        id=z.id,
                        name=z.name,
                        zone_type=z.zone_type.value,
                        polygon=list(z.polygon or []),
                        is_restricted=z.is_restricted,
                        capacity_threshold=z.capacity_threshold,
                    )
                )
    return {
        str(c.id): CameraContext(
            camera=c,
            floor=floors.get(c.floor_id),
            zones=zones_by_floor.get(c.floor_id, []),
        )
        for c in cameras
    }


class PipelineManager:
    def __init__(self) -> None:
        self._workers: dict[str, CameraWorker] = {}
        self._stop_event = asyncio.Event()
        self._reconcile_now = asyncio.Event()

    async def run(self) -> None:
        settings = get_settings()
        await runtime_settings.refresh()
        listener = asyncio.create_task(self._listen_for_commands(), name="camera-command-listener")
        try:
            while not self._stop_event.is_set():
                try:
                    await self._reconcile()
                except Exception:
                    logger.exception("Camera reconciliation pass failed")
                self._reconcile_now.clear()
                stop = asyncio.create_task(self._stop_event.wait())
                poke = asyncio.create_task(self._reconcile_now.wait())
                await asyncio.wait({stop, poke}, timeout=settings.CAMERA_POLL_INTERVAL_S, return_when=asyncio.FIRST_COMPLETED)
                stop.cancel()
                poke.cancel()
                await runtime_settings.refresh()
        finally:
            listener.cancel()

    async def _listen_for_commands(self) -> None:
        """Any camera command just triggers an immediate reconcile: the DB stays the
        source of truth, so a dropped or duplicated message can never desync workers."""
        while not self._stop_event.is_set():
            try:
                pubsub = get_redis().pubsub()
                await pubsub.subscribe(CAMERA_COMMANDS_CHANNEL)
                async for message in pubsub.listen():
                    if message.get("type") != "message":
                        continue
                    try:
                        logger.info("camera command: %s", orjson.loads(message["data"]))
                    except orjson.JSONDecodeError:
                        pass
                    self._reconcile_now.set()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Camera command listener lost its Redis connection; retrying", exc_info=True)
                await asyncio.sleep(5)

    async def stop(self) -> None:
        self._stop_event.set()
        await asyncio.gather(*(w.stop() for w in self._workers.values()), return_exceptions=True)
        self._workers.clear()

    async def _reconcile(self) -> None:
        contexts = await load_camera_contexts()
        current_ids = set(self._workers)
        target_ids = set(contexts)

        for camera_id in current_ids - target_ids:
            logger.info("camera %s: no longer active, stopping worker", camera_id)
            await self._workers.pop(camera_id).stop()

        for camera_id in current_ids & target_ids:
            if self._workers[camera_id].version != contexts[camera_id].version:
                logger.info("camera %s: configuration changed, restarting worker", camera_id)
                await self._workers.pop(camera_id).stop()

        for camera_id in target_ids - set(self._workers):
            logger.info("camera %s: starting worker", camera_id)
            worker = CameraWorker(contexts[camera_id])
            worker.start()
            self._workers[camera_id] = worker

    @property
    def active_camera_count(self) -> int:
        return len(self._workers)

    @property
    def camera_ids(self) -> list[str]:
        return sorted(self._workers)
