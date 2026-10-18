"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { Page } from "@/lib/types";

export type Channel = "push" | "sms" | "whatsapp" | "email" | "public_announcement";

export interface NotificationRecord {
  id: string;
  alert_id: string | null;
  channel: Channel;
  recipient: string;
  status: "pending" | "sent" | "failed";
  provider: string;
  provider_response: Record<string, unknown>;
  sent_at: string | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  display_name: string | null;
  latitude: number;
  longitude: number;
  radius_m: number;
  channels: Channel[];
  contact: string;
  is_active: boolean;
  created_at: string;
}

export interface ProviderStatus {
  worker_online: boolean;
  worker: { ts: number; consumer: string; sent: number; failed: number; started_at: string } | null;
  channels: Partial<Record<Channel, { provider: string; ready: boolean; error: string | null }>>;
}

export interface NotificationRules {
  enabled_channels: Channel[];
  default_geofence_radius_m: number;
  staff_min_severity: string;
  staff_channels: Channel[];
  public_min_severity: string;
  public_channels: Channel[];
  announcement_min_severity: string;
  recipient_cooldown_s: number;
  muted_alert_types: string[];
}

export function useNotificationHistory(page: number, channel?: Channel | "", status?: string) {
  const q = new URLSearchParams({ page: String(page), page_size: "25" });
  if (channel) q.set("channel", channel);
  if (status) q.set("status", status);
  return useQuery({
    queryKey: ["notifications", "history", page, channel, status],
    queryFn: () => apiFetch<Page<NotificationRecord>>(`/api/v1/notifications/history?${q}`),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
}

export function useSubscriptions() {
  return useQuery({
    queryKey: ["notifications", "subscriptions"],
    queryFn: () => apiFetch<Page<Subscription>>("/api/v1/notifications/subscriptions?page_size=200"),
  });
}

export function useProviderStatus() {
  return useQuery({
    queryKey: ["notifications", "providers"],
    queryFn: () => apiFetch<ProviderStatus>("/api/v1/notifications/providers"),
    refetchInterval: 15_000,
  });
}

export function useSetting<T>(key: string, enabled = true) {
  return useQuery({
    queryKey: ["settings", key],
    queryFn: () => apiFetch<{ key: string; value: T }>(`/api/v1/settings/${key}`).then((r) => r.value),
    enabled,
  });
}

export function useSaveSetting<T>(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: Partial<T>) => apiFetch<{ key: string; value: T }>(`/api/v1/settings/${key}`, { method: "PUT", body: { value } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", key] }),
  });
}

export function useDeleteSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/v1/notifications/subscriptions/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", "subscriptions"] }),
  });
}

export function useSendTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { channel: Channel; recipient: string; message?: string }) =>
      apiFetch<{ queued: boolean }>("/api/v1/notifications/test", { method: "POST", body: input }),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ["notifications", "history"] }), 2500),
  });
}
