"use client";

import { Activity, AlertOctagon, Gauge, Users, Video, Zap } from "lucide-react";
import { RecentAlerts } from "@/components/dashboard/recent-alerts";
import { StatCard } from "@/components/dashboard/stat-card";
import { PageHeader } from "@/components/layout/page-header";
import { useDashboardSummary } from "@/hooks/use-dashboard";

export default function DashboardPage() {
  const { data, isLoading } = useDashboardSummary();

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Live snapshot of every camera, zone, and active alert across the facility."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total People"
          value={data?.total_people ?? 0}
          icon={Users}
          loading={isLoading}
        />
        <StatCard
          label="Average Density"
          value={(data?.average_density ?? 0).toFixed(2)}
          suffix="p/m²"
          icon={Gauge}
          loading={isLoading}
        />
        <StatCard
          label="Cameras Online"
          value={`${data?.cameras_online ?? 0}/${data?.cameras_total ?? 0}`}
          icon={Video}
          loading={isLoading}
        />
        <StatCard
          label="Open Alerts"
          value={data?.open_alerts ?? 0}
          icon={AlertOctagon}
          loading={isLoading}
          tone={(data?.critical_alerts ?? 0) > 0 ? "critical" : "default"}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Highest Density Zone"
          value={data?.highest_density_zone_name ?? "—"}
          icon={Zap}
          loading={isLoading}
        />
        <StatCard
          label="Most Active Camera"
          value={data?.most_active_camera_name ?? "—"}
          icon={Activity}
          loading={isLoading}
        />
        <StatCard
          label="Avg FPS"
          value={(data?.avg_fps ?? 0).toFixed(1)}
          icon={Gauge}
          loading={isLoading}
        />
        <StatCard
          label="Avg Inference"
          value={(data?.avg_inference_ms ?? 0).toFixed(0)}
          suffix="ms"
          icon={Zap}
          loading={isLoading}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <RecentAlerts />
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Live heatmap and the 3D facility map land in a later phase. Camera feeds and density
          will render here once the AI pipeline is connected.
        </div>
      </div>
    </div>
  );
}
