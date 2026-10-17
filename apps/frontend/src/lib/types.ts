export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export type RoleName = "admin" | "supervisor" | "security_officer" | "viewer" | "guest";

export interface Role {
  id: string;
  name: RoleName;
  description: string | null;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_guest: boolean;
  role: Role | null;
  last_login_at: string | null;
  created_at: string;
}

export type StreamType = "rtsp" | "http" | "onvif" | "usb" | "file" | "webcam" | "simulated";
export type CameraStatus = "online" | "offline" | "error" | "starting" | "disabled";

export interface Camera {
  id: string;
  code: string;
  name: string;
  description: string | null;
  stream_type: StreamType;
  stream_url: string;
  stream_username: string | null;
  onvif_port: number | null;
  building_id: string | null;
  floor_id: string | null;
  zone_id: string | null;
  latitude: number | null;
  longitude: number | null;
  map_x: number;
  map_y: number;
  map_z: number;
  orientation_deg: number;
  tilt_deg: number;
  fov_deg: number;
  range_m: number;
  status: CameraStatus;
  fps: number;
  latency_ms: number;
  last_seen_at: string | null;
  last_error: string | null;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface CameraCreateInput {
  code: string;
  name: string;
  description?: string;
  stream_type: StreamType;
  stream_url: string;
  stream_username?: string;
  stream_password?: string;
  onvif_port?: number;
  building_id?: string;
  floor_id?: string;
  zone_id?: string;
  latitude?: number;
  longitude?: number;
  map_x?: number;
  map_y?: number;
  map_z?: number;
  orientation_deg?: number;
  tilt_deg?: number;
  fov_deg?: number;
  range_m?: number;
  config?: Record<string, unknown>;
  is_active?: boolean;
}

export interface Building {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FloorLayout {
  wall_height_m?: number;
  walls?: Wall[];
  labels?: Array<{ text: string; x: number; y: number }>;
}

export interface Floor {
  id: string;
  building_id: string;
  name: string;
  level_index: number;
  width_m: number;
  depth_m: number;
  layout: FloorLayout | null;
}

export type ZoneType =
  | "public"
  | "restricted"
  | "entrance"
  | "exit"
  | "corridor"
  | "open_space"
  | "assembly_point";

export interface Zone {
  id: string;
  floor_id: string;
  name: string;
  zone_type: ZoneType;
  polygon: Array<{ x: number; y: number }>;
  color: string;
  capacity_threshold: number | null;
  is_restricted: boolean;
}

export type AlertType =
  | "panic"
  | "running"
  | "stampede"
  | "violence"
  | "fighting"
  | "rapid_density_increase"
  | "crowd_congestion"
  | "counter_flow"
  | "abnormal_stopping"
  | "suspicious_gathering"
  | "restricted_area_intrusion"
  | "loitering"
  | "abandoned_object"
  | "camera_offline"
  | "system";

export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertStatus = "open" | "acknowledged" | "resolved" | "false_positive";

export interface Alert {
  id: string;
  camera_id: string | null;
  zone_id: string | null;
  alert_type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  description: string | null;
  map_x: number | null;
  map_y: number | null;
  confidence: number;
  snapshot_url: string | null;
  clip_url: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  metadata: {
    track_ids?: number[];
    floor_id?: string | null;
    people_in_view?: number;
    [key: string]: unknown;
  };
  created_at: string;
}

export interface AlertStats {
  window_hours: number;
  total: number;
  by_status: Partial<Record<AlertStatus, number>>;
  by_severity: Partial<Record<AlertSeverity, number>>;
  by_type: Partial<Record<AlertType, number>>;
}

export interface DashboardSummary {
  total_people: number;
  average_density: number;
  highest_density_zone_id: string | null;
  highest_density_zone_name: string | null;
  most_active_camera_id: string | null;
  most_active_camera_name: string | null;
  cameras_online: number;
  cameras_total: number;
  open_alerts: number;
  critical_alerts: number;
  avg_fps: number;
  avg_inference_ms: number;
}
