"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { liveSocket } from "@/lib/live-socket";
import type {
  AlertEvent,
  CameraFrame,
  CameraHealth,
  CameraSummary,
  FloorTracks,
  HeatmapFrame,
  LiveMessage,
  LiveStatus,
} from "@/lib/live-types";
import { Perm } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth-store";

export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    (cb) => liveSocket().onStatus(cb),
    () => liveSocket().status,
    () => "idle"
  );
}

/** Subscribes `handler` to a topic for the component's lifetime. Pass null to pause. */
export function useLiveTopic(topic: string | null, handler: (message: LiveMessage) => void) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  useEffect(() => {
    if (!topic) return;
    return liveSocket().subscribe(topic, (m) => handlerRef.current(m));
  }, [topic]);
}

export function useCameraFeed(cameraId: string | null) {
  const [frame, setFrame] = useState<CameraFrame | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [health, setHealth] = useState<CameraHealth | null>(null);
  useLiveTopic(cameraId ? `camera:${cameraId}` : null, (m) => {
    if (m.type === "camera.frame") {
      setFrame(m.data);
      if (m.data.jpeg_b64) setPreview(m.data.jpeg_b64);
    } else if (m.type === "camera.health") {
      setHealth(m.data);
    }
  });
  return { frame, preview, health };
}

export interface CameraLiveState {
  summary?: CameraSummary;
  health?: CameraHealth;
}

export function useCamerasLive(enabled = true) {
  const [state, setState] = useState<Record<string, CameraLiveState>>({});
  useLiveTopic(enabled ? "cameras" : null, (m) => {
    if (m.type === "camera.summary") {
      setState((s) => ({ ...s, [m.data.camera_id]: { ...s[m.data.camera_id], summary: m.data } }));
    } else if (m.type === "camera.health") {
      setState((s) => ({ ...s, [m.data.camera_id]: { ...s[m.data.camera_id], health: m.data } }));
    }
  });
  return state;
}

export function useFloorLive(floorId: string | null) {
  const [heatmap, setHeatmap] = useState<HeatmapFrame | null>(null);
  const [tracks, setTracks] = useState<FloorTracks | null>(null);
  useLiveTopic(floorId ? `floor:${floorId}` : null, (m) => {
    if (m.type === "floor.heatmap") setHeatmap(m.data);
    else if (m.type === "floor.tracks") setTracks(m.data);
  });
  // Messages carry their floor id, so a floor switch never shows the previous floor's data.
  return {
    heatmap: heatmap?.floor_id === floorId ? heatmap : null,
    tracks: tracks?.floor_id === floorId ? tracks : null,
  };
}

export interface FloorPeak {
  floorId: string;
  maxDensity: number;
  people: number;
}

/** Lightweight site-wide view: the latest peak density and head count per floor. */
export function useFloorPeaks(floorIds: string[]) {
  const [peaks, setPeaks] = useState<Record<string, FloorPeak>>({});
  const key = floorIds.join(",");
  useEffect(() => {
    const unsubs = floorIds.map((floorId) =>
      liveSocket().subscribe(`floor:${floorId}`, (m) => {
        if (m.type !== "floor.heatmap") return;
        setPeaks((p) => ({
          ...p,
          [floorId]: { floorId, maxDensity: m.data.max_density, people: m.data.total_people },
        }));
      })
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return peaks;
}

const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;

/**
 * Mounted once in the dashboard shell: keeps alert queries fresh and raises a toast
 * for every new high or critical alert, wherever the operator is in the app.
 */
export function useAlertStream(onAlert?: (alert: AlertEvent) => void) {
  const queryClient = useQueryClient();
  const canView = useAuthStore((s) => s.permissions.includes(Perm.ALERT_VIEW));
  useLiveTopic(canView ? "alerts" : null, (m) => {
    if (m.type !== "alert.created" && m.type !== "alert.updated") return;
    queryClient.invalidateQueries({ queryKey: ["alerts"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    if (m.type === "alert.created") {
      onAlert?.(m.data);
      if (SEVERITY_RANK[m.data.severity] >= SEVERITY_RANK.high) {
        const notify = m.data.severity === "critical" ? toast.error : toast.warning;
        notify(m.data.title, { description: m.data.description ?? undefined, duration: 8000 });
      }
    }
  });
}
