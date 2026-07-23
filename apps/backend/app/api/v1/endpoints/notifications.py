from fastapi import APIRouter, Depends, Query

from common.rbac import Perm

from app.deps import DbSession, require_permission
from app.repositories.entities import GeofenceSubscriptionRepository, NotificationHistoryRepository
from app.schemas.common import Page
from app.schemas.notification import (
    GeofenceSubscriptionCreate,
    GeofenceSubscriptionRead,
    NotificationHistoryRead,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get(
    "/history",
    response_model=Page[NotificationHistoryRead],
    dependencies=[Depends(require_permission(Perm.NOTIFICATION_MANAGE))],
)
async def list_notification_history(db: DbSession, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    repo = NotificationHistoryRepository(db)
    items, total = await repo.list(
        offset=(page - 1) * page_size, limit=page_size, order_by=repo.model.created_at.desc()
    )
    return Page(
        items=[NotificationHistoryRead.model_validate(i) for i in items], total=total, page=page, page_size=page_size
    )


@router.post("/subscriptions", response_model=GeofenceSubscriptionRead, status_code=201)
async def create_subscription(payload: GeofenceSubscriptionCreate, db: DbSession):
    """Public endpoint: anyone can subscribe a device/phone/email to geofenced alerts."""
    repo = GeofenceSubscriptionRepository(db)
    sub = await repo.create(**{**payload.model_dump(), "channels": [c.value for c in payload.channels]})
    await db.commit()
    await db.refresh(sub)
    return GeofenceSubscriptionRead.model_validate(sub)


@router.get(
    "/subscriptions",
    response_model=Page[GeofenceSubscriptionRead],
    dependencies=[Depends(require_permission(Perm.NOTIFICATION_MANAGE))],
)
async def list_subscriptions(db: DbSession, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    repo = GeofenceSubscriptionRepository(db)
    items, total = await repo.list(offset=(page - 1) * page_size, limit=page_size)
    return Page(
        items=[GeofenceSubscriptionRead.model_validate(i) for i in items], total=total, page=page, page_size=page_size
    )
