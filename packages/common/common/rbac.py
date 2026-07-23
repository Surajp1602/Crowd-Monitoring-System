"""Static RBAC permission catalogue and default role -> permission grants.

Seeded into the database on first boot (see backend/app/db/seed.py). Adding a
new permission code here and re-running the seed is the only step needed to
introduce a new guarded capability.
"""

from common.enums import RoleName


class Perm:
    CAMERA_VIEW = "camera:view"
    CAMERA_MANAGE = "camera:manage"
    MAP_VIEW = "map:view"
    MAP_MANAGE = "map:manage"
    ALERT_VIEW = "alert:view"
    ALERT_MANAGE = "alert:manage"
    ANALYTICS_VIEW = "analytics:view"
    USER_MANAGE = "user:manage"
    NOTIFICATION_MANAGE = "notification:manage"
    SETTINGS_MANAGE = "settings:manage"
    AI_CONFIG_MANAGE = "ai_config:manage"


ALL_PERMISSIONS = [
    (Perm.CAMERA_VIEW, "View camera list, streams, and health"),
    (Perm.CAMERA_MANAGE, "Create, edit, delete cameras"),
    (Perm.MAP_VIEW, "View buildings, floors, zones, and the 3D map"),
    (Perm.MAP_MANAGE, "Create/edit buildings, floors, and zones"),
    (Perm.ALERT_VIEW, "View alerts and events"),
    (Perm.ALERT_MANAGE, "Acknowledge, resolve, and configure alerts"),
    (Perm.ANALYTICS_VIEW, "View historical analytics and system health"),
    (Perm.USER_MANAGE, "Create/edit users and assign roles"),
    (Perm.NOTIFICATION_MANAGE, "Configure notification channels and subscriptions"),
    (Perm.SETTINGS_MANAGE, "Change platform-wide settings"),
    (Perm.AI_CONFIG_MANAGE, "Change YOLO/tracking/anomaly thresholds"),
]

ROLE_PERMISSIONS: dict[RoleName, list[str]] = {
    RoleName.ADMIN: [p for p, _ in ALL_PERMISSIONS],
    RoleName.SUPERVISOR: [
        Perm.CAMERA_VIEW,
        Perm.CAMERA_MANAGE,
        Perm.MAP_VIEW,
        Perm.MAP_MANAGE,
        Perm.ALERT_VIEW,
        Perm.ALERT_MANAGE,
        Perm.ANALYTICS_VIEW,
        Perm.NOTIFICATION_MANAGE,
        Perm.AI_CONFIG_MANAGE,
    ],
    RoleName.SECURITY_OFFICER: [
        Perm.CAMERA_VIEW,
        Perm.MAP_VIEW,
        Perm.ALERT_VIEW,
        Perm.ALERT_MANAGE,
        Perm.ANALYTICS_VIEW,
    ],
    RoleName.VIEWER: [
        Perm.CAMERA_VIEW,
        Perm.MAP_VIEW,
        Perm.ALERT_VIEW,
        Perm.ANALYTICS_VIEW,
    ],
    RoleName.GUEST: [
        Perm.CAMERA_VIEW,
        Perm.MAP_VIEW,
        Perm.ANALYTICS_VIEW,
    ],
}
