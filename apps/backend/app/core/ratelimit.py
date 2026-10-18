"""Fixed-window rate limits in Redis, for the endpoints worth guessing at (sign-in).

Two windows guard login: one per client address and account, which stops password guessing on a
single account, and a wider one per address, which stops spraying many accounts from one place.
A Redis outage fails open: sign-in must keep working when the cache is down, and NGINX applies its
own coarse limit in front.
"""

import hashlib
import logging
import time

from fastapi import HTTPException, Request, status

from app.core.config import get_settings
from app.core.redis import get_redis

logger = logging.getLogger("ccd.ratelimit")


def client_ip(request: Request) -> str:
    """The proxy's X-Real-IP when the request came through it, else the socket peer."""
    settings = get_settings()
    peer = request.client.host if request.client else "unknown"
    if settings.TRUST_PROXY_HEADERS:
        return request.headers.get("x-real-ip") or peer
    return peer


async def hit(key: str, limit: int, window_s: int) -> int | None:
    """Counts one request in the current window. Returns seconds until the window resets when the
    limit is exceeded, else None."""
    bucket = int(time.time() // window_s)
    redis_key = f"ratelimit:{key}:{bucket}"
    try:
        r = get_redis()
        count = await r.incr(redis_key)
        if count == 1:
            await r.expire(redis_key, window_s)
    except Exception:  # noqa: BLE001 - fail open, see module docstring
        logger.warning("Rate limiter unavailable; allowing request", exc_info=True)
        return None
    if count > limit:
        return window_s - int(time.time() % window_s)
    return None


async def limit_login(request: Request, email: str) -> None:
    settings = get_settings()
    if not settings.LOGIN_RATE_LIMIT_ENABLED:
        return
    ip = client_ip(request)
    account = hashlib.sha256(email.strip().lower().encode()).hexdigest()[:16]
    window = settings.LOGIN_RATE_WINDOW_S
    for key, limit in (
        (f"login:acct:{ip}:{account}", settings.LOGIN_RATE_PER_ACCOUNT),
        (f"login:ip:{ip}", settings.LOGIN_RATE_PER_IP),
    ):
        retry_after = await hit(key, limit, window)
        if retry_after is not None:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many sign-in attempts. Try again shortly.",
                headers={"Retry-After": str(retry_after)},
            )
