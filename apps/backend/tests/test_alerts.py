import time
import uuid

import orjson

INTERNAL = {"X-Internal-Api-Key": "dev-internal-service-key-change-me"}


async def _admin(client, admin_credentials):
    resp = await client.post("/api/v1/auth/login", json=admin_credentials)
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _camera(client, headers, code="cam-a"):
    resp = await client.post(
        "/api/v1/cameras", headers=headers,
        json={"code": code, "name": code.upper(), "stream_type": "simulated", "stream_url": "simulated://"},
    )
    return resp.json()


async def _ingest(client, **overrides):
    payload = {
        "alert_type": "restricted_area_intrusion",
        "severity": "high",
        "title": "Restricted area entered: Vault",
        "confidence": 0.93,
        "map_x": 4.0,
        "map_y": 9.5,
        "snapshot_url": "alerts/2026/10/17/abc.jpg",
        "metadata": {"track_ids": [7], "floor_id": str(uuid.uuid4())},
        **overrides,
    }
    resp = await client.post("/api/v1/alerts", headers=INTERNAL, json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_ingest_requires_the_internal_key(client):
    resp = await client.post("/api/v1/alerts", json={"alert_type": "running", "title": "x"})
    assert resp.status_code == 401


async def test_ingest_persists_event_fans_out_and_enqueues_dispatch(client, admin_credentials, fake_redis, db_session):
    from sqlalchemy import select

    from common.models import Event

    alert = await _ingest(client)
    assert alert["metadata"]["track_ids"] == [7]
    assert alert["snapshot_url"].startswith("/api/v1/media/alerts/2026/10/17/abc.jpg?exp=")

    events = (await db_session.execute(select(Event))).scalars().all()
    assert len(events) == 1 and events[0].payload["track_ids"] == [7]

    live = [orjson.loads(d) for c, d in fake_redis.published if c == "stream:alerts"]
    assert live[-1]["event"] == "alert.created" and live[-1]["floor_id"] == alert["metadata"]["floor_id"]
    assert fake_redis.streams["alerts:dispatch"][0][1]["alert_id"] == alert["id"]


async def test_status_lifecycle_and_bulk_update(client, admin_credentials):
    headers = await _admin(client, admin_credentials)
    a = await _ingest(client)
    b = await _ingest(client, alert_type="running", severity="low", title="Running")

    ack = await client.patch(f"/api/v1/alerts/{a['id']}/status", headers=headers, json={"status": "acknowledged"})
    assert ack.json()["status"] == "acknowledged" and ack.json()["acknowledged_at"]

    bulk = await client.post("/api/v1/alerts/bulk-status", headers=headers,
                             json={"ids": [a["id"], b["id"]], "status": "resolved"})
    assert {x["status"] for x in bulk.json()} == {"resolved"}
    assert all(x["resolved_at"] for x in bulk.json())

    reopened = await client.patch(f"/api/v1/alerts/{b['id']}/status", headers=headers, json={"status": "open"})
    assert reopened.json()["resolved_at"] is None


async def test_filters_and_stats(client, admin_credentials):
    headers = await _admin(client, admin_credentials)
    await _ingest(client)
    await _ingest(client, alert_type="panic", severity="critical", title="Possible panic")
    await _ingest(client, alert_type="running", severity="low", title="Running")

    crit = await client.get("/api/v1/alerts?severity=critical&severity=high", headers=headers)
    assert crit.json()["total"] == 2
    panic = await client.get("/api/v1/alerts?alert_type=panic", headers=headers)
    assert [x["title"] for x in panic.json()["items"]] == ["Possible panic"]

    stats = (await client.get("/api/v1/alerts/stats?hours=24", headers=headers)).json()
    assert stats["total"] == 3 and stats["by_severity"]["critical"] == 1 and stats["by_status"]["open"] == 3


async def test_guests_cannot_read_alerts(client):
    guest = (await client.post("/api/v1/auth/guest")).json()["access_token"]
    resp = await client.get("/api/v1/alerts", headers={"Authorization": f"Bearer {guest}"})
    assert resp.status_code == 403


async def test_camera_stream_failure_raises_and_recovery_resolves(client, admin_credentials):
    headers = await _admin(client, admin_credentials)
    cam = await _camera(client, headers)

    async def health(status, error=None):
        await client.post(f"/api/v1/cameras/{cam['id']}/health", headers=INTERNAL,
                          json={"status": status, "fps": 0, "latency_ms": 0, "error": error})

    await health("online")
    await health("offline")  # deliberate stop: no alert
    await health("error", "connection refused")
    await health("error", "connection refused")  # still failing: no duplicate
    open_alerts = (await client.get("/api/v1/alerts?alert_type=camera_offline&status=open", headers=headers)).json()
    assert open_alerts["total"] == 1 and "connection refused" in open_alerts["items"][0]["description"]

    await health("online")
    still_open = (await client.get("/api/v1/alerts?alert_type=camera_offline&status=open", headers=headers)).json()
    assert still_open["total"] == 0


async def test_signed_media_links(client, tmp_path, monkeypatch):
    from app.core import media
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "STORAGE_DIR", str(tmp_path))
    (tmp_path / "alerts").mkdir()
    (tmp_path / "alerts" / "shot.jpg").write_bytes(b"\xff\xd8jpeg")
    (tmp_path / "secret.txt").write_text("nope")

    url = media.sign_media_path("alerts/shot.jpg")
    ok = await client.get(url)
    assert ok.status_code == 200 and ok.content == b"\xff\xd8jpeg"

    tampered = url.replace("shot.jpg", "other.jpg")
    assert (await client.get(tampered)).status_code == 403

    expired_exp = int(time.time()) - 5
    sig = media._signature("alerts/shot.jpg", expired_exp)
    assert (await client.get(f"/api/v1/media/alerts/shot.jpg?exp={expired_exp}&sig={sig}")).status_code == 403

    traversal = media.sign_media_path("../secret.txt")
    assert (await client.get(traversal)).status_code == 404


async def test_repeat_within_window_joins_the_open_alert(client, fake_redis):
    first = await _ingest(client)
    again = await _ingest(client, confidence=0.97, map_x=5.0)
    assert again["id"] == first["id"]
    assert again["metadata"]["occurrences"] == 2
    assert again["confidence"] == 0.97 and again["map_x"] == 5.0
    # The repeat is a live update, not a second page to the dispatcher.
    assert await fake_redis.xlen("alerts:dispatch") == 1


async def test_escalation_updates_severity_and_notifies_again(client, fake_redis):
    first = await _ingest(client, alert_type="panic", severity="high", title="Possible panic")
    again = await _ingest(client, alert_type="panic", severity="critical", title="Panic: crowd fleeing")
    assert again["id"] == first["id"]
    assert again["severity"] == "critical" and again["title"] == "Panic: crowd fleeing"
    assert await fake_redis.xlen("alerts:dispatch") == 2


async def test_repeat_on_another_camera_or_after_resolve_is_a_new_alert(client, admin_credentials):
    headers = await _admin(client, admin_credentials)
    cam = await _camera(client, headers)
    first = await _ingest(client)
    other = await _ingest(client, camera_id=cam["id"])
    assert other["id"] != first["id"]

    resp = await client.patch(f"/api/v1/alerts/{first['id']}/status", headers=headers, json={"status": "resolved"})
    assert resp.status_code == 200, resp.text
    fresh = await _ingest(client)
    assert fresh["id"] != first["id"]
