from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    SERVICE_NAME: str = "ccd-ai-service"
    ENVIRONMENT: str = "development"

    DATABASE_URL: str = "postgresql+asyncpg://ccd:ccd@postgres:5432/ccd"
    REDIS_URL: str = "redis://redis:6379/0"
    BACKEND_URL: str = "http://backend:8000"
    INTERNAL_SERVICE_API_KEY: str = "dev-internal-service-key-change-me"
    CAMERA_CREDENTIAL_ENCRYPTION_KEY: str = "3vY9x2b6w0G8e5v3q9m1n4p7r0t2u5x8A1b3D6f9J2k="

    HEALTH_PORT: int = 8080

    # --- Model / device ---
    YOLO_MODEL: str = "yolo11n.pt"
    DEVICE: str = "auto"
    """"auto" picks CUDA if available else CPU. Can be pinned to "cuda", "cuda:0", or "cpu"."""
    MODEL_CACHE_DIR: str = "/data/models"

    # --- Pipeline cadence ---
    CAMERA_POLL_INTERVAL_S: float = 10.0
    """How often the manager re-checks the DB for camera add/remove/config changes."""
    HEALTH_REPORT_INTERVAL_S: float = 5.0
    DB_PERSIST_INTERVAL_S: float = 2.0
    """Aggregate DetectionFrame/Track rows are flushed to Postgres at most this often per camera."""
    PREVIEW_FPS: float = 2.0
    """Annotated JPEG previews per second per camera sent to the live camera wall."""
    RECONNECT_BACKOFF_S: float = 5.0
    MAX_RECONNECT_BACKOFF_S: float = 60.0

    # --- Defaults, overridden per-camera by Camera.config and globally by the settings table ---
    DEFAULT_CONFIDENCE_THRESHOLD: float = 0.45
    DEFAULT_IOU_THRESHOLD: float = 0.45
    DEFAULT_FRAME_SKIP: int = 1
    DEFAULT_INPUT_SIZE: int = 640


@lru_cache
def get_settings() -> Settings:
    return Settings()
