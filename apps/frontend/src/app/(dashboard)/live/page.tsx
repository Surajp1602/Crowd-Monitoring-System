"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { CameraTile } from "@/components/live/camera-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { useCameras } from "@/hooks/use-cameras";
import { useCameraFeed } from "@/hooks/use-live";
import { useAllFloors } from "@/hooks/use-map";
import type { Camera } from "@/lib/types";
import { cn } from "@/lib/utils";

function FocusPanel({ camera }: { camera: Camera }) {
  const { frame, health } = useCameraFeed(camera.id);
  return (
    <aside className="panel flex flex-col gap-4 p-5">
      <div>
        <p className="eyebrow">Selected</p>
        <p className="mt-1.5 text-lg text-paper">{camera.name}</p>
        <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-paper-faint">
          {camera.code} · {camera.stream_type}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-rule pt-4 text-sm">
        {[
          ["People", frame ? String(frame.person_count) : "—"],
          ["Density", frame ? `${frame.density_value.toFixed(2)} p/m²` : "—"],
          ["Frame rate", health ? `${health.fps.toFixed(1)} fps` : "—"],
          ["Latency", health ? `${Math.round(health.latency_ms)} ms` : "—"],
          ["Inference", frame ? `${frame.inference_ms.toFixed(0)} ms` : "—"],
          ["Confidence", frame ? `${Math.round(frame.avg_confidence * 100)}%` : "—"],
          ["Field of view", `${camera.fov_deg}° · ${camera.range_m} m`],
          ["Heading", `${camera.orientation_deg}°`],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="eyebrow">{k}</dt>
            <dd className="num mt-1 text-paper">{v}</dd>
          </div>
        ))}
      </dl>
      {health?.error && <p className="text-sm text-severity-high">{health.error}</p>}
    </aside>
  );
}

export default function LivePage() {
  const { data, isLoading } = useCameras();
  const { floors } = useAllFloors();
  const [floorFilter, setFloorFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cameras = useMemo(
    () =>
      (data?.items ?? []).filter(
        (c) => c.is_active && (floorFilter === "all" || c.floor_id === floorFilter)
      ),
    [data, floorFilter]
  );
  const selected = cameras.find((c) => c.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        index="02"
        eyebrow="Live"
        title="Camera wall"
        description="Annotated previews from the detection pipeline. Select a camera for its full readout."
        actions={
          floors.length > 0 && (
            <div role="tablist" aria-label="Filter by floor" className="flex flex-wrap gap-1 rounded-[4px] border border-rule p-0.5">
              {[{ id: "all", name: "All floors" }, ...floors].map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={floorFilter === f.id}
                  onClick={() => setFloorFilter(f.id)}
                  className={cn(
                    "rounded-[3px] px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em]",
                    floorFilter === f.id ? "bg-ink-4 text-paper" : "text-paper-faint hover:text-paper"
                  )}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )
        }
      />

      <div className="space-y-4">
        {selected && (
          <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
            <CameraTile camera={selected} large />
            <FocusPanel camera={selected} />
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {isLoading &&
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-video w-full" />)}
          {cameras.map((camera) => (
            <CameraTile
              key={camera.id}
              camera={camera}
              selected={camera.id === selectedId}
              onSelect={() => setSelectedId((id) => (id === camera.id ? null : camera.id))}
            />
          ))}
        </div>
        {!isLoading && cameras.length === 0 && (
          <p className="py-16 text-center text-sm text-paper-dim">No active cameras on this floor.</p>
        )}
      </div>
    </div>
  );
}
