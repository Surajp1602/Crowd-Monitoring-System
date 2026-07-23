from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from common.enums import AlertSeverity, AlertStatus, CameraStatus
from common.models import Alert, AnalyticsMetric, Camera, DetectionFrame, Zone

from app.repositories.entities import AnalyticsMetricRepository
from app.schemas.analytics import MetricIngest


async def ingest_metric(db: AsyncSession, payload: MetricIngest) -> AnalyticsMetric:
    repo = AnalyticsMetricRepository(db)
    metric = await repo.create(
        scope_type=payload.scope_type,
        scope_id=payload.scope_id,
        metric_name=payload.metric_name,
        value=payload.value,
        timestamp=payload.timestamp or datetime.now(timezone.utc),
    )
    await db.commit()
    return metric


async def get_dashboard_summary(db: AsyncSession):
    from app.schemas.analytics import DashboardSummary

    cameras = (await db.execute(select(Camera))).scalars().all()
    cameras_total = len(cameras)
    cameras_online = sum(1 for c in cameras if c.status == CameraStatus.ONLINE)
    avg_fps = sum(c.fps for c in cameras) / cameras_total if cameras_total else 0.0

    latest_frame_subq = (
        select(
            DetectionFrame.camera_id,
            func.max(DetectionFrame.captured_at).label("max_ts"),
        )
        .group_by(DetectionFrame.camera_id)
        .subquery()
    )
    latest_frames_stmt = select(DetectionFrame).join(
        latest_frame_subq,
        (DetectionFrame.camera_id == latest_frame_subq.c.camera_id)
        & (DetectionFrame.captured_at == latest_frame_subq.c.max_ts),
    )
    latest_frames = (await db.execute(latest_frames_stmt)).scalars().all()
    total_people = sum(f.person_count for f in latest_frames)
    average_density = (
        sum(f.density_value for f in latest_frames) / len(latest_frames) if latest_frames else 0.0
    )
    avg_inference_ms = (
        sum(f.inference_ms for f in latest_frames) / len(latest_frames) if latest_frames else 0.0
    )

    most_active_camera_id = None
    most_active_camera_name = None
    if latest_frames:
        busiest = max(latest_frames, key=lambda f: f.person_count)
        cam = next((c for c in cameras if c.id == busiest.camera_id), None)
        if cam:
            most_active_camera_id = cam.id
            most_active_camera_name = cam.name

    zones = (await db.execute(select(Zone))).scalars().all()
    highest_density_zone_id = None
    highest_density_zone_name = None
    zone_density: dict = {}
    for f in latest_frames:
        cam = next((c for c in cameras if c.id == f.camera_id), None)
        if cam and cam.zone_id:
            zone_density[cam.zone_id] = zone_density.get(cam.zone_id, 0.0) + f.density_value
    if zone_density:
        top_zone_id = max(zone_density, key=zone_density.get)
        zone = next((z for z in zones if z.id == top_zone_id), None)
        if zone:
            highest_density_zone_id = zone.id
            highest_density_zone_name = zone.name

    open_alerts = (
        await db.execute(
            select(func.count()).select_from(Alert).where(Alert.status == AlertStatus.OPEN)
        )
    ).scalar_one()
    critical_alerts = (
        await db.execute(
            select(func.count())
            .select_from(Alert)
            .where(Alert.status == AlertStatus.OPEN, Alert.severity == AlertSeverity.CRITICAL)
        )
    ).scalar_one()

    return DashboardSummary(
        total_people=total_people,
        average_density=round(average_density, 3),
        highest_density_zone_id=highest_density_zone_id,
        highest_density_zone_name=highest_density_zone_name,
        most_active_camera_id=most_active_camera_id,
        most_active_camera_name=most_active_camera_name,
        cameras_online=cameras_online,
        cameras_total=cameras_total,
        open_alerts=open_alerts,
        critical_alerts=critical_alerts,
        avg_fps=round(avg_fps, 2),
        avg_inference_ms=round(avg_inference_ms, 2),
    )
