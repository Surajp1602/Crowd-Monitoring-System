import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query

from common.enums import AlertSeverity, AlertStatus, AlertType
from common.rbac import Perm

from app.deps import CurrentUserDep, DbSession, require_internal_service, require_permission
from app.repositories.entities import AlertRepository
from app.schemas.alert import AlertBulkStatus, AlertCreate, AlertRead, AlertUpdateStatus
from app.schemas.common import Page
from app.services import alert_service

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=Page[AlertRead], dependencies=[Depends(require_permission(Perm.ALERT_VIEW))])
async def list_alerts(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    status_filter: list[AlertStatus] | None = Query(None, alias="status"),
    severity: list[AlertSeverity] | None = Query(None),
    alert_type: list[AlertType] | None = Query(None),
    camera_id: uuid.UUID | None = None,
    zone_id: uuid.UUID | None = None,
    since: datetime | None = None,
):
    repo = AlertRepository(db)
    items, total = await repo.search(
        offset=(page - 1) * page_size,
        limit=page_size,
        statuses=status_filter,
        severities=severity,
        types=alert_type,
        camera_id=camera_id,
        zone_id=zone_id,
        since=since,
    )
    return Page(items=[alert_service.to_read(a) for a in items], total=total, page=page, page_size=page_size)


@router.get("/stats", dependencies=[Depends(require_permission(Perm.ALERT_VIEW))])
async def alert_stats(db: DbSession, hours: int = Query(24, ge=1, le=24 * 90)):
    return await alert_service.alert_stats(db, hours)


@router.post(
    "",
    response_model=AlertRead,
    status_code=201,
    dependencies=[Depends(require_internal_service)],
    summary="Internal: ai-service anomaly ingest",
)
async def create_alert(payload: AlertCreate, db: DbSession):
    alert = await alert_service.create_alert(db, payload)
    return alert_service.to_read(alert)


@router.post(
    "/bulk-status",
    response_model=list[AlertRead],
    dependencies=[Depends(require_permission(Perm.ALERT_MANAGE))],
)
async def bulk_update_status(payload: AlertBulkStatus, db: DbSession, user: CurrentUserDep):
    updated = []
    for alert_id in payload.ids:
        alert = await alert_service.get_alert_or_404(db, alert_id)
        updated.append(await alert_service.set_alert_status(db, alert, payload.status, user.user_id))
    return [alert_service.to_read(a) for a in updated]


@router.get("/{alert_id}", response_model=AlertRead, dependencies=[Depends(require_permission(Perm.ALERT_VIEW))])
async def get_alert(alert_id: uuid.UUID, db: DbSession):
    alert = await alert_service.get_alert_or_404(db, alert_id)
    return alert_service.to_read(alert)


@router.patch(
    "/{alert_id}/status", response_model=AlertRead, dependencies=[Depends(require_permission(Perm.ALERT_MANAGE))]
)
async def update_alert_status(alert_id: uuid.UUID, payload: AlertUpdateStatus, db: DbSession, user: CurrentUserDep):
    alert = await alert_service.get_alert_or_404(db, alert_id)
    alert = await alert_service.set_alert_status(db, alert, payload.status, user.user_id)
    return alert_service.to_read(alert)
