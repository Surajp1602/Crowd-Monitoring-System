import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse

from common.enums import MetricScope
from common.rbac import Perm

from app.deps import DbSession, require_internal_service, require_permission
from app.repositories.entities import AnalyticsMetricRepository
from app.schemas.analytics import DashboardSummary, MetricIngest, MetricPoint
from app.services import analytics_service, insights_service

router = APIRouter(prefix="/analytics", tags=["analytics"])
view = [Depends(require_permission(Perm.ANALYTICS_VIEW))]

MAX_WINDOW = timedelta(days=90)


def _window(since: datetime | None, until: datetime | None, default: timedelta) -> tuple[datetime, datetime]:
    until = until or datetime.now(timezone.utc)
    since = since or until - default
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    if since >= until:
        raise HTTPException(status_code=422, detail="since must be before until")
    if until - since > MAX_WINDOW:
        raise HTTPException(status_code=422, detail="Window is limited to 90 days")
    return since, until


@router.get("/summary", response_model=DashboardSummary, dependencies=view)
async def dashboard_summary(db: DbSession):
    return await analytics_service.get_dashboard_summary(db)


@router.get("/timeseries", dependencies=view)
async def timeseries(
    db: DbSession,
    metric: str = "people",
    scope_type: MetricScope = MetricScope.GLOBAL,
    scope_id: list[uuid.UUID] | None = Query(None),
    since: datetime | None = None,
    until: datetime | None = None,
    bucket: str | None = Query(None, pattern="^(minute|5min|15min|hour|day)$"),
):
    since, until = _window(since, until, timedelta(hours=24))
    return await insights_service.timeseries(db, metric, scope_type, scope_id, since, until, bucket)


@router.get("/timeseries.csv", dependencies=view, response_class=PlainTextResponse)
async def timeseries_csv(
    db: DbSession,
    metric: str = "people",
    scope_type: MetricScope = MetricScope.GLOBAL,
    scope_id: list[uuid.UUID] | None = Query(None),
    since: datetime | None = None,
    until: datetime | None = None,
    bucket: str | None = Query(None, pattern="^(minute|5min|15min|hour|day)$"),
):
    since, until = _window(since, until, timedelta(hours=24))
    data = await insights_service.timeseries(db, metric, scope_type, scope_id, since, until, bucket)
    return PlainTextResponse(
        insights_service.to_csv(data),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="ccd-{metric}-{scope_type.value}.csv"'},
    )


@router.get("/peak-hours", dependencies=view)
async def peak_hours(
    db: DbSession,
    scope_type: MetricScope = MetricScope.GLOBAL,
    scope_id: uuid.UUID | None = None,
    days: int = Query(14, ge=1, le=90),
    tz_offset_minutes: int = Query(0, ge=-840, le=840),
):
    return await insights_service.peak_hours(db, scope_type, scope_id, days, tz_offset_minutes)


@router.get("/zones", dependencies=view)
async def zone_comparison(
    db: DbSession,
    floor_id: uuid.UUID | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
):
    since, until = _window(since, until, timedelta(days=7))
    return await insights_service.zone_comparison(db, floor_id, since, until)


@router.get("/alerts-by-day", dependencies=[Depends(require_permission(Perm.ALERT_VIEW))])
async def alerts_by_day(
    db: DbSession,
    since: datetime | None = None,
    until: datetime | None = None,
    tz_offset_minutes: int = Query(0, ge=-840, le=840),
):
    since, until = _window(since, until, timedelta(days=14))
    return await insights_service.alerts_by_day(db, since, until, tz_offset_minutes)


@router.get("/metrics", response_model=list[MetricPoint], dependencies=view)
async def list_metrics(
    db: DbSession,
    metric_name: str,
    scope_type: MetricScope | None = None,
    scope_id: uuid.UUID | None = None,
    since: datetime | None = None,
    limit: int = Query(500, ge=1, le=5000),
):
    repo = AnalyticsMetricRepository(db)
    items, _ = await repo.list(
        offset=0,
        limit=limit,
        order_by=repo.model.timestamp.desc(),
        metric_name=metric_name,
        scope_type=scope_type,
        scope_id=scope_id,
    )
    if since is not None:
        items = [i for i in items if i.timestamp >= since]
    return [MetricPoint.model_validate(i) for i in items]


@router.post(
    "/metrics",
    response_model=MetricPoint,
    status_code=201,
    dependencies=[Depends(require_internal_service)],
    summary="Internal: ai-service/worker metric ingest",
)
async def ingest_metric(payload: MetricIngest, db: DbSession):
    metric = await analytics_service.ingest_metric(db, payload)
    return MetricPoint.model_validate(metric)
