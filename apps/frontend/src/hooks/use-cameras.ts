"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { Camera, CameraCreateInput, Page } from "@/lib/types";

const CAMERAS_KEY = ["cameras"] as const;

export function useCameras() {
  return useQuery({
    queryKey: CAMERAS_KEY,
    queryFn: () => apiFetch<Page<Camera>>("/api/v1/cameras?page_size=200"),
    refetchInterval: 15_000,
  });
}

export function useCreateCamera() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CameraCreateInput) =>
      apiFetch<Camera>("/api/v1/cameras", { method: "POST", body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CAMERAS_KEY });
    },
  });
}

export function useUpdateCamera() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CameraCreateInput> }) =>
      apiFetch<Camera>(`/api/v1/cameras/${id}`, { method: "PATCH", body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CAMERAS_KEY });
    },
  });
}

export function useDeleteCamera() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/v1/cameras/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CAMERAS_KEY });
    },
  });
}
