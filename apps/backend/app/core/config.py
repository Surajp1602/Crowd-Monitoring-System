from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "Crowd Density Platform API"
    ENVIRONMENT: str = "development"
    API_V1_PREFIX: str = "/api/v1"
    DEBUG: bool = True

    DATABASE_URL: str = "postgresql+asyncpg://ccd:ccd@postgres:5432/ccd"
    REDIS_URL: str = "redis://redis:6379/0"

    SECRET_KEY: str = "change-me-in-production-this-is-not-secure"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14
    JWT_ALGORITHM: str = "HS256"

    CAMERA_CREDENTIAL_ENCRYPTION_KEY: str = "3vY9x2b6w0G8e5v3q9m1n4p7r0t2u5x8A1b3D6f9J2k="
    """Fernet key used to encrypt stored camera stream passwords. Generate with
    `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
    and override via env in any real deployment."""

    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:3001"]

    GUEST_TOKEN_EXPIRE_MINUTES: int = 120

    FIRST_ADMIN_EMAIL: str = "admin@ccd-platform.com"
    FIRST_ADMIN_PASSWORD: str = "ChangeMe123!"
    FIRST_ADMIN_NAME: str = "Platform Administrator"

    INTERNAL_SERVICE_API_KEY: str = "dev-internal-service-key-change-me"
    """Shared secret ai-service/worker use to call backend-internal ingest endpoints."""

    SEED_DEMO_DATA: bool = False
    """Seed a demo facility with simulated cameras on first boot (empty database only)."""

    ENABLE_WS_BRIDGE: bool = True
    """Run the Redis -> WebSocket bridge in this process. Disabled by the test suite."""

    STORAGE_DIR: str = "/data/media"
    """Local mount for alert snapshots/clips; swap for S3/Blob in production via storage backend."""


@lru_cache
def get_settings() -> Settings:
    return Settings()
