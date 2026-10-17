"""Signed, expiring URLs for files on the media volume (alert snapshots and clips).

Snapshots show people, so they are never public. Browsers load them through <img>,
which cannot send an Authorization header, so instead of a session check the URL
carries an HMAC over (path, expiry) issued only to users who could read the alert.
"""

import hashlib
import hmac
import time
from pathlib import Path
from urllib.parse import quote

from app.core.config import get_settings

DEFAULT_TTL_S = 3600


def _signature(path: str, expires: int) -> str:
    key = get_settings().SECRET_KEY.encode()
    return hmac.new(key, f"{path}:{expires}".encode(), hashlib.sha256).hexdigest()[:32]


def sign_media_path(path: str | None, ttl_s: int = DEFAULT_TTL_S) -> str | None:
    """Relative media path -> signed API URL. Absolute URLs (external storage) pass through."""
    if not path:
        return None
    if path.startswith(("http://", "https://")):
        return path
    expires = int(time.time()) + ttl_s
    settings = get_settings()
    return f"{settings.API_V1_PREFIX}/media/{quote(path)}?exp={expires}&sig={_signature(path, expires)}"


def verify_media_signature(path: str, expires: int, signature: str) -> bool:
    if expires < time.time():
        return False
    return hmac.compare_digest(_signature(path, expires), signature)


def resolve_media_file(path: str) -> Path | None:
    """Maps a relative media path to a file inside STORAGE_DIR, refusing traversal."""
    root = Path(get_settings().STORAGE_DIR).resolve()
    target = (root / path).resolve()
    if root not in target.parents or not target.is_file():
        return None
    return target
