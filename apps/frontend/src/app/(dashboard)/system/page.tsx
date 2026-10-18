"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Status = "ok" | "degraded" | "down";

interface Gpu {
  name: string;
  utilization_pct?: number;
  memory_used_mb?: number;
  memory_total_mb?: number;
  temperature_c?: number;
  torch_allocated_mb?: number;
}

interface Health {
  status: Status;
  checked_at: number;
  services: Record<string, { status: Status; error?: string; [k: string]: unknown }>;
  notification_backlog: { length: number; pending: number; lag: number; consumers: number } | null;
  cameras: {
    by_status: Record<string, number>;
    unhealthy: { id: string; name: string; code: string; status: string; error: string | null; last_seen_at: string | null }[];
  };
}

const STATUS_STYLE: Record<Status, { dot: string; label: string; badge: "success" | "warning" | "destructive" }> = {
  ok: { dot: "bg-severity-moderate", label: "Operational", badge: "success" },
  degraded: { dot: "bg-severity-busy", label: "Degraded", badge: "warning" },
  down: { dot: "bg-severity-critical", label: "Down", badge: "destructive" },
};

const SERVICES: { key: string; name: string; role: string }[] = [
  { key: "api", name: "API & WebSocket", role: "REST, auth, live fan-out" },
  { key: "database", name: "PostgreSQL", role: "Cameras, tracks, alerts, metrics" },
  { key: "redis", name: "Redis", role: "Live streams, cache, queues" },
  { key: "ai_service", name: "Detection pipeline", role: "YOLO, tracking, heatmaps, anomalies" },
  { key: "worker", name: "Worker", role: "Notifications, rollups, retention" },
];

function Meter({ label, value, max = 100, unit = "%" }: { label: string; value: number | undefined; max?: number; unit?: string }) {
  const pct = value == null ? 0 : Math.min(100, (value / max) * 100);
  const tone = pct >= 90 ? "var(--severity-critical)" : pct >= 75 ? "var(--severity-high)" : "var(--paper-dim)";
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-paper-dim">{label}</span>
        <span className="num text-paper">{value == null ? "—" : `${Math.round(value)}${unit}`}</span>
      </div>
      <div className="h-[3px] overflow-hidden rounded-full bg-ink-4">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
      </div>
    </div>
  );
}

function detail(key: string, s: Health["services"][string]): string[] {
  const out: string[] = [];
  if (typeof s.latency_ms === "number") out.push(`${s.latency_ms} ms round trip`);
  if (key === "ai_service" && s.status !== "down") {
    out.push(`${s.active_cameras} camera workers`, `device ${s.device ?? "?"}`);
  }
  if (key === "worker" && s.status !== "down") out.push(`${s.sent} sent · ${s.failed} failed`);
  if (key === "api") out.push(`${s.websocket_clients} live dashboard connections`);
  if (typeof s.age_s === "number") out.push(`heartbeat ${s.age_s}s ago`);
  if (s.error) out.push(String(s.error));
  return out;
}

export default function SystemPage() {
  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["system-health"],
    queryFn: () => apiFetch<Health>("/api/v1/system/health"),
    refetchInterval: 10_000,
  });
  const ai = data?.services.ai_service;
  const gpus = (ai?.gpus as Gpu[] | undefined) ?? [];
  const overall = STATUS_STYLE[data?.status ?? "ok"];

  return (
    <div className="space-y-4">
      <PageHeader
        index="08"
        eyebrow="Operate"
        title="System health"
        description="Every service the platform depends on, refreshed every ten seconds."
        actions={
          data && (
            <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-paper-dim">
              <span className={cn("size-2 rounded-full", overall.dot)} />
              {overall.label} · checked {relativeTime(new Date(dataUpdatedAt).toISOString())}
            </span>
          )
        }
      />

      <section className="panel grid divide-rule sm:grid-cols-2 xl:grid-cols-5 xl:divide-x max-xl:[&>*]:border-b [&>*]:border-rule" aria-label="Services">
        {SERVICES.map(({ key, name, role }) => {
          const s = data?.services[key];
          const st = STATUS_STYLE[s?.status ?? "down"];
          return (
            <div key={key} className="min-w-0 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                <p className="eyebrow">{name}</p>
                {isLoading ? <Skeleton className="h-4 w-12" /> : <Badge variant={st.badge} dot>{st.label}</Badge>}
              </div>
              <p className="mt-1 text-xs text-paper-faint">{role}</p>
              <ul className="mt-3 space-y-1">
                {s && detail(key, s).map((line) => (
                  <li key={line} className={cn("num text-xs [overflow-wrap:anywhere]", s.error && line === s.error ? "text-severity-high" : "text-paper-dim")}>
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle index="01">Detection host</CardTitle>
            <span className="font-mono text-[10px] uppercase text-paper-faint">{String(ai?.device ?? "")}</span>
          </CardHeader>
          <CardContent className="space-y-4">
            <Meter label="CPU" value={ai?.cpu_pct as number | undefined} />
            <Meter label="Memory" value={ai?.memory_pct as number | undefined} />
            <Meter label="Pipeline process" value={ai?.process_rss_mb as number | undefined} max={8192} unit=" MB" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle index="02">GPU</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {gpus.length === 0 && <p className="text-sm text-paper-dim">No GPU reported. Detection runs on CPU, or the pipeline is offline.</p>}
            {gpus.map((g, i) => (
              <div key={i} className="space-y-3">
                <p className="text-sm text-paper">{g.name}</p>
                <Meter label="Utilisation" value={g.utilization_pct} />
                <Meter label="Memory" value={g.memory_used_mb} max={g.memory_total_mb || 1} unit=" MB" />
                {g.temperature_c != null && <Meter label="Temperature" value={g.temperature_c} max={95} unit=" °C" />}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle index="03">Notification queue</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.notification_backlog ? (
              <dl className="grid grid-cols-2 gap-4">
                {[
                  ["Waiting", data.notification_backlog.lag],
                  ["In flight", data.notification_backlog.pending],
                  ["Dispatchers", data.notification_backlog.consumers],
                  ["Stream length", data.notification_backlog.length],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="eyebrow">{k}</dt>
                    <dd className="num mt-1 text-2xl text-paper">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-paper-dim">Redis unavailable.</p>
            )}
            <p className="mt-4 text-xs text-paper-faint">
              Waiting should stay at zero. A growing number means the worker cannot keep up or is offline.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle index="04">Cameras not delivering</CardTitle>
          <span className="num text-xs text-paper-dim">
            {Object.entries(data?.cameras.by_status ?? {}).map(([k, v]) => `${v} ${k}`).join(" · ")}
          </span>
        </CardHeader>
        <CardContent>
          {data?.cameras.unhealthy.length ? (
            <ul className="divide-y divide-rule">
              {data.cameras.unhealthy.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-paper">{c.name} <span className="font-mono text-[10px] uppercase text-paper-faint">{c.code}</span></p>
                    {c.error && <p className="truncate text-xs text-severity-high">{c.error}</p>}
                  </div>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-paper-dim">last frame {relativeTime(c.last_seen_at)}</span>
                    <Badge variant={c.status === "error" ? "destructive" : "muted"}>{c.status}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-paper-dim">Every active camera is delivering frames.</p>
          )}
          <Link href="/cameras" className="mt-3 inline-block font-mono text-[11px] uppercase tracking-[0.08em] text-paper-dim hover:text-amber">
            Manage cameras →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
