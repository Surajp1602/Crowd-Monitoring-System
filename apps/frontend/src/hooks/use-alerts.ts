"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { Alert, AlertSeverity, AlertStats, AlertStatus, AlertType, Page } from "@/lib/types";

export interface AlertFilters {
  status?: AlertStatus[];
  severity?: AlertSeverity[];
  alertType?: AlertType | null;
  cameraId?: string | null;
  since?: string | null;
  page?: number;
  pageSize?: number;
}

function toQuery(f: AlertFilters): string {
  const q = new URLSearchParams();
  q.set("page", String(f.page ?? 1));
  q.set("page_size", String(f.pageSize ?? 50));
  f.status?.forEach((s) => q.append("status", s));
  f.severity?.forEach((s) => q.append("severity", s));
  if (f.alertType) q.set("alert_type", f.alertType);
  if (f.cameraId) q.set("camera_id", f.cameraId);
  if (f.since) q.set("since", f.since);
  return q.toString();
}

export function useAlerts(filters: AlertFilters = {}) {
  return useQuery({
    queryKey: ["alerts", "list", filters],
    queryFn: () => apiFetch<Page<Alert>>(`/api/v1/alerts?${toQuery(filters)}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export function useAlert(id: string | null) {
  return useQuery({
    queryKey: ["alerts", "one", id],
    queryFn: () => apiFetch<Alert>(`/api/v1/alerts/${id}`),
    enabled: Boolean(id),
  });
}

export function useAlertStats(hours = 24) {
  return useQuery({
    queryKey: ["alerts", "stats", hours],
    queryFn: () => apiFetch<AlertStats>(`/api/v1/alerts/stats?hours=${hours}`),
    refetchInterval: 30_000,
  });
}

/** Open and acknowledged alerts from the last few hours, for map markers. */
export function useActiveAlerts(enabled = true) {
  return useQuery({
    queryKey: ["alerts", "active"],
    // The window is computed per fetch, so a long-open page keeps a rolling 6 h view.
    queryFn: () => {
      const since = new Date(Date.now() - 6 * 3600_000).toISOString();
      return apiFetch<Page<Alert>>(`/api/v1/alerts?${toQuery({ status: ["open", "acknowledged"], since, pageSize: 200 })}`);
    },
    enabled,
    refetchInterval: 30_000,
  });
}

export function useSetAlertStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: AlertStatus }) =>
      ids.length === 1
        ? apiFetch<Alert>(`/api/v1/alerts/${ids[0]}/status`, { method: "PATCH", body: { status } }).then((a) => [a])
        : apiFetch<Alert[]>("/api/v1/alerts/bulk-status", { method: "POST", body: { ids, status } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });
}
