import uuid

import orjson
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from common.rbac import ROLE_PERMISSIONS
from common.enums import RoleName

from app.core.security import create_access_token
from app.deps import CurrentUser
from app.main import app
from app.ws.bridge import RedisBridge
from app.ws.connections import Client, ConnectionManager, required_permission

CAM = str(uuid.uuid4())
FLOOR = str(uuid.uuid4())


def _client(manager: ConnectionManager, role: RoleName) -> Client:
    user = CurrentUser(user_id=None, role=role.value, is_guest=role == RoleName.GUEST,
                       permissions=ROLE_PERMISSIONS[role])
    client = Client(websocket=None, user=user, expires_at=9e12)
    manager.register(client)
    return client


def _drain(client: Client) -> list[dict]:
    out = []
    while not client.queue.empty():
        out.append(orjson.loads(client.queue.get_nowait()))
    return out


def test_topic_permissions():
    assert required_permission("cameras") == "camera:view"
    assert required_permission(f"floor:{FLOOR}") == "map:view"
    assert required_permission("alerts") == "alert:view"
    assert required_permission("floor:not-a-uuid") is None
    assert required_permission("stream:*") is None


def test_guests_cannot_watch_alerts_but_can_watch_floors():
    manager = ConnectionManager()
    guest = _client(manager, RoleName.GUEST)
    assert manager.subscribe(guest, "alerts") == (False, "missing permission alert:view")
    assert manager.subscribe(guest, f"floor:{FLOOR}") == (True, None)


def test_bridge_routes_frames_summaries_and_heatmaps():
    manager = ConnectionManager()
    bridge = RedisBridge(manager)
    wall = _client(manager, RoleName.VIEWER)
    detail = _client(manager, RoleName.VIEWER)
    manager.subscribe(wall, "cameras")
    manager.subscribe(detail, f"camera:{CAM}")
    manager.subscribe(detail, f"floor:{FLOOR}")

    frame = {"camera_id": CAM, "captured_at": "t", "person_count": 7, "density_value": 0.4,
             "inference_ms": 12.0, "boxes": [], "jpeg_b64": "abc"}
    bridge.route(f"stream:detections:{CAM}", orjson.dumps(frame).decode())
    bridge.route(f"stream:detections:{CAM}", orjson.dumps(frame).decode())  # throttled for the wall
    bridge.route(f"stream:heatmap:{FLOOR}", orjson.dumps({"floor_id": FLOOR, "cells": ""}).decode())

    [summary] = _drain(wall)
    assert summary["type"] == "camera.summary"
    assert summary["data"]["person_count"] == 7 and "jpeg_b64" not in summary["data"]

    detail_msgs = _drain(detail)
    assert [m["type"] for m in detail_msgs] == ["camera.frame", "camera.frame", "floor.heatmap"]
    assert detail_msgs[0]["data"]["jpeg_b64"] == "abc"


def test_bridge_batches_tracks_per_floor():
    manager = ConnectionManager()
    bridge = RedisBridge(manager)
    bridge.camera_floor = {CAM: FLOOR}
    viewer = _client(manager, RoleName.VIEWER)
    manager.subscribe(viewer, f"floor:{FLOOR}")

    for x in (1.0, 2.0, 3.0):  # same person moving: only the latest position survives
        bridge.route(f"stream:tracks:{CAM}", orjson.dumps(
            {"camera_id": CAM, "track_id": 5, "global_person_id": "g", "map_x": x, "map_y": 4.0,
             "speed_mps": 1.0, "dwell_time_s": 2.0}).decode())
    bridge.route(f"stream:tracks:{CAM}", orjson.dumps(
        {"camera_id": CAM, "track_id": 6, "map_x": 9.0, "map_y": 9.0}).decode())
    bridge.flush_tracks()

    [msg] = _drain(viewer)
    assert msg["type"] == "floor.tracks"
    people = {p["track_id"]: p for p in msg["data"]["people"]}
    assert people[5]["x"] == 3.0 and len(people) == 2


def test_bridge_skips_parsing_when_nobody_listens():
    bridge = RedisBridge(ConnectionManager())
    bridge.route(f"stream:detections:{CAM}", "not even json")  # must not raise


