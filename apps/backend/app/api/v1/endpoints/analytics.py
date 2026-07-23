import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query

from common.enums import MetricScope
from common.rbac import Perm

from app.deps import DbSession, require_internal_service, require_permission
from app.repositories.entities import AnalyticsMetricRepository
from app.schemas.analytics import DashboardSummary, MetricIngest, MetricPoint
from app.services import analytics_service

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get(
    "/summary", response_model=DashboardSummary, dependencies=[Depends(require_permission(Perm.ANALYTICS_VIEW))]
)
async def dashboard_summary(db: DbSession):
    return await analytics_service.get_dashboard_summary(db)


@router.get(
    "/metrics", response_model=list[MetricPoint], dependencies=[Depends(require_permission(Perm.ANALYTICS_VIEW))]
)
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
