async def _admin_headers(client, admin_credentials):
    resp = await client.post("/api/v1/auth/login", json=admin_credentials)
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def test_create_and_list_camera(client, admin_credentials):
    headers = await _admin_headers(client, admin_credentials)

    create_resp = await client.post(
        "/api/v1/cameras",
        headers=headers,
        json={
            "code": "cam-entrance-01",
            "name": "Main Entrance",
            "stream_type": "rtsp",
            "stream_url": "rtsp://192.168.1.10:554/stream1",
            "stream_username": "admin",
            "stream_password": "s3cret",
            "latitude": 12.9716,
            "longitude": 77.5946,
            "map_x": 10.5,
            "map_y": 20.25,
            "fov_deg": 100,
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    camera = create_resp.json()
    assert camera["code"] == "cam-entrance-01"
    assert camera["status"] == "starting"
    assert "stream_password" not in camera

    list_resp = await client.get("/api/v1/cameras", headers=headers)
    assert list_resp.status_code == 200
    assert list_resp.json()["total"] == 1


async def test_duplicate_camera_code_rejected(client, admin_credentials):
    headers = await _admin_headers(client, admin_credentials)
    payload = {
        "code": "cam-dup",
        "name": "Cam",
        "stream_type": "webcam",
        "stream_url": "0",
    }
    first = await client.post("/api/v1/cameras", headers=headers, json=payload)
    assert first.status_code == 201

    second = await client.post("/api/v1/cameras", headers=headers, json=payload)
    assert second.status_code == 409


async def test_internal_health_endpoint_requires_service_key(client, admin_credentials):
    headers = await _admin_headers(client, admin_credentials)
    create_resp = await client.post(
        "/api/v1/cameras",
        headers=headers,
        json={"code": "cam-health", "name": "Cam", "stream_type": "usb", "stream_url": "/dev/video0"},
    )
    camera_id = create_resp.json()["id"]

    unauthorized = await client.post(
        f"/api/v1/cameras/{camera_id}/health",
        json={"status": "online", "fps": 24.5, "latency_ms": 80},
    )
    assert unauthorized.status_code == 401

    from app.core.config import get_settings

    authorized = await client.post(
        f"/api/v1/cameras/{camera_id}/health",
        headers={"X-Internal-Api-Key": get_settings().INTERNAL_SERVICE_API_KEY},
        json={"status": "online", "fps": 24.5, "latency_ms": 80},
    )
    assert authorized.status_code == 200
    assert authorized.json()["status"] == "online"