def test_alert_events_reach_alert_subscribers_with_their_event_name():
    manager = ConnectionManager()
    bridge = RedisBridge(manager)
    officer = _client(manager, RoleName.SECURITY_OFFICER)
    manager.subscribe(officer, "alerts")
    bridge.route("stream:alerts", orjson.dumps({"event": "alert.updated", "id": "a1"}).decode())
    [msg] = _drain(officer)
    assert msg["type"] == "alert.updated" and msg["data"] == {"id": "a1"}


def test_slow_clients_drop_oldest_messages():
    manager = ConnectionManager()
    viewer = _client(manager, RoleName.VIEWER)
    manager.subscribe(viewer, "cameras")
    for i in range(300):
        manager.broadcast("cameras", str(i))
    assert viewer.queue.qsize() == 256 and viewer.dropped == 44
    assert viewer.queue.get_nowait() == "44"


def _token(role: RoleName) -> str:
    return create_access_token(
        "guest" if role == RoleName.GUEST else str(uuid.uuid4()),
        role.value,
        is_guest=role == RoleName.GUEST,
        permissions=ROLE_PERMISSIONS[role],
    )


def test_websocket_requires_auth_message():
    with TestClient(app).websocket_connect("/ws/live") as ws:
        ws.send_text(orjson.dumps({"action": "subscribe", "topics": ["cameras"]}).decode())
        assert ws.receive_json()["type"] == "error"
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4401


def test_websocket_auth_subscribe_and_ping(fake_redis):
    with TestClient(app).websocket_connect("/ws/live") as ws:
        ws.send_text(orjson.dumps({"action": "auth", "token": _token(RoleName.GUEST)}).decode())
        ready = ws.receive_json()
        assert ready["type"] == "ready" and ready["data"]["is_guest"] is True

        ws.send_text(orjson.dumps({"action": "subscribe", "topics": ["cameras", "alerts", "bogus"]}).decode())
        sub = ws.receive_json()
        assert sub["type"] == "subscribed"
        assert sub["data"]["accepted"] == ["cameras"]
        assert set(sub["data"]["rejected"]) == {"alerts", "bogus"}

        ws.send_text(orjson.dumps({"action": "ping"}).decode())
        assert ws.receive_json()["type"] == "pong"


def test_websocket_rejects_refresh_tokens():
    from app.core.security import create_refresh_token

    refresh, _ = create_refresh_token(str(uuid.uuid4()))
    with TestClient(app).websocket_connect("/ws/live") as ws:
        ws.send_text(orjson.dumps({"action": "auth", "token": refresh}).decode())
        assert ws.receive_json()["type"] == "error"


async def test_live_heatmap_endpoint(client, fake_redis):
    resp = await client.post("/api/v1/auth/guest")
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    missing = await client.get(f"/api/v1/live/floors/{FLOOR}/heatmap", headers=headers)
    assert missing.status_code == 404
    await fake_redis.set(f"heatmap:{FLOOR}", orjson.dumps({"floor_id": FLOOR}).decode(), ex=30)
    found = await client.get(f"/api/v1/live/floors/{FLOOR}/heatmap", headers=headers)
    assert found.status_code == 200 and found.json()["floor_id"] == FLOOR


async def test_demo_seed_creates_a_simulated_station_once(db_session):
    from sqlalchemy import func, select

    from common.enums import StreamType
    from common.models import Camera, Floor, Zone

    from app.db.demo_seed import seed_demo_facility

    assert await seed_demo_facility(db_session) is True
    await db_session.commit()
    assert await seed_demo_facility(db_session) is False

    cameras = (await db_session.execute(select(Camera))).scalars().all()
    assert len(cameras) == 8 and all(c.stream_type == StreamType.SIMULATED for c in cameras)
    assert (await db_session.execute(select(func.count()).select_from(Floor))).scalar_one() == 2
    restricted = (await db_session.execute(select(Zone).where(Zone.is_restricted.is_(True)))).scalars().all()
    assert {z.name for z in restricted} == {"Staff Only", "Server Room"}
