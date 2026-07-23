from fastapi import APIRouter, Depends, HTTPException, status

from common.rbac import Perm

from app.deps import DbSession, require_permission
from app.repositories.entities import SettingRepository
from app.schemas.settings import SettingRead, SettingUpdate

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=list[SettingRead], dependencies=[Depends(require_permission(Perm.SETTINGS_MANAGE))])
async def list_settings(db: DbSession):
    repo = SettingRepository(db)
    items, _ = await repo.list(limit=200)
    return [SettingRead(key=i.key, value=i.value) for i in items]


@router.get("/{key}", response_model=SettingRead, dependencies=[Depends(require_permission(Perm.SETTINGS_MANAGE))])
async def get_setting(key: str, db: DbSession):
    repo = SettingRepository(db)
    setting = await repo.get(key)
    if setting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Setting not found")
    return SettingRead(key=setting.key, value=setting.value)


@router.put("/{key}", response_model=SettingRead, dependencies=[Depends(require_permission(Perm.AI_CONFIG_MANAGE))])
async def update_setting(key: str, payload: SettingUpdate, db: DbSession):
    repo = SettingRepository(db)
    setting = await repo.get(key)
    if setting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Setting not found")
    setting = await repo.update(setting, value=payload.value)
    await db.commit()
    return SettingRead(key=setting.key, value=setting.value)
