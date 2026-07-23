async def test_guest_session_has_limited_permissions(client):
    resp = await client.post("/api/v1/auth/guest")
    assert resp.status_code == 200
    token = resp.json()["access_token"]

    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    body = me.json()
    assert body["is_guest"] is True
    assert "camera:manage" not in body["permissions"]
    assert "camera:view" in body["permissions"]


async def test_admin_login_succeeds(client, admin_credentials):
    resp = await client.post("/api/v1/auth/login", json=admin_credentials)
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["email"] == admin_credentials["email"]
    assert body["access_token"]
    assert body["refresh_token"]


async def test_login_wrong_password_rejected(client, admin_credentials):
    resp = await client.post(
        "/api/v1/auth/login", json={"email": admin_credentials["email"], "password": "wrong-password"}
    )
    assert resp.status_code == 401


async def test_refresh_token_issues_new_access_token(client, admin_credentials):
    login = await client.post("/api/v1/auth/login", json=admin_credentials)
    refresh_token = login.json()["refresh_token"]

    resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert resp.status_code == 200
    assert resp.json()["access_token"]


async def test_guest_cannot_create_camera(client):
    guest = await client.post("/api/v1/auth/guest")
    token = guest.json()["access_token"]

    resp = await client.post(
        "/api/v1/cameras",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "code": "cam-01",
            "name": "Main Entrance",
            "stream_type": "rtsp",
            "stream_url": "rtsp://example.com/stream",
        },
    )
    assert resp.status_code == 403
