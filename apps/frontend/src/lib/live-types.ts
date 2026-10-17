/** Mirrors packages/common/common/schemas/messaging.py and app/ws/bridge.py envelopes. */

export interface LiveBox {
  track_id: number;
  global_person_id: string | null;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
}

export interface CameraFrame {
  camera_id: string;
  captured_at: string;
  frame_index: number;
  person_count: number;
  density_value: number;
  avg_confidence: number;
  inference_ms: number;
  boxes: LiveBox[];
  jpeg_b64: string | null;
}

export interface CameraSummary {
  camera_id: string;
  captured_at: string;
  person_count: number;
  density_value: number;
  inference_ms: number;
}

export interface CameraHealth {
  camera_id: string;
  status: "online" | "offline" | "error" | "starting";
  fps: number;
  latency_ms: number;
  ts: string;
  error: string | null;
}

export interface ZoneOccupancy {
  zone_id: string;
  name: string;
  count: number;
  density: number;
  capacity_threshold: number | null;
  is_restricted: boolean;
}

export interface HeatmapFrame {
  floor_id: string;
  ts: string;
  width_m: number;
  depth_m: number;
  resolution_m: number;
  rows: number;
  cols: number;
  scale_max: number;
  max_density: number;
  total_people: number;
  cells: string;
  zones: ZoneOccupancy[];
  camera_ids: string[];
}

export interface LivePerson {
  camera_id: string;
  track_id: number;
  global_person_id: string | null;
  x: number;
  y: number;
  speed_mps: number;
  direction_deg: number | null;
  dwell_time_s: number;
}

export interface FloorTracks {
  floor_id: string;
  people: LivePerson[];
}

export interface AlertEvent {
  id: string;
  camera_id: string | null;
  zone_id: string | null;
  alert_type: string;
  severity: "low" | "medium" | "high" | "critical";
  status: string;
  title: string;
  description: string | null;
  confidence: number;
  map_x: number | null;
  map_y: number | null;
  snapshot_url: string | null;
  created_at: string;
}

export type LiveMessage =
  | { type: "camera.frame"; topic: string; data: CameraFrame }
  | { type: "camera.summary"; topic: string; data: CameraSummary }
  | { type: "camera.health"; topic: string; data: CameraHealth }
  | { type: "floor.heatmap"; topic: string; data: HeatmapFrame }
  | { type: "floor.tracks"; topic: string; data: FloorTracks }
  | { type: "alert.created" | "alert.updated"; topic: string; data: AlertEvent }
  | { type: "anomaly.signal"; topic: string; data: Record<string, unknown> };

export type LiveStatus = "idle" | "connecting" | "open" | "reconnecting" | "offline";
