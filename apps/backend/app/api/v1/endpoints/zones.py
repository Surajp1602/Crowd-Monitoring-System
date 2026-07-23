import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status

from common.rbac import Perm

from app.deps import DbSession, require_permission
from app.repositories.entities import ZoneRepository
from app.schemas.common import Page
from app.schemas.map import ZoneCreate, ZoneRead, ZoneUpdate

router = APIRouter(prefix="/zones", tags=["zones"])


@router.get("", response_model=Page[ZoneRead], dependencies=[Depends(require_permission(Perm.MAP_VIEW))])
async def list_zones(
    db: DbSession,
    floor_id: uuid.UUID | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    repo = ZoneRepository(db)
    items, total = await repo.list(offset=(page - 1) * page_size, limit=page_size, floor_id=floor_id)
    return Page(items=[ZoneRead.model_validate(z) for z in items], total=total, page=page, page_size=page_size)


@router.post("", response_model=ZoneRead, status_code=201, dependencies=[Depends(require_permission(Perm.MAP_MANAGE))])
async def create_zone(payload: ZoneCreate, db: DbSession):
    repo = ZoneRepository(db)
    zone = await repo.create(**payload.model_dump())
    await db.commit()
    await db.refresh(zone)
    return ZoneRead.model_validate(zone)


@router.get("/{zone_id}", response_model=ZoneRead, dependencies=[Depends(require_permission(Perm.MAP_VIEW))])
async def get_zone(zone_id: uuid.UUID, db: DbSession):
    zone = await ZoneRepository(db).get(zone_id)
    if zone is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zone not found")
    return ZoneRead.model_validate(zone)


@router.patch("/{zone_id}", response_model=ZoneRead, dependencies=[Depends(require_permission(Perm.MAP_MANAGE))])
async def update_zone(zone_id: uuid.UUID, payload: ZoneUpdate, db: DbSession):
    repo = ZoneRepository(db)
    zone = await repo.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zone not found")
    zone = await repo.update(zone, **payload.model_dump(exclude_unset=True))
    await db.commit()
    await db.refresh(zone)
    return ZoneRead.model_validate(zone)


@router.delete("/{zone_id}", status_code=204, dependencies=[Depends(require_permission(Perm.MAP_MANAGE))])
async def delete_zone(zone_id: uuid.UUID, db: DbSession):
    repo = ZoneRepository(db)
    zone = await repo.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zone not found")
    await repo.delete(zone)
    await db.commit()
