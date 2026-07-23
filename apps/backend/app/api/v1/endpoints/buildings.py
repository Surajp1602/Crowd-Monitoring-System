import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status

from common.rbac import Perm

from app.deps import DbSession, require_permission
from app.repositories.entities import BuildingRepository
from app.schemas.common import Page
from app.schemas.map import BuildingCreate, BuildingRead, BuildingUpdate

router = APIRouter(prefix="/buildings", tags=["buildings"])


@router.get("", response_model=Page[BuildingRead], dependencies=[Depends(require_permission(Perm.MAP_VIEW))])
async def list_buildings(db: DbSession, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    repo = BuildingRepository(db)
    items, total = await repo.list(offset=(page - 1) * page_size, limit=page_size)
    return Page(items=[BuildingRead.model_validate(b) for b in items], total=total, page=page, page_size=page_size)


@router.post("", response_model=BuildingRead, status_code=201, dependencies=[Depends(require_permission(Perm.MAP_MANAGE))])
async def create_building(payload: BuildingCreate, db: DbSession):
    repo = BuildingRepository(db)
    building = await repo.create(**payload.model_dump())
    await db.commit()
    await db.refresh(building)
    return BuildingRead.model_validate(building)


@router.get("/{building_id}", response_model=BuildingRead, dependencies=[Depends(require_permission(Perm.MAP_VIEW))])
async def get_building(building_id: uuid.UUID, db: DbSession):
    building = await BuildingRepository(db).get(building_id)
    if building is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Building not found")
    return BuildingRead.model_validate(building)


@router.patch("/{building_id}", response_model=BuildingRead, dependencies=[Depends(require_permission(Perm.MAP_MANAGE))])
async def update_building(building_id: uuid.UUID, payload: BuildingUpdate, db: DbSession):
    repo = BuildingRepository(db)
    building = await repo.get(building_id)
    if building is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Building not found")
    building = await repo.update(building, **payload.model_dump(exclude_unset=True))
    await db.commit()
    await db.refresh(building)
    return BuildingRead.model_validate(building)


@router.delete("/{building_id}", status_code=204, dependencies=[Depends(require_permission(Perm.MAP_MANAGE))])
async def delete_building(building_id: uuid.UUID, db: DbSession):
    repo = BuildingRepository(db)
    building = await repo.get(building_id)
    if building is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Building not found")
    await repo.delete(building)
    await db.commit()
