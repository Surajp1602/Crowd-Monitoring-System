"""Redis -> WebSocket bridge.

One pattern subscription (`stream:*`) per backend process, however many dashboards
are connected. Each Redis message is translated into a client envelope

    {"type": "<kind>", "topic": "<topic>", "data": {...}}

serialized once, and offered to every subscriber of the topic. Messages for topics
nobody is watching are dropped before they are even parsed.

Track updates arrive one per person per frame. They are folded into a per-floor
snapshot of everyone's latest position and flushed at `TRACK_FLUSH_HZ`, which is all
the 3D map needs and keeps a busy floor from flooding browsers.
"""

import asyncio
import logging
import time
import uuid

import orjson
from sqlalchemy import select

from common.models import Camera
from common.redis_channels import ALERTS_CHANNEL, STREAM_PATTERN

from app.core.redis import get_redis
from app.db.session import AsyncSessionLocal
from app.ws.connections import ConnectionManager, connections

logger = logging.getLogger("ccd.ws.bridge")

TRACK_FLUSH_HZ = 4.0
TRACK_TTL_S = 1.5
SUMMARY_MIN_INTERVAL_S = 1.0
CAMERA_FLOOR_REFRESH_S = 15.0


def envelope(kind: str, topic: str, data: dict) -> str:
    return orjson.dumps({"type": kind, "topic": topic, "data": data}).decode()


