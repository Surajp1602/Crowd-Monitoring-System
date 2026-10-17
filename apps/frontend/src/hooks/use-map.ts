"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { Building, Camera, Floor, Page, Zone } from "@/lib/types";

export function useBuildings() {
  return useQuery({
    queryKey: ["buildings"],
    queryFn: () => apiFetch<Page<Building>>("/api/v1/buildings?page_size=200"),
    staleTime: 60_000,
  });
}

export function useFloors(buildingId?: string | null) {
  return useQuery({
    queryKey: ["floors", buildingId ?? "all"],
    queryFn: () =>
      apiFetch<Page<Floor>>(`/api/v1/floors?page_size=200${buildingId ? `&building_id=${buildingId}` : ""}`),
    staleTime: 60_000,
  });
}

export function useZones(floorId?: string | null) {
  return useQuery({
    queryKey: ["zones", floorId],
    queryFn: () => apiFetch<Page<Zone>>(`/api/v1/zones?page_size=200&floor_id=${floorId}`),
    enabled: Boolean(floorId),
    staleTime: 60_000,
  });
}

export function useFloorCameras(floorId?: string | null) {
  return useQuery({
    queryKey: ["cameras", "floor", floorId],
    queryFn: () => apiFetch<Page<Camera>>(`/api/v1/cameras?page_size=200&floor_id=${floorId}`),
    enabled: Boolean(floorId),
    staleTime: 30_000,
  });
}

/** All floors, sorted by building then level, for floor pickers. */
export function useAllFloors() {
  const floors = useFloors(null);
  const buildings = useBuildings();
  const byId = new Map((buildings.data?.items ?? []).map((b) => [b.id, b]));
  const items = [...(floors.data?.items ?? [])].sort(
    (a, b) => a.building_id.localeCompare(b.building_id) || a.level_index - b.level_index
  );
  return {
    isLoading: floors.isLoading || buildings.isLoading,
    floors: items.map((f) => ({ ...f, building: byId.get(f.building_id) ?? null })),
  };
}

function useInvalidate(keys: string[][]) {
  const qc = useQueryClient();
  return () => keys.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
}

export function useSaveBuilding() {
  const invalidate = useInvalidate([["buildings"]]);
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<Building> }) =>
      apiFetch<Building>(id ? `/api/v1/buildings/${id}` : "/api/v1/buildings", {
        method: id ? "PATCH" : "POST",
        body: input,
      }),
    onSuccess: invalidate,
  });
}

export function useSaveFloor() {
  const invalidate = useInvalidate([["floors"]]);
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<Floor> }) =>
      apiFetch<Floor>(id ? `/api/v1/floors/${id}` : "/api/v1/floors", {
        method: id ? "PATCH" : "POST",
        body: input,
      }),
    onSuccess: invalidate,
  });
}

export function useSaveZone() {
  const invalidate = useInvalidate([["zones"]]);
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<Zone> }) =>
      apiFetch<Zone>(id ? `/api/v1/zones/${id}` : "/api/v1/zones", {
        method: id ? "PATCH" : "POST",
        body: input,
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteZone() {
  const invalidate = useInvalidate([["zones"]]);
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/v1/zones/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
