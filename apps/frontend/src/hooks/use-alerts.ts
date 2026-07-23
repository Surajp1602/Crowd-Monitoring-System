"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { Alert, Page } from "@/lib/types";

export function useAlerts() {
  return useQuery({
    queryKey: ["alerts", "all"],
    queryFn: () => apiFetch<Page<Alert>>("/api/v1/alerts?page_size=100"),
    refetchInterval: 10_000,
  });
}
