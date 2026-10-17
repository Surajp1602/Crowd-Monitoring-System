"use client";

import Link from "next/link";
import { FloorPanel } from "@/components/dashboard/floor-panel";
import { InstrumentStrip } from "@/components/dashboard/instrument-strip";
import { RecentAlerts } from "@/components/dashboard/recent-alerts";
import { PageHeader } from "@/components/layout/page-header";
import { CameraTile } from "@/components/live/camera-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCameras } from "@/hooks/use-cameras";
import { useDashboardSummary } from "@/hooks/use-dashboard";
import { useCamerasLive, useFloorPeaks } from "@/hooks/use-live";
import { useAllFloors } from "@/hooks/use-map";
import { densityLevel } from "@/lib/isolines";
import { Perm } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth-store";

export default function DashboardPage() {
  const summary = useDashboardSummary();
  const cameras = useCameras();
  const live = useCamerasLive();
  const { floors } = useAllFloors();
  const peaks = useFloorPeaks(floors.map((f) => f.id));
  const canSeeAlerts = useAuthStore((s) => s.permissions.includes(Perm.ALERT_VIEW));

  const liveCounts = Object.values(live).filter((c) => c.summary);
  const peoplePresent = liveCounts.length
    ? liveCounts.reduce((sum, c) => sum + (c.summary?.person_count ?? 0), 0)
    : (summary.data?.total_people ?? 0);
  // Same rule as the camera table: the live heartbeat when one has arrived, else the stored status.
  // (Counting only live entries reads "1/8" while the first heartbeats are still arriving.)
  const camerasOnline = cameras.data
    ? cameras.data.items.filter((c) => c.is_active && (live[c.id]?.health?.status ?? c.status) === "online").length
    : (summary.data?.cameras_online ?? 0);
  const camerasTotal = cameras.data?.total ?? summary.data?.cameras_total ?? 0;
  const peakFloor = Object.values(peaks).sort((a, b) => b.maxDensity - a.maxDensity)[0];
  const peakDensity = peakFloor?.maxDensity ?? 0;
  const peakFloorName = floors.find((f) => f.id === peakFloor?.floorId)?.name;
  const inferenceMs = summary.data?.avg_inference_ms ?? 0;
  const fpsValues = Object.values(live).map((c) => c.health?.fps ?? 0).filter((f) => f > 0);
  const avgFps = fpsValues.length ? fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length : summary.data?.avg_fps ?? 0;

  const critical = summary.data?.critical_alerts ?? 0;
  const open = summary.data?.open_alerts ?? 0;

  const wall = (cameras.data?.items ?? []).filter((c) => c.is_active).slice(0, 4);

  return (
    <div className="space-y-4">
      <PageHeader
        index="01"
        eyebrow="Overview"
        title="Facility status"
        description="Live density across every floor, the zones nearest capacity, and what the cameras see right now."
      />

      <InstrumentStrip
        loading={summary.isLoading && !liveCounts.length}
        readouts={[
          { label: "People in view", value: peoplePresent, detail: "Across all live cameras" },
          {
            label: "Peak density",
            value: peakDensity.toFixed(2),
            unit: "p/m²",
            color: densityLevel(peakDensity).css,
            detail: peakFloorName ? `${densityLevel(peakDensity).label} · ${peakFloorName}` : "Waiting for heatmaps",
          },
          {
            label: "Open alerts",
            value: canSeeAlerts ? open : "—",
            tone: critical > 0 ? "critical" : open > 0 ? "amber" : "default",
            detail: canSeeAlerts ? (critical > 0 ? `${critical} critical` : "None critical") : "Requires alert access",
          },
          {
            label: "Cameras online",
            value: `${camerasOnline}/${camerasTotal}`,
            tone: camerasTotal > 0 && camerasOnline === camerasTotal ? "ok" : "default",
            detail: camerasTotal - camerasOnline > 0 ? `${camerasTotal - camerasOnline} offline` : "All reporting",
          },
          {
            label: "Pipeline",
            value: avgFps.toFixed(1),
            unit: "fps",
            detail: inferenceMs > 0 ? `${inferenceMs.toFixed(0)} ms model inference` : "Simulated feeds · no model load",
          },
        ]}
      />

      <FloorPanel />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader>
            <CardTitle index="04">Camera wall</CardTitle>
            <Link href="/live" className="font-mono text-[11px] uppercase tracking-[0.08em] text-paper-dim hover:text-amber">
              All cameras →
            </Link>
          </CardHeader>
          <CardContent>
            {wall.length ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {wall.map((camera) => (
                  <CameraTile key={camera.id} camera={camera} />
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-paper-dim">No active cameras.</p>
            )}
          </CardContent>
        </Card>
        {canSeeAlerts && (
          <div className="xl:col-span-4">
            <RecentAlerts index="05" />
          </div>
        )}
      </div>
    </div>
  );
}
