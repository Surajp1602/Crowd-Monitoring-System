import uuid

from fastapi import APIRouter, Depends, Query

from common.enums import EventType
from common.rbac import Perm

from app.deps import DbSession, require_permission
from app.repositories.entities import EventRepository
from app.schemas.alert import EventRead
from app.schemas.common import Page

router = APIRouter(prefix="/events", tags=["events"])


@router.get("", response_model=Page[EventRead], dependencies=[Depends(require_permission(Perm.ALERT_VIEW))])
async def list_events(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    camera_id: uuid.UUID | None = None,
    zone_id: uuid.UUID | None = None,
    event_type: EventType | None = None,
):
    repo = EventRepository(db)
    items, total = await repo.list(
        offset=(page - 1) * page_size,
        limit=page_size,
        order_by=repo.model.occurred_at.desc(),
        camera_id=camera_id,
        zone_id=zone_id,
        event_type=event_type,
    )
    return Page(items=[EventRead.model_validate(e) for e in items], total=total, page=page, page_size=page_size)
