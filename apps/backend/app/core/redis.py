import logging
from functools import lru_cache

import orjson
import redis.asyncio as redis

from app.core.config import get_settings

logger = logging.getLogger("ccd.redis")


@lru_cache
def get_redis() -> redis.Redis:
    settings = get_settings()
    return redis.from_url(
        settings.REDIS_URL, decode_responses=True, socket_connect_timeout=3, health_check_interval=30
    )


async def publish_event(channel: str, payload: dict) -> None:
    """Best-effort fan-out. The database write that triggered the event has already
    committed, and every consumer also reconciles from the DB, so a Redis outage
    degrades live updates instead of failing the API request."""
    try:
        await get_redis().publish(channel, orjson.dumps(payload).decode())
    except Exception:  # noqa: BLE001 - any Redis failure is non-fatal here
        logger.warning("Could not publish to Redis channel %s", channel, exc_info=True)
