"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { ZoneLoad } from "@/components/dashboard/zone-load";
import { PageHeader } from "@/components/layout/page-header";
import { CameraTile } from "@/components/live/camera-tile";
import { DensityLegend } from "@/components/map/density-legend";
import { MapEditor } from "@/components/map/editor/map-editor";
import type { SceneLayers, ViewPreset } from "@/components/map/scene/facility-scene";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveAlerts } from "@/hooks/use-alerts";
import { useFloorLive } from "@/hooks/use-live";
import { useAllFloors, useFloorCameras, useZones } from "@/hooks/use-map";
import { densityLevel } from "@/lib/isolines";
import { Perm } from "@/lib/permissions";
import type { Camera, Zone } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

const FacilityScene = dynamic(
  () => import("@/components/map/scene/facility-scene").then((m) => m.FacilityScene),
  { ssr: false, loading: () => <Skeleton className="absolute inset-0 rounded-none" /> }
);

const PRESETS: { id: ViewPreset; label: string }[] = [
  { id: "terrain", label: "Terrain" },
  { id: "plan", label: "Plan" },
  { id: "low", label: "Low angle" },
];

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-0.5 rounded-[4px] border border-rule bg-ink/90 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-[3px] px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors",
            value === o.id ? "bg-ink-4 text-paper" : "text-paper-faint hover:text-paper"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function MapPage() {
  const canEdit = useAuthStore((s) => s.permissions.includes(Perm.MAP_MANAGE));
  const [mode, setMode] = useState<"view" | "edit">("view");
  const { floors, isLoading } = useAllFloors();
  const [pickedFloorId, setFloorId] = useState<string | null>(null);
  const floorId = pickedFloorId ?? floors[0]?.id ?? null;
  const floor = floors.find((f) => f.id === floorId) ?? null;

  const zones = useZones(floorId);
  const cameras = useFloorCameras(floorId);
  const { heatmap, tracks } = useFloorLive(mode === "view" ? floorId : null);
  const canSeeAlerts = useAuthStore((s) => s.permissions.includes(Perm.ALERT_VIEW));
  const activeAlerts = useActiveAlerts(canSeeAlerts);
  const cameraFloor = new Map((cameras.data?.items ?? []).map((c) => [c.id, c.floor_id]));
  const floorAlerts = (activeAlerts.data?.items ?? []).filter(
    (a) => (a.metadata?.floor_id ?? (a.camera_id ? cameraFloor.get(a.camera_id) : null)) === floorId
  );

  const [preset, setPreset] = useState<ViewPreset>("terrain");
  const [layers, setLayers] = useState<SceneLayers>({ terrain: true, people: true, cameras: true, labels: true });
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);

  const peak = heatmap?.max_density ?? 0;

  return (
    <div>
      <PageHeader
        index="03"
        eyebrow="Facility map"
        title={floor ? `${floor.building?.name ?? "Building"} · ${floor.name}` : "Facility map"}
        description={
          mode === "view"
            ? "Density as terrain: the higher the ground, the tighter the crowd. Drag to orbit, scroll to zoom."
            : "Draw zones and walls, and place cameras on the plan. Changes reach the detection pipeline within seconds."
        }
        actions={
          <>
            {floors.length > 1 && (
              <Segmented
                label="Floor"
                value={floorId ?? ""}
                options={floors.map((f) => ({ id: f.id, label: f.name.replace(/\s*\(.*\)/, "") }))}
                onChange={(id) => {
                  setFloorId(id);
                  setSelectedZone(null);
                  setSelectedCamera(null);
                }}
              />
            )}
            {canEdit && (
              <Segmented
                label="Mode"
                value={mode}
                options={[
                  { id: "view", label: "Live view" },
                  { id: "edit", label: "Edit layout" },
                ]}
                onChange={setMode}
              />
            )}
          </>
        }
      />

      {mode === "edit" && canEdit ? (
        <MapEditor floor={floor} floors={floors} onFloorCreated={setFloorId} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <div className="panel relative h-[calc(100vh-15rem)] min-h-[480px] overflow-hidden">
            {floor ? (
              <FacilityScene
                floor={floor}
                floors={floors}
                zones={zones.data?.items ?? []}
                cameras={cameras.data?.items ?? []}
                heatmap={heatmap}
                people={tracks?.people ?? []}
                alerts={floorAlerts}
                preset={preset}
                layers={layers}
                selectedZoneId={selectedZone?.id}
                selectedCameraId={selectedCamera?.id}
                onSelectZone={(z) => {
                  setSelectedZone(z);
                  if (z) setSelectedCamera(null);
                }}
                onSelectCamera={(c) => {
                  setSelectedCamera(c);
                  if (c) setSelectedZone(null);
                }}
              />
            ) : isLoading ? (
              <Skeleton className="absolute inset-0" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
                <p className="text-paper">No floors yet.</p>
                {canEdit && (
                  <Button onClick={() => setMode("edit")}>Create the first floor</Button>
                )}
              </div>
            )}

            {floor && (
              <>
                {/* One toolbar that wraps: on a phone the layer toggles drop below the view switcher. */}
                <div className="absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
                  <Segmented label="View" value={preset} options={PRESETS} onChange={setPreset} />
                  <div role="group" aria-label="Layers" className="flex flex-wrap justify-end gap-1">
                    {(Object.keys(layers) as (keyof SceneLayers)[]).map((key) => (
                      <button
                        key={key}
                        aria-pressed={layers[key]}
                        onClick={() => setLayers((l) => ({ ...l, [key]: !l[key] }))}
                        className={cn(
                          "rounded-[3px] border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors",
                          layers[key]
                            ? "border-rule-strong bg-ink/90 text-paper"
                            : "border-rule bg-ink/70 text-paper-faint line-through"
                        )}
                      >
                        {key}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
                  <div className="rounded-[4px] border border-rule bg-ink/90 px-3 py-2">
                    <DensityLegend />
                  </div>
                  {heatmap && (
                    <div className="rounded-[4px] border border-rule bg-ink/90 px-3 py-2 text-right">
                      <p className="num text-sm text-paper">
                        {heatmap.total_people} people ·{" "}
                        <span style={{ color: densityLevel(peak).css }}>{peak.toFixed(2)} p/m² peak</span>
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <aside className="panel flex flex-col overflow-hidden xl:h-[calc(100vh-15rem)] xl:min-h-[480px]">
            {selectedCamera ? (
              <div className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="eyebrow">Camera</p>
                  <button className="eyebrow hover:text-paper" onClick={() => setSelectedCamera(null)}>
                    Close
                  </button>
                </div>
                <CameraTile camera={selectedCamera} />
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="eyebrow">Position</dt>
                    <dd className="num mt-1">
                      {selectedCamera.map_x.toFixed(1)}, {selectedCamera.map_y.toFixed(1)} m
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Heading · FOV</dt>
                    <dd className="num mt-1">
                      {selectedCamera.orientation_deg}° · {selectedCamera.fov_deg}°
                    </dd>
                  </div>
                </dl>
              </div>
            ) : selectedZone ? (
              <div className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="eyebrow">Zone</p>
                  <button className="eyebrow hover:text-paper" onClick={() => setSelectedZone(null)}>
                    Close
                  </button>
                </div>
                <div>
                  <p className="text-xl text-paper">{selectedZone.name}</p>
                  <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-paper-faint">
                    {selectedZone.zone_type.replace("_", " ")}
                    {selectedZone.is_restricted && <span className="text-severity-critical"> · restricted</span>}
                  </p>
                </div>
                <ZoneLoad zones={(heatmap?.zones ?? []).filter((z) => z.zone_id === selectedZone.id)} />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-4 pb-2 pt-4">
                  <p className="eyebrow">Zones on this floor</p>
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-paper-faint">Select on map</span>
                </div>
                <div className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-3">
                  <ZoneLoad zones={heatmap?.zones ?? []} />
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
