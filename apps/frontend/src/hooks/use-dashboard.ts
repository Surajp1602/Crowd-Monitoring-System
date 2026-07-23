"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { Alert, DashboardSummary, Page } from "@/lib/types";

export function useDashboardSummary() {
  return useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => apiFetch<DashboardSummary>("/api/v1/analytics/summary"),
    refetchInterval: 10_000,
  });
}

export function useRecentAlerts(limit = 8) {
  return useQuery({
    queryKey: ["alerts", "recent", limit],
    queryFn: () => apiFetch<Page<Alert>>(`/api/v1/alerts?page_size=${limit}`),
    refetchInterval: 10_000,
  });
}
