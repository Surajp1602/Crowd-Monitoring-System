import pytest

from app.core.config import Settings, get_settings


async def test_login_is_rate_limited_per_account(client, admin_credentials, monkeypatch):
    monkeypatch.setattr(get_settings(), "LOGIN_RATE_PER_ACCOUNT", 3)
    wrong = {"email": admin_credentials["email"], "password": "not-it"}
    for _ in range(3):
        assert (await client.post("/api/v1/auth/login", json=wrong)).status_code == 401
    blocked = await client.post("/api/v1/auth/login", json=admin_credentials)
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0
    # Another account from the same address is still allowed until the per-address limit.
    other = await client.post("/api/v1/auth/login", json={"email": "someone@else.com", "password": "x"})
    assert other.status_code == 401


async def test_rate_limiter_fails_open_without_redis(client, admin_credentials, monkeypatch):
    import app.core.ratelimit as rl

    def broken():
        raise ConnectionError("redis down")

    monkeypatch.setattr(rl, "get_redis", broken)
    assert (await client.post("/api/v1/auth/login", json=admin_credentials)).status_code == 200


async def test_responses_carry_security_headers(client):
    resp = await client.get("/health")
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["x-frame-options"] == "DENY"
    assert "default-src 'none'" in resp.headers["content-security-policy"]


async def test_metrics_count_requests_by_route_template(client, monkeypatch):
    await client.get("/health")
    body = (await client.get("/metrics")).text
    assert 'ccd_http_requests_total{method="GET",route="/health",status="200"}' in body

    monkeypatch.setattr(get_settings(), "METRICS_TOKEN", "scrape-me")
    assert (await client.get("/metrics")).status_code == 401
    assert (await client.get("/metrics", headers={"Authorization": "Bearer scrape-me"})).status_code == 200


def test_production_refuses_development_secrets():
    with pytest.raises(ValueError, match="SECRET_KEY"):
        Settings(ENVIRONMENT="production", DEBUG=False, _env_file=None)
    ok = Settings(
        ENVIRONMENT="production",
        DEBUG=False,
        SECRET_KEY="x" * 48,
        INTERNAL_SERVICE_API_KEY="internal-" + "y" * 32,
        CAMERA_CREDENTIAL_ENCRYPTION_KEY="Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5PQ==",
        FIRST_ADMIN_PASSWORD="a-long-unique-password",
        _env_file=None,
    )
    assert ok.ENVIRONMENT == "production"
