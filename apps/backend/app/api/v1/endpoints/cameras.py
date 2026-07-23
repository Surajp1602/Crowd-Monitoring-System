import uuid

from fastapi import APIRouter, Depends, Query

from common.enums import CameraStatus, StreamType
from common.rbac import Perm

from app.deps import CurrentUserDep, DbSession, require_internal_service, require_permission
from app.repositories.entities import CameraRepository
from app.schemas.camera import CameraCreate, CameraHealthUpdate, CameraRead, CameraUpdate
from app.schemas.common import Page
from app.services import camera_service

router = APIRouter(prefix="/cameras", tags=["cameras"])


@router.get("", response_model=Page[CameraRead], dependencies=[Depends(require_permission(Perm.CAMERA_VIEW))])
async def list_cameras(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    status_filter: CameraStatus | None = Query(None, alias="status"),
    stream_type: StreamType | None = None,
    building_id: uuid.UUID | None = None,
    floor_id: uuid.UUID | None = None,
):
    repo = CameraRepository(db)
    items, total = await repo.list(
        offset=(page - 1) * page_size,
        limit=page_size,
        status=status_filter,
        stream_type=stream_type,
        building_id=building_id,
        floor_id=floor_id,
    )
    return Page(items=[CameraRead.model_validate(c) for c in items], total=total, page=page, page_size=page_size)


@router.post("", response_model=CameraRead, status_code=201, dependencies=[Depends(require_permission(Perm.CAMERA_MANAGE))])
async def create_camera(payload: CameraCreate, db: DbSession, user: CurrentUserDep):
    camera = await camera_service.create_camera(db, payload, created_by=user.user_id)
    return CameraRead.model_validate(camera)


@router.get("/{camera_id}", response_model=CameraRead, dependencies=[Depends(require_permission(Perm.CAMERA_VIEW))])
async def get_camera(camera_id: uuid.UUID, db: DbSession):
    camera = await camera_service.get_camera_or_404(db, camera_id)
    return CameraRead.model_validate(camera)


@router.patch("/{camera_id}", response_model=CameraRead, dependencies=[Depends(require_permission(Perm.CAMERA_MANAGE))])
async def update_camera(camera_id: uuid.UUID, payload: CameraUpdate, db: DbSession):
    camera = await camera_service.get_camera_or_404(db, camera_id)
    camera = await camera_service.update_camera(db, camera, payload)
    return CameraRead.model_validate(camera)


@router.delete("/{camera_id}", status_code=204, dependencies=[Depends(require_permission(Perm.CAMERA_MANAGE))])
async def delete_camera(camera_id: uuid.UUID, db: DbSession):
    camera = await camera_service.get_camera_or_404(db, camera_id)
    await camera_service.delete_camera(db, camera)


@router.post(
    "/{camera_id}/health",
    response_model=CameraRead,
    dependencies=[Depends(require_internal_service)],
    summary="Internal: ai-service heartbeat for a camera's status/fps/latency",
)
async def report_camera_health(camera_id: uuid.UUID, payload: CameraHealthUpdate, db: DbSession):
    camera = await camera_service.get_camera_or_404(db, camera_id)
    camera = await camera_service.apply_health_update(db, camera, payload)
    return CameraRead.model_validate(camera)
