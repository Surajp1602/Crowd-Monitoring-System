import hashlib
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from common.enums import RoleName
from common.models import RefreshToken, Role, User

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _load_user_with_role(db: AsyncSession, email: str) -> User | None:
    stmt = select(User).where(User.email == email)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if user is None:
        return None
    await db.refresh(user, attribute_names=["role"])
    return user


async def _permissions_for_role(db: AsyncSession, role: Role | None) -> list[str]:
    if role is None:
        return []
    await db.refresh(role, attribute_names=["permissions"])
    return [p.code for p in role.permissions]


async def authenticate(db: AsyncSession, email: str, password: str) -> tuple[User, str, str]:
    user = await _load_user_with_role(db, email)
    if user is None or not user.hashed_password or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")

    role_name = user.role.name if user.role else RoleName.VIEWER.value
    permissions = await _permissions_for_role(db, user.role)

    access_token = create_access_token(str(user.id), role_name, is_guest=False, permissions=permissions)
    refresh_token, expires_at = create_refresh_token(str(user.id))
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=_hash_token(refresh_token),
            expires_at=expires_at,
            created_at=datetime.now(timezone.utc),
        )
    )
    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user, attribute_names=["role"])
    return user, access_token, refresh_token


async def refresh_access_token(db: AsyncSession, refresh_token: str) -> str:
    try:
        payload = decode_token(refresh_token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token") from exc
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong token type")

    token_hash = _hash_token(refresh_token)
    stmt = select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    stored = (await db.execute(stmt)).scalar_one_or_none()
    if stored is None or stored.revoked:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired or revoked")
    expires_at = stored.expires_at
    if expires_at.tzinfo is None:
        # SQLite (used in tests) doesn't persist tzinfo; Postgres always returns aware datetimes.
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired or revoked")

    user = await db.get(User, uuid.UUID(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    await db.refresh(user, attribute_names=["role"])

    role_name = user.role.name if user.role else RoleName.VIEWER.value
    permissions = await _permissions_for_role(db, user.role)
    return create_access_token(str(user.id), role_name, is_guest=False, permissions=permissions)


async def revoke_refresh_token(db: AsyncSession, refresh_token: str) -> None:
    token_hash = _hash_token(refresh_token)
    stmt = select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    stored = (await db.execute(stmt)).scalar_one_or_none()
    if stored is not None:
        stored.revoked = True
        await db.commit()


def create_guest_access_token() -> str:
    from common.rbac import ROLE_PERMISSIONS

    permissions = ROLE_PERMISSIONS.get(RoleName.GUEST, [])
    return create_access_token(user_id="guest", role=RoleName.GUEST.value, is_guest=True, permissions=permissions)


async def create_user(
    db: AsyncSession, *, email: str, password: str, full_name: str, role_name: str, phone_number: str | None = None
) -> User:
    existing = await _load_user_with_role(db, email)
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    stmt = select(Role).where(Role.name == role_name)
    role = (await db.execute(stmt)).scalar_one_or_none()
    if role is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown role: {role_name}")

    user = User(
        email=email,
        hashed_password=hash_password(password),
        full_name=full_name,
        role_id=role.id,
        phone_number=phone_number,
        is_active=True,
        is_guest=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user, attribute_names=["role"])
    return user
