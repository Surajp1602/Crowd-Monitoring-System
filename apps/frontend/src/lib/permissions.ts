/** Mirrors packages/common/common/rbac.py::Perm — keep in sync with the backend catalogue. */
export const Perm = {
  CAMERA_VIEW: "camera:view",
  CAMERA_MANAGE: "camera:manage",
  MAP_VIEW: "map:view",
  MAP_MANAGE: "map:manage",
  ALERT_VIEW: "alert:view",
  ALERT_MANAGE: "alert:manage",
  ANALYTICS_VIEW: "analytics:view",
  USER_MANAGE: "user:manage",
  NOTIFICATION_MANAGE: "notification:manage",
  SETTINGS_MANAGE: "settings:manage",
  AI_CONFIG_MANAGE: "ai_config:manage",
} as const;