class RedisBridge:
    def __init__(self, manager: ConnectionManager = connections) -> None:
        self.manager = manager
        self.camera_floor: dict[str, str] = {}
        self._tracks: dict[str, dict[tuple[str, int], dict]] = {}
        self._last_summary_at: dict[str, float] = {}
        self._tasks: list[asyncio.Task] = []

    # ---- lifecycle --------------------------------------------------------------

    def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._consume_forever(), name="ws-bridge-consume"),
            asyncio.create_task(self._flush_tracks_forever(), name="ws-bridge-tracks"),
            asyncio.create_task(self._refresh_camera_floors_forever(), name="ws-bridge-floors"),
        ]

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

    async def _consume_forever(self) -> None:
        backoff = 1.0
        while True:
            pubsub = None
            try:
                pubsub = get_redis().pubsub()
                await pubsub.psubscribe(STREAM_PATTERN)
                backoff = 1.0
                async for message in pubsub.listen():
                    if message.get("type") in ("pmessage", "message"):
                        self.route(message["channel"], message["data"])
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Redis bridge disconnected; retrying in %.0fs", backoff, exc_info=True)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)
            finally:
                if pubsub is not None:
                    try:
                        await pubsub.aclose()
                    except Exception:  # noqa: BLE001
                        pass

    async def _flush_tracks_forever(self) -> None:
        while True:
            await asyncio.sleep(1.0 / TRACK_FLUSH_HZ)
            self.flush_tracks()

    async def _refresh_camera_floors_forever(self) -> None:
        while True:
            try:
                await self.refresh_camera_floors()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Could not refresh camera->floor map", exc_info=True)
            await asyncio.sleep(CAMERA_FLOOR_REFRESH_S)

    async def refresh_camera_floors(self) -> None:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(Camera.id, Camera.floor_id))).all()
        self.camera_floor = {str(cid): str(fid) for cid, fid in rows if fid is not None}

    # ---- routing ----------------------------------------------------------------

    def route(self, channel: str, raw: str) -> None:
        if channel == ALERTS_CHANNEL:
            if self.manager.has_subscribers("alerts"):
                data = orjson.loads(raw)
                self.manager.broadcast("alerts", envelope(data.pop("event", "alert.created"), "alerts", data))
            return

        parts = channel.split(":")
        if len(parts) != 3 or parts[0] != "stream":
            return
        kind, key = parts[1], parts[2]

        if kind == "detections":
            self._route_detection(key, raw)
        elif kind == "health":
            self._route_health(key, raw)
        elif kind == "tracks":
            self._route_track(key, raw)
        elif kind == "heatmap":
            topic = f"floor:{key}"
            if self.manager.has_subscribers(topic):
                self.manager.broadcast(topic, envelope("floor.heatmap", topic, orjson.loads(raw)))
        elif kind == "anomalies":
            if self.manager.has_subscribers("alerts"):
                self.manager.broadcast("alerts", envelope("anomaly.signal", "alerts", orjson.loads(raw)))

    def _route_detection(self, camera_id: str, raw: str) -> None:
        topic = f"camera:{camera_id}"
        wants_full = self.manager.has_subscribers(topic)
        now = time.monotonic()
        wants_summary = self.manager.has_subscribers("cameras") and (
            now - self._last_summary_at.get(camera_id, 0.0) >= SUMMARY_MIN_INTERVAL_S
        )
        if not (wants_full or wants_summary):
            return
        data = orjson.loads(raw)
        if wants_full:
            self.manager.broadcast(topic, envelope("camera.frame", topic, data))
        if wants_summary:
            self._last_summary_at[camera_id] = now
            summary = {
                "camera_id": camera_id,
                "captured_at": data.get("captured_at"),
                "person_count": data.get("person_count", 0),
                "density_value": data.get("density_value", 0.0),
                "inference_ms": data.get("inference_ms", 0.0),
            }
            self.manager.broadcast("cameras", envelope("camera.summary", "cameras", summary))

    def _route_health(self, camera_id: str, raw: str) -> None:
        topic = f"camera:{camera_id}"
        targets = [t for t in (topic, "cameras") if self.manager.has_subscribers(t)]
        if not targets:
            return
        data = orjson.loads(raw)
        for t in targets:
            self.manager.broadcast(t, envelope("camera.health", t, data))

    def _route_track(self, camera_id: str, raw: str) -> None:
        floor_id = self.camera_floor.get(camera_id)
        if floor_id is None or not self.manager.has_subscribers(f"floor:{floor_id}"):
            return
        data = orjson.loads(raw)
        self._tracks.setdefault(floor_id, {})[(camera_id, int(data["track_id"]))] = {
            "camera_id": camera_id,
            "track_id": data["track_id"],
            "global_person_id": data.get("global_person_id"),
            "x": data["map_x"],
            "y": data["map_y"],
            "speed_mps": data.get("speed_mps", 0.0),
            "direction_deg": data.get("direction_deg"),
            "dwell_time_s": data.get("dwell_time_s", 0.0),
            "_seen": time.monotonic(),
        }

    def flush_tracks(self) -> None:
        now = time.monotonic()
        for floor_id in list(self._tracks):
            topic = f"floor:{floor_id}"
            people = {k: v for k, v in self._tracks[floor_id].items() if now - v["_seen"] <= TRACK_TTL_S}
            self._tracks[floor_id] = people
            if not self.manager.has_subscribers(topic):
                del self._tracks[floor_id]
                continue
            payload = [{k: v for k, v in p.items() if k != "_seen"} for p in people.values()]
            self.manager.broadcast(topic, envelope("floor.tracks", topic, {"floor_id": floor_id, "people": payload}))


async def latest_snapshot_for(topic: str) -> str | None:
    """Cached state replayed to a client the moment it subscribes, so the heatmap or
    camera status paints immediately instead of on the next live message."""
    from common.redis_channels import CAMERA_HEALTH_KEY_PREFIX, HEATMAP_KEY_PREFIX

    try:
        if topic.startswith("floor:"):
            raw = await get_redis().get(f"{HEATMAP_KEY_PREFIX}{topic.split(':', 1)[1]}")
            return envelope("floor.heatmap", topic, orjson.loads(raw)) if raw else None
        if topic.startswith("camera:"):
            raw = await get_redis().get(f"{CAMERA_HEALTH_KEY_PREFIX}{topic.split(':', 1)[1]}")
            return envelope("camera.health", topic, orjson.loads(raw)) if raw else None
    except Exception:  # noqa: BLE001 - a missing snapshot is never fatal
        logger.debug("No snapshot for %s", topic, exc_info=True)
    return None


def is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


bridge = RedisBridge()
