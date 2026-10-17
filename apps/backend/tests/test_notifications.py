import orjson


async def _admin(client, admin_credentials):
    resp = await client.post("/api/v1/auth/login", json=admin_credentials)
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


SUB = {"latitude": 12.9767, "longitude": 77.5713, "radius_m": 300, "channels": ["sms"], "phone_number": "+91 98111 11111"}


async def test_public_subscribe_validates_contacts(client):
    missing = await client.post("/api/v1/notifications/subscriptions", json={**SUB, "channels": ["sms", "email"]})
    assert missing.status_code == 422 and "email" in missing.text
    bad_phone = await client.post("/api/v1/notifications/subscriptions", json={**SUB, "phone_number": "98111"})
    assert bad_phone.status_code == 422
    staff_only = await client.post("/api/v1/notifications/subscriptions", json={**SUB, "channels": ["public_announcement"]})
    assert staff_only.status_code == 422


async def test_subscribe_returns_token_once_and_unsubscribes(client, admin_credentials):
    created = await client.post("/api/v1/notifications/subscriptions", json=SUB)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["contact"] == "+91****11" and len(body["unsubscribe_token"]) >= 20

    headers = await _admin(client, admin_credentials)
    listed = (await client.get("/api/v1/notifications/subscriptions", headers=headers)).json()
    assert listed["total"] == 1
    assert "unsubscribe_token" not in listed["items"][0] and "phone_number" not in listed["items"][0]

    gone = await client.post(f"/api/v1/notifications/subscriptions/unsubscribe?token={body['unsubscribe_token']}")
    assert gone.status_code == 204
    assert (await client.get("/api/v1/notifications/subscriptions", headers=headers)).json()["total"] == 0
    again = await client.post(f"/api/v1/notifications/subscriptions/unsubscribe?token={'x' * 30}")
    assert again.status_code == 404


async def test_subscribe_is_rate_limited(client):
    for _ in range(10):
        assert (await client.post("/api/v1/notifications/subscriptions", json=SUB)).status_code == 201
    assert (await client.post("/api/v1/notifications/subscriptions", json=SUB)).status_code == 429


async def test_test_send_queues_on_the_outbox(client, admin_credentials, fake_redis):
    headers = await _admin(client, admin_credentials)
    resp = await client.post("/api/v1/notifications/test", headers=headers,
                             json={"channel": "email", "recipient": "ops@example.com"})
    assert resp.status_code == 202
    [(_, fields)] = fake_redis.streams["notifications:outbox"]
    assert orjson.loads(fields["payload"])["recipient"] == "ops@example.com"


async def test_provider_status_reports_worker_liveness(client, admin_credentials, fake_redis):
    headers = await _admin(client, admin_credentials)
    assert (await client.get("/api/v1/notifications/providers", headers=headers)).json()["worker_online"] is False
    await fake_redis.set("worker:heartbeat", orjson.dumps({"ts": 1, "sent": 3}).decode(), ex=30)
    await fake_redis.set("worker:providers", orjson.dumps({"email": {"provider": "console", "ready": True}}).decode(), ex=60)
    status = (await client.get("/api/v1/notifications/providers", headers=headers)).json()
    assert status["worker_online"] and status["channels"]["email"]["ready"]


async def test_staff_phone_numbers_are_validated(client, admin_credentials):
    headers = await _admin(client, admin_credentials)
    created = await client.post("/api/v1/auth/register", headers=headers, json={
        "email": "officer@example.com", "password": "Secur3pass!", "full_name": "Officer", "role_name": "security_officer",
        "phone_number": "+919800000001"})
    assert created.status_code == 201 and created.json()["phone_number"] == "+919800000001"
    bad = await client.patch(f"/api/v1/users/{created.json()['id']}", headers=headers, json={"phone_number": "12"})
    assert bad.status_code == 422
    off = await client.patch(f"/api/v1/users/{created.json()['id']}", headers=headers, json={"notify_enabled": False})
    assert off.json()["notify_enabled"] is False


async def test_settings_permissions_are_per_key(client, admin_credentials):
    headers = await _admin(client, admin_credentials)
    await client.post("/api/v1/auth/register", headers=headers, json={
        "email": "sup@example.com", "password": "Secur3pass!", "full_name": "Sup", "role_name": "supervisor"})
    token = (await client.post("/api/v1/auth/login", json={"email": "sup@example.com", "password": "Secur3pass!"})).json()["access_token"]
    sup = {"Authorization": f"Bearer {token}"}

    keys = {s["key"] for s in (await client.get("/api/v1/settings", headers=sup)).json()}
    assert "notifications" in keys and "anomaly" in keys

    merged = await client.put("/api/v1/settings/notifications", headers=sup, json={"value": {"staff_min_severity": "medium"}})
    assert merged.status_code == 200
    assert merged.json()["value"]["staff_min_severity"] == "medium"
    assert "public_channels" in merged.json()["value"], "partial updates merge instead of replacing"

    officer = await client.post("/api/v1/auth/register", headers=headers, json={
        "email": "off@example.com", "password": "Secur3pass!", "full_name": "Off", "role_name": "security_officer"})
    assert officer.status_code == 201
    t2 = (await client.post("/api/v1/auth/login", json={"email": "off@example.com", "password": "Secur3pass!"})).json()["access_token"]
    denied = await client.put("/api/v1/settings/anomaly", headers={"Authorization": f"Bearer {t2}"}, json={"value": {"min_confidence": 0.1}})
    assert denied.status_code == 403
