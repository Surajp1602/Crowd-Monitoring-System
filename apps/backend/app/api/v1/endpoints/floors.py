import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status

from common.rbac import Perm
from common.redis_channels import CAMERA_COMMANDS_CHANNEL

from app.core.redis import publish_event
from app.deps import DbSession, require_permission
from app.repositories.entities import FloorRepository
from app.schemas.common import Page
from app.schemas.map import FloorCreate, FloorRead, FloorUpdate

router = APIRouter(prefix="/floors", tags=["floors"])


@router.get("", response_model=Page[FloorRead], dependencies=[Depends(require_permission(Perm.MAP_VIEW))])
async def list_floors(
    db: DbSession,
    building_id: uuid.UUID | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    repo = FloorRepository(db)
    items, total = await repo.list(offset=(page - 1) * page_size, limit=page_size, building_id=building_id)
    return Page(items=[FloorRead.model_validate(f) for f in items], total=total, page=page, page_size=page_size)


@router.post("", response_model=FloorRead, status_code=201, dependencies=[Depends(require_permission(Perm.MAP_MANAGE))])
async def create_floor(payload: FloorCreate, db: DbSession):
    repo = FloorRepository(db)
    floor = await repo.create(**payload.model_dump())
    await db.commit()
    await db.refresh(floor)
    await publish_event(CAMERA_COMMANDS_CHANNEL, {"action": "map_changed", "floor_id": str(floor.id)})
    return FloorRead.model_validate(floor)


@router.get("/{floor_id}", response_model=FloorRead, dependencies=[Depends(require_permission(Perm.MAP_VIEW))])
async def get_floor(floor_id: uuid.UUID, db: DbSession):
    floor = await FloorRepository(db).get(floor_id)
    if floor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Floor not found")
    return FloorRead.model_validate(floor)


@router.patch("/{floor_id}", response_model=FloorRead, dependencies=[Depends(require_permission(Perm.MAP_MANAGE))])
async def update_floor(floor_id: uuid.UUID, payload: FloorUpdate, db: DbSession):
    repo = FloorRepository(db)
    floor = await repo.get(floor_id)
    if floor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Floor not found")
    floor = await repo.update(floor, **payload.model_dump(exclude_unset=True))
    await db.commit()
    await db.refresh(floor)
    await publish_event(CAMERA_COMMANDS_CHANNEL, {"action": "map_changed", "floor_id": str(floor.id)})
    return FloorRead.model_validate(floor)


@router.delete("/{floor_id}", status_code=204, dependencies=[Depends(require_permission(Perm.MAP_MANAGE))])
async def delete_floor(floor_id: uuid.UUID, db: DbSession):
    repo = FloorRepository(db)
    floor = await repo.get(floor_id)
    if floor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Floor not found")
    await repo.delete(floor)
    await db.commit()
    await publish_event(CAMERA_COMMANDS_CHANNEL, {"action": "map_changed", "floor_id": str(floor_id)})
