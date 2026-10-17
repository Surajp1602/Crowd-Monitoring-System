"use client";

import { useEffect, useState } from "react";
import { ZoneLoad } from "@/components/dashboard/zone-load";
import { DensityLegend } from "@/components/map/density-legend";
import { FloorPlan } from "@/components/map/floor-plan";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFloorLive } from "@/hooks/use-live";
import { useAllFloors, useFloorCameras, useZones } from "@/hooks/use-map";
import { densityLevel } from "@/lib/isolines";
import type { HeatmapFrame } from "@/lib/live-types";
import { cn } from "@/lib/utils";

export function FloorPanel({ onHeatmap }: { onHeatmap?: (floorId: string, frame: HeatmapFrame) => void }) {
  const { floors, isLoading } = useAllFloors();
  const [pickedFloorId, setFloorId] = useState<string | null>(null);
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  const floorId = pickedFloorId ?? floors[0]?.id ?? null;

  const floor = floors.find((f) => f.id === floorId) ?? null;
  const zones = useZones(floorId);
  const cameras = useFloorCameras(floorId);
  const { heatmap, tracks } = useFloorLive(floorId);

  useEffect(() => {
    if (heatmap && floorId) onHeatmap?.(floorId, heatmap);
  }, [heatmap, floorId, onHeatmap]);

  const peak = heatmap?.max_density ?? 0;
  const peakLevel = densityLevel(peak);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <Card className="xl:col-span-8">
        <CardHeader className="flex-wrap">
          <div>
            <CardTitle index="02">Live density</CardTitle>
            <p className="mt-1.5 text-[13px] text-paper-dim">
              {floor ? (
                <>
                  {floor.building?.name} · {floor.name}
                  {heatmap && (
                    <>
                      {" · "}
                      <span className="num text-paper">{heatmap.total_people}</span> people · peak{" "}
                      <span className="num" style={{ color: peakLevel.css }}>
                        {peak.toFixed(2)} p/m²
                      </span>
                    </>
                  )}
                </>
              ) : (
                "No floors yet"
              )}
            </p>
          </div>
          {floors.length > 1 && (
            <div role="tablist" aria-label="Floor" className="flex gap-1 rounded-[4px] border border-rule p-0.5">
              {floors.map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={f.id === floorId}
                  onClick={() => setFloorId(f.id)}
                  className={cn(
                    "rounded-[3px] px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors",
                    f.id === floorId ? "bg-ink-4 text-paper" : "text-paper-faint hover:text-paper"
                  )}
                >
                  {f.name.replace(/\s*\(.*\)/, "")}
                </button>
              ))}
            </div>
          )}
        </CardHeader>
        <div className="relative mx-5 h-[min(56vh,520px)] min-h-[320px] overflow-hidden rounded-[4px] border border-rule bg-[#0a0c0b]">
          {isLoading && <Skeleton className="absolute inset-0" />}
          {floor && (
            <FloorPlan
              floor={floor}
              zones={zones.data?.items}
              cameras={cameras.data?.items}
              heatmap={heatmap}
              people={tracks?.people}
              highlightZoneId={hoverZone}
            />
          )}
          {!isLoading && !floor && (
            <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-paper-dim">
              Add a building and floor on the facility map to see live density here.
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <DensityLegend />
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-paper-faint">
            Contours at 0.5 · 1 · 2 · 3.5 · 5 p/m²
          </span>
        </div>
      </Card>

      <Card className="flex flex-col xl:col-span-4">
        <CardHeader>
          <CardTitle index="03">Zone load</CardTitle>
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-paper-faint">vs capacity</span>
        </CardHeader>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-4 pb-4 xl:max-h-[min(56vh,520px)]">
          <ZoneLoad zones={heatmap?.zones ?? []} onHover={setHoverZone} highlightId={hoverZone} />
        </div>
      </Card>
    </div>
  );
}
