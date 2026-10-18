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
    async def record_tracks(messages):
        published["tracks"].extend(messages)

    monkeypatch.setattr(worker_module, "publish_track_updates", record_tracks)
    monkeypatch.setattr(worker_module, "publish_camera_health", await record("health"))

    async def fake_persist(*args, **kwargs):
        published["persisted"] += 1

    monkeypatch.setattr(worker_module, "persist_detection_frame", fake_persist)
    monkeypatch.setattr(worker_module, "upsert_tracks", fake_persist)
    monkeypatch.setattr(worker_module, "mark_tracks_lost", fake_persist)

    async def fake_report(*args, **kwargs):
        return None

    monkeypatch.setattr(worker_module.backend_client, "report_camera_health", fake_report)

    async def fake_publish_anomaly(message):
        published.setdefault("anomalies", []).append(message)

    from app.anomaly import reporter as reporter_module

    monkeypatch.setattr(reporter_module, "publish_anomaly", fake_publish_anomaly)
    monkeypatch.setattr(reporter_module.backend_client, "create_alert", fake_report)
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


def test_worker_version_ignores_health_heartbeats():
    import datetime

    camera = SimpleNamespace(
        id=uuid.uuid4(), stream_type=StreamType.SIMULATED, stream_url="simulated://demo",
        stream_username=None, stream_password_encrypted=None, floor_id=None,
        map_x=0.0, map_y=0.0, orientation_deg=90.0, fov_deg=90.0, range_m=18.0,
        config={}, status="online", fps=8.0, updated_at=datetime.datetime(2026, 1, 1),
    )
    before = CameraContext(camera=camera).version
    camera.status, camera.fps, camera.updated_at = "offline", 0.0, datetime.datetime(2026, 1, 2)
    assert CameraContext(camera=camera).version == before
    camera.orientation_deg = 45.0
    assert CameraContext(camera=camera).version != before


async def test_stop_does_not_hang_on_a_blocked_worker():
    import time

    camera = SimpleNamespace(id=uuid.uuid4(), stream_type=StreamType.RTSP, config={},
                             map_x=0.0, map_y=0.0, orientation_deg=0.0, fov_deg=90.0, range_m=10.0)
    worker = CameraWorker(CameraContext(camera=camera))

    async def stuck():
        await asyncio.sleep(60)

    worker._task = asyncio.create_task(stuck())
    started = time.monotonic()
    await worker.stop(timeout=0.2)
    assert time.monotonic() - started < 1.0
    await asyncio.sleep(0)
    assert worker._task.cancelled()
