"""Point-in-time reads of live state cached in Redis, for clients that can't hold a
WebSocket open (and for the first paint before the socket delivers anything)."""

import uuid

import orjson
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from common.models import Camera
from common.rbac import Perm
from common.redis_channels import CAMERA_HEALTH_KEY_PREFIX, HEATMAP_KEY_PREFIX

from app.core.redis import get_redis
from app.deps import DbSession, require_permission

router = APIRouter(prefix="/live", tags=["live"])


@router.get("/floors/{floor_id}/heatmap", dependencies=[Depends(require_permission(Perm.MAP_VIEW))])
async def latest_heatmap(floor_id: uuid.UUID) -> dict:
    raw = await get_redis().get(f"{HEATMAP_KEY_PREFIX}{floor_id}")
    if raw is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No live heatmap for this floor")
    return orjson.loads(raw)


@router.get("/cameras", dependencies=[Depends(require_permission(Perm.CAMERA_VIEW))])
async def live_camera_status(db: DbSession) -> dict[str, dict | None]:
    camera_ids = [str(cid) for cid in (await db.execute(select(Camera.id))).scalars().all()]
    if not camera_ids:
        return {}
    values = await get_redis().mget([f"{CAMERA_HEALTH_KEY_PREFIX}{cid}" for cid in camera_ids])
    return {cid: (orjson.loads(v) if v else None) for cid, v in zip(camera_ids, values)}
