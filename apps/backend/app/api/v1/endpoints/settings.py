from fastapi import APIRouter, HTTPException, status

from common.rbac import Perm

from app.deps import CurrentUserDep, DbSession
from app.repositories.entities import SettingRepository
from app.schemas.settings import SettingRead, SettingUpdate

router = APIRouter(prefix="/settings", tags=["settings"])

# Who may change which setting: detection thresholds belong to AI configuration,
# notification routing to whoever manages notifications. Anything else is platform-wide.
KEY_PERMISSIONS: dict[str, str] = {
    "yolo": Perm.AI_CONFIG_MANAGE,
    "tracking": Perm.AI_CONFIG_MANAGE,
    "density": Perm.AI_CONFIG_MANAGE,
    "anomaly": Perm.AI_CONFIG_MANAGE,
    "heatmap": Perm.AI_CONFIG_MANAGE,
    "notifications": Perm.NOTIFICATION_MANAGE,
}


def _required(key: str) -> str:
    return KEY_PERMISSIONS.get(key, Perm.SETTINGS_MANAGE)


def _can_read(user, key: str) -> bool:
    return user.has_permission(Perm.SETTINGS_MANAGE) or user.has_permission(_required(key))


@router.get("", response_model=list[SettingRead])
async def list_settings(db: DbSession, user: CurrentUserDep):
    items, _ = await SettingRepository(db).list(limit=200)
    visible = [SettingRead(key=i.key, value=i.value) for i in items if _can_read(user, i.key)]
    if not visible:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No settings you can manage")
    return visible


@router.get("/{key}", response_model=SettingRead)
async def get_setting(key: str, db: DbSession, user: CurrentUserDep):
    if not _can_read(user, key):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Missing required permission: {_required(key)}")
    setting = await SettingRepository(db).get(key)
    if setting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Setting not found")
    return SettingRead(key=setting.key, value=setting.value)


@router.put("/{key}", response_model=SettingRead)
async def update_setting(key: str, payload: SettingUpdate, db: DbSession, user: CurrentUserDep):
    if not user.has_permission(_required(key)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Missing required permission: {_required(key)}")
    repo = SettingRepository(db)
    setting = await repo.get(key)
    if setting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Setting not found")
    # Merge, so a client editing one field never silently drops the others.
    setting = await repo.update(setting, value={**(setting.value or {}), **payload.value})
    await db.commit()
    return SettingRead(key=setting.key, value=setting.value)
