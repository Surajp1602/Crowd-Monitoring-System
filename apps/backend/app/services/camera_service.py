import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from common.enums import CameraStatus
from common.models import Camera
from common.redis_channels import CAMERA_COMMANDS_CHANNEL

from app.core.redis import publish_event
from app.core.security import encrypt_secret
from app.repositories.entities import CameraRepository
from app.schemas.camera import CameraCreate, CameraHealthUpdate, CameraUpdate


async def create_camera(db: AsyncSession, payload: CameraCreate, created_by: uuid.UUID | None) -> Camera:
    repo = CameraRepository(db)
    existing, _ = await repo.list(code=payload.code, limit=1)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Camera code already exists")

    data = payload.model_dump(exclude={"stream_password"})
    if payload.stream_password:
        data["stream_password_encrypted"] = encrypt_secret(payload.stream_password)
    camera = await repo.create(**data, created_by=created_by, status=CameraStatus.STARTING)
    await db.commit()
    await db.refresh(camera)
    await publish_event(CAMERA_COMMANDS_CHANNEL, {"action": "created", "camera_id": str(camera.id)})
    return camera


async def update_camera(db: AsyncSession, camera: Camera, payload: CameraUpdate) -> Camera:
    repo = CameraRepository(db)
    data = payload.model_dump(exclude_unset=True, exclude={"stream_password"})
    if payload.stream_password:
        data["stream_password_encrypted"] = encrypt_secret(payload.stream_password)
    camera = await repo.update(camera, **data)
    await db.commit()
    await db.refresh(camera)
    await publish_event(CAMERA_COMMANDS_CHANNEL, {"action": "updated", "camera_id": str(camera.id)})
    return camera


async def get_camera_or_404(db: AsyncSession, camera_id: uuid.UUID) -> Camera:
    camera = await CameraRepository(db).get(camera_id)
    if camera is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    return camera


async def delete_camera(db: AsyncSession, camera: Camera) -> None:
    camera_id = str(camera.id)
    await CameraRepository(db).delete(camera)
    await db.commit()
    await publish_event(CAMERA_COMMANDS_CHANNEL, {"action": "deleted", "camera_id": camera_id})


async def apply_health_update(db: AsyncSession, camera: Camera, payload: CameraHealthUpdate) -> Camera:
    repo = CameraRepository(db)
    camera = await repo.update(
        camera,
        status=payload.status,
        fps=payload.fps,
        latency_ms=payload.latency_ms,
        last_error=payload.error,
        last_seen_at=datetime.now(timezone.utc),
    )
    await db.commit()
    await db.refresh(camera)
    return camera
