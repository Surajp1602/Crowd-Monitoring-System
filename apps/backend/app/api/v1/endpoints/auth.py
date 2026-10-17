from fastapi import APIRouter, Depends, HTTPException, status

from common.rbac import Perm

from app.core.config import get_settings
from app.deps import CurrentUserDep, DbSession, require_permission
from app.schemas.auth import (
    AccessTokenResponse,
    GuestSessionResponse,
    LoginRequest,
    RefreshRequest,
    TokenPair,
)
from app.schemas.user import UserCreate, UserRead
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


@router.post("/login", response_model=TokenPair)
async def login(payload: LoginRequest, db: DbSession):
    user, access_token, refresh_token = await auth_service.authenticate(db, payload.email, payload.password)
    return TokenPair(access_token=access_token, refresh_token=refresh_token, user=UserRead.model_validate(user))


@router.post("/refresh", response_model=AccessTokenResponse)
async def refresh(payload: RefreshRequest, db: DbSession):
    access_token = await auth_service.refresh_access_token(db, payload.refresh_token)
    return AccessTokenResponse(access_token=access_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, db: DbSession):
    await auth_service.revoke_refresh_token(db, payload.refresh_token)


@router.post("/guest", response_model=GuestSessionResponse)
async def guest_session():
    token = auth_service.create_guest_access_token()
    return GuestSessionResponse(access_token=token, expires_in_minutes=settings.GUEST_TOKEN_EXPIRE_MINUTES)


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(Perm.USER_MANAGE))],
)
async def register_user(payload: UserCreate, db: DbSession):
    if payload.role_name == "admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot self-service create admin accounts")
    user = await auth_service.create_user(
        db,
        email=payload.email,
        password=payload.password,
        full_name=payload.full_name,
        role_name=payload.role_name,
        phone_number=payload.phone_number,
    )
    return UserRead.model_validate(user)


@router.get("/me", response_model=dict)
async def read_me(user: CurrentUserDep):
    return {
        "user_id": str(user.user_id) if user.user_id else None,
        "role": user.role,
        "is_guest": user.is_guest,
        "permissions": sorted(user.permissions),
    }
