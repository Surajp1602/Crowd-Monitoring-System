from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    SERVICE_NAME: str = "ccd-worker"
    DATABASE_URL: str = "postgresql+asyncpg://ccd:ccd@postgres:5432/ccd"
    REDIS_URL: str = "redis://redis:6379/0"
    HEALTH_PORT: int = 8090
    CONSUMER_NAME: str = ""
    """Defaults to hostname-pid; must be unique per replica within the consumer group."""

    PUBLIC_DASHBOARD_URL: str = "http://localhost:3000"
    """Used to build unsubscribe and alert links in outgoing messages."""

    # ---- Providers (pluggable; safe no-op defaults) ----
    NOTIFICATION_EMAIL_PROVIDER: str = "noop"
    """noop | console | smtp"""
    NOTIFICATION_SMS_PROVIDER: str = "noop"
    """noop | console | twilio"""
    NOTIFICATION_WHATSAPP_PROVIDER: str = "noop"
    """noop | console | twilio"""
    NOTIFICATION_PUSH_PROVIDER: str = "noop"
    """noop | console | fcm | webhook"""
    NOTIFICATION_ANNOUNCEMENT_PROVIDER: str = "noop"
    """noop | console | webhook (public address / signage system)"""

    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_STARTTLS: bool = True
    SMTP_FROM: str = "CCD Alerts <alerts@ccd-platform.com>"

    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_SMS_FROM: str = ""
    TWILIO_WHATSAPP_FROM: str = ""
    """e.g. +14155238886 (the 'whatsapp:' prefix is added automatically)."""

    FCM_SERVICE_ACCOUNT_FILE: str = ""
    """Path to a Firebase service-account JSON; the project id is read from it."""

    PUSH_WEBHOOK_URL: str = ""
    ANNOUNCEMENT_WEBHOOK_URL: str = ""
    WEBHOOK_SECRET: str = ""
    """If set, outgoing webhooks carry an X-CCD-Signature HMAC-SHA256 of the body."""

    # ---- Delivery policy ----
    SEND_ATTEMPTS: int = 3
    RETRY_BASE_DELAY_S: float = 2.0
    CLAIM_IDLE_MS: int = 60_000
    """Messages a dead consumer left pending longer than this are reclaimed."""

    # ---- Analytics rollups and retention (Phase 8) ----
    ROLLUP_INTERVAL_S: float = 60.0
    RETENTION_DAYS_FRAMES: int = 14
    RETENTION_DAYS_TRACK_POINTS: int = 7
    RETENTION_DAYS_METRICS: int = 400


@lru_cache
def get_settings() -> Settings:
    return Settings()
