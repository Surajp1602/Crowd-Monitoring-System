async def _admin(client, admin_credentials):
    resp = await client.post("/api/v1/auth/login", json=admin_credentials)
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _floor(client, headers):
    building = await client.post("/api/v1/buildings", headers=headers, json={"name": "HQ"})
    floor = await client.post(
        "/api/v1/floors",
        headers=headers,
        json={"building_id": building.json()["id"], "name": "Ground", "width_m": 40, "depth_m": 30},
    )
    assert floor.status_code == 201, floor.text
    return floor.json()


async def test_zone_polygon_is_validated(client, admin_credentials):
    headers = await _admin(client, admin_credentials)
    floor = await _floor(client, headers)
    bad = await client.post(
        "/api/v1/zones",
        headers=headers,
        json={"floor_id": floor["id"], "name": "Line", "polygon": [{"x": 0, "y": 0}, {"x": 5, "y": 0}]},
    )
    assert bad.status_code == 422
    sliver = await client.post(
        "/api/v1/zones",
        headers=headers,
        json={"floor_id": floor["id"], "name": "Sliver",
              "polygon": [{"x": 0, "y": 0}, {"x": 5, "y": 0}, {"x": 5, "y": 0.01}]},
    )
    assert sliver.status_code == 422
    good = await client.post(
        "/api/v1/zones",
        headers=headers,
        json={"floor_id": floor["id"], "name": "Lobby", "capacity_threshold": 40,
              "polygon": [{"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 10, "y": 8}]},
    )
    assert good.status_code == 201, good.text


async def test_map_edits_notify_the_ai_service(client, admin_credentials, fake_redis):
    headers = await _admin(client, admin_credentials)
    floor = await _floor(client, headers)
    await client.patch(
        f"/api/v1/floors/{floor['id']}",
        headers=headers,
        json={"layout": {"walls": [{"x1": 0, "y1": 0, "x2": 40, "y2": 0}]}},
    )
    commands = [data for channel, data in fake_redis.published if channel == "stream:camera-commands"]
    assert any("map_changed" in c for c in commands)


async def test_floor_layout_is_validated_and_extra_keys_kept(client, admin_credentials):
    headers = await _admin(client, admin_credentials)
    floor = await _floor(client, headers)
    bad = await client.patch(
        f"/api/v1/floors/{floor['id']}", headers=headers, json={"layout": {"walls": [{"x1": 0}]}}
    )
    assert bad.status_code == 422
    ok = await client.patch(
        f"/api/v1/floors/{floor['id']}",
        headers=headers,
        json={"layout": {"wall_height_m": 5, "walls": [{"x1": 0, "y1": 0, "x2": 4, "y2": 0}], "doors": [{"x": 2}]}},
    )
    assert ok.status_code == 200
    assert ok.json()["layout"]["doors"] == [{"x": 2}]


async def test_fields_can_be_cleared_with_explicit_null(client, admin_credentials):
    headers = await _admin(client, admin_credentials)
    floor = await _floor(client, headers)
    zone = await client.post(
        "/api/v1/zones",
        headers=headers,
        json={"floor_id": floor["id"], "name": "Hall", "capacity_threshold": 50,
              "polygon": [{"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 10, "y": 8}]},
    )
    cleared = await client.patch(
        f"/api/v1/zones/{zone.json()['id']}", headers=headers, json={"capacity_threshold": None}
    )
    assert cleared.status_code == 200 and cleared.json()["capacity_threshold"] is None


async def test_camera_error_clears_after_recovery(client, admin_credentials):
    headers = await _admin(client, admin_credentials)
    camera = await client.post(
        "/api/v1/cameras",
        headers=headers,
        json={"code": "cam-x", "name": "X", "stream_type": "simulated", "stream_url": "simulated://"},
    )
    cam_id = camera.json()["id"]
    internal = {"X-Internal-Api-Key": "dev-internal-service-key-change-me"}
    await client.post(f"/api/v1/cameras/{cam_id}/health", headers=internal,
                      json={"status": "error", "fps": 0, "latency_ms": 0, "error": "timeout"})
    recovered = await client.post(f"/api/v1/cameras/{cam_id}/health", headers=internal,
                                  json={"status": "online", "fps": 8, "latency_ms": 40, "error": None})
    assert recovered.json()["last_error"] is None
    assert recovered.json()["status"] == "online"
