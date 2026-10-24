"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { API_URL, apiFetch, httpFetch } from "@/lib/api-client";

export interface SeriesPoint {
  t: string;
  avg: number;
  max: number;
  min: number;
}

export interface Timeseries {
  metric: string;
  scope_type: string;
  bucket: string;
  series: { scope_id: string; points: SeriesPoint[] }[];
}

export interface PeakHours {
  days: number;
  cells: { weekday: number; hour: number; avg: number; max: number }[];
  busiest: { weekday: number; hour: number; avg: number; max: number } | null;
}

export interface ZoneStat {
  zone_id: string;
  name: string;
  floor: string | null;
  is_restricted: boolean;
  capacity: number | null;
  avg_people: number;
  peak_people: number;
  avg_density: number;
  peak_density: number;
  peak_utilisation: number | null;
  samples: number;
}

export interface AlertDay {
  day: string;
  low: number;
  medium: number;
  high: number;
  critical: number;
  total: number;
}

export const RANGES = [
  { id: "24h", label: "24 h", hours: 24 },
  { id: "7d", label: "7 days", hours: 24 * 7 },
  { id: "14d", label: "14 days", hours: 24 * 14 },
  { id: "30d", label: "30 days", hours: 24 * 30 },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

/** The browser's offset east of UTC, so hour-of-day views match the operator's clock. */
const tzOffset = () => -new Date().getTimezoneOffset();

function sinceFor(range: RangeId) {
  const hours = RANGES.find((r) => r.id === range)!.hours;
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

export function useTimeseries(range: RangeId, scopeType: string, scopeIds: string[] = [], metric = "people") {
  return useQuery({
    queryKey: ["insights", "ts", range, scopeType, scopeIds, metric],
    queryFn: () => {
      const q = new URLSearchParams({ metric, scope_type: scopeType, since: sinceFor(range) });
      scopeIds.forEach((id) => q.append("scope_id", id));
      return apiFetch<Timeseries>(`/api/v1/analytics/timeseries?${q}`);
    },
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function usePeakHours(days: number) {
  return useQuery({
    queryKey: ["insights", "peak", days],
    queryFn: () => apiFetch<PeakHours>(`/api/v1/analytics/peak-hours?days=${days}&tz_offset_minutes=${tzOffset()}`),
    staleTime: 5 * 60_000,
  });
}

export function useZoneStats(range: RangeId, floorId: string | null) {
  return useQuery({
    queryKey: ["insights", "zones", range, floorId],
    queryFn: () =>
      apiFetch<ZoneStat[]>(`/api/v1/analytics/zones?since=${sinceFor(range)}${floorId ? `&floor_id=${floorId}` : ""}`),
    placeholderData: keepPreviousData,
  });
}

export function useAlertsByDay(range: RangeId, enabled: boolean) {
  return useQuery({
    queryKey: ["insights", "alerts", range],
    queryFn: () => apiFetch<AlertDay[]>(`/api/v1/analytics/alerts-by-day?since=${sinceFor(range)}&tz_offset_minutes=${tzOffset()}`),
    enabled,
  });
}

export async function downloadCsv(range: RangeId, scopeType: string, accessToken: string | null) {
  const q = new URLSearchParams({ metric: "people", scope_type: scopeType, since: sinceFor(range) });
  const resp = await httpFetch(`${API_URL}/api/v1/analytics/timeseries.csv?${q}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!resp.ok) throw new Error(`Export failed (${resp.status})`);
  const url = URL.createObjectURL(await resp.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `ccd-people-${scopeType}-${range}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
