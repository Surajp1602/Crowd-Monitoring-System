"""Concrete repositories. Each is a one-line binding of BaseRepository to a model;
kept in a single file since none currently need custom queries beyond the base CRUD.
Split out into its own module if/when a repository grows bespoke query methods.
"""

from common.models import (
    Alert,
    AnalyticsMetric,
    Building,
    Camera,
    Event,
    Floor,
    GeofenceSubscription,
    NotificationHistory,
    Permission,
    Role,
    Setting,
    User,
    Zone,
)

from sqlalchemy import func, select

from app.repositories.base import BaseRepository


class UserRepository(BaseRepository[User]):
    model = User


class RoleRepository(BaseRepository[Role]):
    model = Role


class PermissionRepository(BaseRepository[Permission]):
    model = Permission


class CameraRepository(BaseRepository[Camera]):
    model = Camera


class BuildingRepository(BaseRepository[Building]):
    model = Building


class FloorRepository(BaseRepository[Floor]):
    model = Floor


class ZoneRepository(BaseRepository[Zone]):
    model = Zone


class AlertRepository(BaseRepository[Alert]):
    model = Alert

    async def search(
        self,
        *,
        offset: int,
        limit: int,
        statuses=None,
        severities=None,
        types=None,
        camera_id=None,
        zone_id=None,
        since=None,
    ) -> tuple[list[Alert], int]:
        conditions = []
        if statuses:
            conditions.append(Alert.status.in_(statuses))
        if severities:
            conditions.append(Alert.severity.in_(severities))
        if types:
            conditions.append(Alert.alert_type.in_(types))
        if camera_id:
            conditions.append(Alert.camera_id == camera_id)
        if zone_id:
            conditions.append(Alert.zone_id == zone_id)
        if since:
            conditions.append(Alert.created_at >= since)
        stmt = select(Alert).where(*conditions).order_by(Alert.created_at.desc()).offset(offset).limit(limit)
        count = select(func.count()).select_from(Alert).where(*conditions)
        items = (await self.db.execute(stmt)).scalars().all()
        return list(items), (await self.db.execute(count)).scalar_one()


class EventRepository(BaseRepository[Event]):
    model = Event


class AnalyticsMetricRepository(BaseRepository[AnalyticsMetric]):
    model = AnalyticsMetric


class SettingRepository(BaseRepository[Setting]):
    model = Setting


class NotificationHistoryRepository(BaseRepository[NotificationHistory]):
    model = NotificationHistory


class GeofenceSubscriptionRepository(BaseRepository[GeofenceSubscription]):
    model = GeofenceSubscription
