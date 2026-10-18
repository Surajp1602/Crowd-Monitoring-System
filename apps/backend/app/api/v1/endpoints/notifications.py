import uuid

import orjson
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select

from common.enums import NotificationChannel, NotificationStatus
from common.models import GeofenceSubscription
from common.rbac import Perm
from common.redis_channels import WORKER_HEARTBEAT_KEY

from app.core.redis import get_redis
from app.deps import DbSession, require_permission
from app.repositories.entities import GeofenceSubscriptionRepository, NotificationHistoryRepository
from app.schemas.common import Page
from app.schemas.notification import (
    GeofenceSubscriptionCreate,
    GeofenceSubscriptionCreated,
    GeofenceSubscriptionRead,
    NotificationHistoryRead,
    TestNotification,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])

OUTBOX_STREAM = "notifications:outbox"
SUBSCRIBE_LIMIT_PER_10_MIN = 10


def _mask(sub: GeofenceSubscription) -> str:
    if sub.email:
        local, _, domain = sub.email.partition("@")
        return f"{local[:2]}***@{domain}"
    if sub.phone_number:
        return f"{sub.phone_number[:3]}****{sub.phone_number[-2:]}"
    if sub.device_token:
        return f"device …{sub.device_token[-6:]}"
    return ""


def _read(sub: GeofenceSubscription) -> GeofenceSubscriptionRead:
    read = GeofenceSubscriptionRead.model_validate(sub)
    read.contact = _mask(sub)
    return read


@router.get(
    "/history",
    response_model=Page[NotificationHistoryRead],
    dependencies=[Depends(require_permission(Perm.NOTIFICATION_MANAGE))],
)
async def list_notification_history(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    channel: NotificationChannel | None = None,
    status_filter: NotificationStatus | None = Query(None, alias="status"),
    alert_id: uuid.UUID | None = None,
):
    repo = NotificationHistoryRepository(db)
    items, total = await repo.list(
        offset=(page - 1) * page_size,
        limit=page_size,
        order_by=repo.model.created_at.desc(),
        channel=channel,
        status=status_filter,
        alert_id=alert_id,
    )
    return Page(items=[NotificationHistoryRead.model_validate(i) for i in items], total=total, page=page, page_size=page_size)


@router.post("/subscriptions", response_model=GeofenceSubscriptionCreated, status_code=201)
async def create_subscription(payload: GeofenceSubscriptionCreate, db: DbSession, request: Request):
    """Public: anyone can subscribe a phone, email or device to geofenced safety notices."""
    client = request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown").split(",")[0]
    try:
        key = f"ratelimit:subscribe:{client.strip()}"
        attempts = await get_redis().incr(key)
        if attempts == 1:
            await get_redis().expire(key, 600)
        if attempts > SUBSCRIBE_LIMIT_PER_10_MIN:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many subscriptions, try later")
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 - fail open if Redis is down; the endpoint stays usable
        pass

    repo = GeofenceSubscriptionRepository(db)
    sub = await repo.create(**{**payload.model_dump(), "channels": [c.value for c in payload.channels]})
    await db.commit()
    await db.refresh(sub)
    created = GeofenceSubscriptionCreated.model_validate(sub)
    created.contact = _mask(sub)
    return created


@router.post("/subscriptions/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe(db: DbSession, token: str = Query(min_length=20, max_length=64)):
    """Public: the token from the subscription response or from any notice's link."""
    sub = (
        await db.execute(select(GeofenceSubscription).where(GeofenceSubscription.unsubscribe_token == token))
    ).scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown or already removed subscription")
    sub.is_active = False
    await db.commit()


@router.get(
    "/subscriptions",
    response_model=Page[GeofenceSubscriptionRead],
    dependencies=[Depends(require_permission(Perm.NOTIFICATION_MANAGE))],
)
async def list_subscriptions(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    active: bool | None = True,
):
    repo = GeofenceSubscriptionRepository(db)
    items, total = await repo.list(offset=(page - 1) * page_size, limit=page_size, is_active=active)
    return Page(items=[_read(i) for i in items], total=total, page=page, page_size=page_size)


@router.delete(
    "/subscriptions/{subscription_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(Perm.NOTIFICATION_MANAGE))],
)
async def delete_subscription(subscription_id: uuid.UUID, db: DbSession):
    repo = GeofenceSubscriptionRepository(db)
    sub = await repo.get(subscription_id)
    if sub is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subscription not found")
    await repo.delete(sub)
    await db.commit()


@router.get("/providers", dependencies=[Depends(require_permission(Perm.NOTIFICATION_MANAGE))])
async def provider_status() -> dict:
    """What the notification worker reports about its channels, and whether it is alive."""
    r = get_redis()
    providers, heartbeat = await r.mget(["worker:providers", WORKER_HEARTBEAT_KEY])
    return {
        "worker_online": heartbeat is not None,
        "worker": orjson.loads(heartbeat) if heartbeat else None,
        "channels": orjson.loads(providers) if providers else {},
    }


@router.post(
    "/test",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_permission(Perm.NOTIFICATION_MANAGE))],
)
async def send_test(payload: TestNotification) -> dict:
    """Queues one message through the worker's live provider, recorded in history."""
    entry_id = await get_redis().xadd(
        OUTBOX_STREAM,
        {
            "payload": orjson.dumps(
                {
                    "audience": "test",
                    "channel": payload.channel.value,
                    "recipient": payload.recipient,
                    "title": "CCD test notification",
                    "body": payload.message or "This is a test message from the CCD crowd density platform.",
                }
            ).decode()
        },
        maxlen=1000,
        approximate=True,
    )
    return {"queued": True, "id": entry_id}
