import uuid
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import decode_token
from app.db.session import get_db

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


class CurrentUser:
    def __init__(self, user_id: uuid.UUID | None, role: str, is_guest: bool, permissions: list[str]):
        self.user_id = user_id
        self.role = role
        self.is_guest = is_guest
        self.permissions = set(permissions)

    def has_permission(self, code: str) -> bool:
        return code in self.permissions


DbSession = Annotated[AsyncSession, Depends(get_db)]


def user_from_token_payload(payload: dict) -> CurrentUser:
    is_guest = bool(payload.get("is_guest", False))
    return CurrentUser(
        user_id=None if is_guest else uuid.UUID(payload.get("sub")),
        role=payload.get("role", "guest"),
        is_guest=is_guest,
        permissions=payload.get("permissions", []),
    )


async def get_current_user(token: Annotated[str | None, Depends(oauth2_scheme)]) -> CurrentUser:
    if token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong token type")
    return user_from_token_payload(payload)


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]


def require_permission(code: str):
    async def _checker(user: CurrentUserDep) -> CurrentUser:
        if not user.has_permission(code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {code}",
            )
        return user

    return _checker


def require_authenticated_staff(user: CurrentUserDep) -> CurrentUser:
    """Any logged-in authority user (not a guest session)."""
    if user.is_guest or user.user_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Authority login required")
    return user


async def require_internal_service(x_internal_api_key: Annotated[str | None, Header()] = None) -> None:
    """Guards service-to-service endpoints (ai-service/worker -> backend ingest routes)."""
    settings = get_settings()
    if x_internal_api_key != settings.INTERNAL_SERVICE_API_KEY:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal service key")
