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
