"""Runs a real CameraWorker on a simulated camera for a moment, with Redis, the
backend and Postgres replaced by recorders, to prove the async wiring end to end."""

import asyncio
import uuid
from types import SimpleNamespace

from common.enums import StreamType

from app.pipeline import camera_worker as worker_module
from app.pipeline.camera_worker import CameraWorker
from app.pipeline.context import CameraContext


async def test_simulated_worker_publishes_frames_tracks_and_health(monkeypatch):
    published = {"frames": [], "tracks": [], "health": [], "persisted": 0}

    async def record(kind):
        async def _inner(message, *args, **kwargs):
            published[kind].append(message)
        return _inner

    monkeypatch.setattr(worker_module, "publish_detection_frame", await record("frames"))
    monkeypatch.setattr(worker_module, "publish_track_update", await record("tracks"))
    monkeypatch.setattr(worker_module, "publish_camera_health", await record("health"))

    async def fake_persist(*args, **kwargs):
        published["persisted"] += 1

    monkeypatch.setattr(worker_module, "persist_detection_frame", fake_persist)
    monkeypatch.setattr(worker_module, "upsert_tracks", fake_persist)
    monkeypatch.setattr(worker_module, "mark_tracks_lost", fake_persist)

    async def fake_report(*args, **kwargs):
        return None

    monkeypatch.setattr(worker_module.backend_client, "report_camera_health", fake_report)
    monkeypatch.setattr(worker_module.get_settings(), "DB_PERSIST_INTERVAL_S", 0.2)

    camera = SimpleNamespace(
        id=uuid.uuid4(),
        stream_type=StreamType.SIMULATED,
        map_x=0.0, map_y=0.0, orientation_deg=90.0, fov_deg=90.0, range_m=18.0,
        updated_at=None,
        config={"simulation": {"fps": 20, "base_people": 6, "peak_people": 6, "incident_every_s": 1e9}},
    )
    worker = CameraWorker(CameraContext(camera=camera))
    worker.start()
    await asyncio.sleep(1.5)
    await worker.stop()

    frames = published["frames"]
    assert len(frames) >= 10
    assert any(f.jpeg_b64 for f in frames), "previews should be attached"
    assert all(f.camera_id == str(camera.id) for f in frames)
    assert frames[-1].person_count > 0
    assert published["tracks"], "track updates should stream for every visible person"
    assert published["persisted"] > 0
    statuses = [h.status for h in published["health"]]
    assert statuses[0] == "online" and statuses[-1] == "offline"
