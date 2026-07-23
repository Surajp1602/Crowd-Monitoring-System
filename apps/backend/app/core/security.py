import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from cryptography.fernet import Fernet
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

TokenType = Literal["access", "refresh"]


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def _create_token(subject: str, token_type: TokenType, expires_delta: timedelta, extra: dict[str, Any] | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
        "jti": str(uuid.uuid4()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_access_token(user_id: str, role: str, is_guest: bool = False, permissions: list[str] | None = None) -> str:
    minutes = settings.GUEST_TOKEN_EXPIRE_MINUTES if is_guest else settings.ACCESS_TOKEN_EXPIRE_MINUTES
    return _create_token(
        subject=user_id,
        token_type="access",
        expires_delta=timedelta(minutes=minutes),
        extra={"role": role, "is_guest": is_guest, "permissions": permissions or []},
    )


def create_refresh_token(user_id: str) -> tuple[str, datetime]:
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    token = _create_token(subject=user_id, token_type="refresh", expires_delta=timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS))
    return token, expires_at


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as exc:
        raise ValueError("Invalid or expired token") from exc


def _fernet() -> Fernet:
    return Fernet(settings.CAMERA_CREDENTIAL_ENCRYPTION_KEY.encode())


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_secret(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()
