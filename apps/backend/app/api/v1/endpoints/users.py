import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from common.models import Role
from common.rbac import Perm

from app.core.security import hash_password
from app.deps import DbSession, require_permission
from app.repositories.entities import UserRepository
from app.schemas.common import Page
from app.schemas.user import UserRead, UserUpdate

router = APIRouter(
    prefix="/users", tags=["users"], dependencies=[Depends(require_permission(Perm.USER_MANAGE))]
)


@router.get("", response_model=Page[UserRead])
async def list_users(db: DbSession, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    repo = UserRepository(db)
    items, total = await repo.list(offset=(page - 1) * page_size, limit=page_size)
    for u in items:
        await db.refresh(u, attribute_names=["role"])
    return Page(items=[UserRead.model_validate(u) for u in items], total=total, page=page, page_size=page_size)


@router.get("/{user_id}", response_model=UserRead)
async def get_user(user_id: uuid.UUID, db: DbSession):
    user = await UserRepository(db).get(user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await db.refresh(user, attribute_names=["role"])
    return UserRead.model_validate(user)


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(user_id: uuid.UUID, payload: UserUpdate, db: DbSession):
    repo = UserRepository(db)
    user = await repo.get(user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    updates = payload.model_dump(exclude_unset=True, exclude={"role_name", "password"})
    if payload.password:
        updates["hashed_password"] = hash_password(payload.password)
    if payload.role_name:
        role = (await db.execute(select(Role).where(Role.name == payload.role_name))).scalar_one_or_none()
        if role is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown role")
        updates["role_id"] = role.id

    user = await repo.update(user, **updates)
    await db.commit()
    await db.refresh(user, attribute_names=["role"])
    return UserRead.model_validate(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: uuid.UUID, db: DbSession):
    repo = UserRepository(db)
    user = await repo.get(user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await repo.delete(user)
    await db.commit()
