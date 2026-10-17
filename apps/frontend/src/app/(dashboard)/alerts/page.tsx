"use client";

import { Check, CircleCheck, RotateCcw, ShieldX } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { FloorPlan } from "@/components/map/floor-plan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InstrumentStrip } from "@/components/dashboard/instrument-strip";
import { useAlert, useAlertStats, useAlerts, useSetAlertStatus } from "@/hooks/use-alerts";
import { useCameras } from "@/hooks/use-cameras";
import { useAllFloors, useZones } from "@/hooks/use-map";
import { ApiError } from "@/lib/api-client";
import { alertSeverityBadge, formatAlertType, relativeTime } from "@/lib/format";
import { Perm } from "@/lib/permissions";
import type { Alert, AlertSeverity, AlertStatus, AlertType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

const STATUS_VIEWS: { id: string; label: string; statuses: AlertStatus[] }[] = [
  { id: "active", label: "Active", statuses: ["open", "acknowledged"] },
  { id: "open", label: "Open", statuses: ["open"] },
  { id: "acknowledged", label: "Acknowledged", statuses: ["acknowledged"] },
  { id: "closed", label: "Closed", statuses: ["resolved", "false_positive"] },
  { id: "all", label: "All", statuses: [] },
];

const SEVERITIES: AlertSeverity[] = ["critical", "high", "medium", "low"];

const SEVERITY_BAR: Record<AlertSeverity, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-busy",
  low: "bg-paper-faint",
};

const ALERT_TYPES: AlertType[] = [
  "panic", "stampede", "crowd_congestion", "rapid_density_increase", "running", "counter_flow",
  "fighting", "restricted_area_intrusion", "abandoned_object", "suspicious_gathering", "loitering",
  "abnormal_stopping", "camera_offline", "system",
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-[3px] border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors",
        active ? "border-rule-strong bg-ink-4 text-paper" : "border-rule text-paper-faint hover:text-paper"
      )}
    >
      {children}
    </button>
  );
}

function AlertDetail({ id, canManage }: { id: string; canManage: boolean }) {
  const { data: alert, isLoading } = useAlert(id);
  const cameras = useCameras();
  const { floors } = useAllFloors();
  const setStatus = useSetAlertStatus();

  const camera = cameras.data?.items.find((c) => c.id === alert?.camera_id);
  const floorId = alert?.metadata?.floor_id ?? camera?.floor_id ?? null;
  const floor = floors.find((f) => f.id === floorId) ?? null;
  const zones = useZones(floor?.id);
  const zone = zones.data?.items.find((z) => z.id === alert?.zone_id);

  if (isLoading || !alert) {
    return <Skeleton className="h-[560px] w-full" />;
  }

  async function change(status: AlertStatus) {
    try {
      await setStatus.mutateAsync({ ids: [alert!.id], status });
      toast.success(`Marked ${status.replace("_", " ")}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update the alert");
    }
  }

  const badge = alertSeverityBadge[alert.severity];
  const closed = alert.status === "resolved" || alert.status === "false_positive";

  return (
    <article className="panel overflow-hidden" aria-label={alert.title}>
      <div className="relative aspect-video w-full bg-[#080908]">
        {alert.snapshot_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}${alert.snapshot_url}`}
            alt={`Snapshot when "${alert.title}" was raised`}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <p className="absolute inset-0 flex items-center justify-center font-mono text-[11px] uppercase tracking-[0.08em] text-paper-faint">
            No snapshot for this alert
          </p>
        )}
      </div>
      <div className="space-y-5 p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <Badge variant="outline">{alert.status.replace("_", " ")}</Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-paper-faint">
              {formatAlertType(alert.alert_type)}
            </span>
          </div>
          <h2 className="mt-3 text-xl leading-snug text-paper">{alert.title}</h2>
          {alert.description && <p className="mt-2 text-sm leading-relaxed text-paper-dim">{alert.description}</p>}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-rule pt-4 text-sm">
          {[
            ["Raised", new Date(alert.created_at).toLocaleString()],
            ["Confidence", `${Math.round(alert.confidence * 100)}%`],
            ["Camera", camera?.name ?? "—"],
            ["Zone", zone?.name ?? "—"],
            ["People in view", alert.metadata?.people_in_view != null ? String(alert.metadata.people_in_view) : "—"],
            ["Acknowledged", alert.acknowledged_at ? relativeTime(alert.acknowledged_at) : "—"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="eyebrow">{k}</dt>
              <dd className="num mt-1 text-paper">{v}</dd>
            </div>
          ))}
        </dl>

        {floor && alert.map_x != null && alert.map_y != null && (
          <div>
            <p className="eyebrow mb-2">Location · {floor.name}</p>
            <div className="h-48 overflow-hidden rounded-[4px] border border-rule bg-[#0a0c0b]">
              <FloorPlan
                floor={floor}
                zones={zones.data?.items}
                compact
                highlightZoneId={alert.zone_id}
                markers={[{ id: alert.id, x: alert.map_x, y: alert.map_y, severity: alert.severity, selected: true }]}
              />
            </div>
          </div>
        )}

        {canManage && (
          <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
            {alert.status === "open" && (
              <Button onClick={() => change("acknowledged")} disabled={setStatus.isPending}>
                <Check /> Acknowledge
              </Button>
            )}
            {!closed && (
              <Button variant="outline" onClick={() => change("resolved")} disabled={setStatus.isPending}>
                <CircleCheck /> Resolve
              </Button>
            )}
            {!closed && (
              <Button variant="ghost" onClick={() => change("false_positive")} disabled={setStatus.isPending}>
                <ShieldX /> False positive
              </Button>
            )}
            {closed && (
              <Button variant="outline" onClick={() => change("open")} disabled={setStatus.isPending}>
                <RotateCcw /> Reopen
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function AlertsView() {
  const params = useSearchParams();
  const canManage = useAuthStore((s) => s.permissions.includes(Perm.ALERT_MANAGE));
  const [view, setView] = useState("active");
  const [severities, setSeverities] = useState<AlertSeverity[]>([]);
  const [alertType, setAlertType] = useState<AlertType | "">("");
  const [page, setPage] = useState(1);
  const [pickedId, setPickedId] = useState<string | null>(params.get("focus"));
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const statuses = STATUS_VIEWS.find((v) => v.id === view)!.statuses;
  const { data, isLoading } = useAlerts({ status: statuses, severity: severities, alertType: alertType || null, page });
  const stats = useAlertStats(24);
  const cameras = useCameras();
  const setStatus = useSetAlertStatus();

  const items = useMemo(() => data?.items ?? [], [data]);
  // Selection is always explicit: auto-following the newest alert would swap the
  // detail panel out from under an operator mid-read whenever a new alert arrives.
  const selectedId = pickedId;
  const cameraName = (id: string | null) => cameras.data?.items.find((c) => c.id === id)?.name;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  async function bulk(status: AlertStatus) {
    try {
      await setStatus.mutateAsync({ ids: [...checked], status });
      toast.success(`${checked.size} alerts marked ${status.replace("_", " ")}`);
      setChecked(new Set());
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Bulk update failed");
    }
  }

  const s = stats.data;
  return (
    <div className="space-y-4">
      <PageHeader
        index="04"
        eyebrow="Alerts"
        title="Anomalies and incidents"
        description="Everything the detectors raised, newest first. Acknowledge to claim an alert; resolve or mark false positives to close it."
      />

      <InstrumentStrip
        loading={stats.isLoading}
        readouts={[
          { label: "Open", value: s?.by_status.open ?? 0, tone: (s?.by_status.open ?? 0) > 0 ? "amber" : "default", detail: "Awaiting acknowledgement" },
          { label: "Critical · 24h", value: s?.by_severity.critical ?? 0, tone: (s?.by_severity.critical ?? 0) > 0 ? "critical" : "default", detail: "Panic, stampede, crush risk" },
          { label: "Acknowledged", value: s?.by_status.acknowledged ?? 0, detail: "Being handled" },
          { label: "Raised · 24h", value: s?.total ?? 0, detail: `${s?.by_status.false_positive ?? 0} false positives` },
          {
            label: "Most frequent",
            value: s && Object.keys(s.by_type).length
              ? formatAlertType(Object.entries(s.by_type).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]![0])
              : "—",
            detail: "Alert type, last 24 h",
          },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Status" className="flex flex-wrap gap-1">
          {STATUS_VIEWS.map((v) => (
            <Chip key={v.id} active={view === v.id} onClick={() => { setView(v.id); setPage(1); setPickedId(null); }}>
              {v.label}
            </Chip>
          ))}
        </div>
        <span className="mx-1 hidden h-5 w-px bg-rule sm:block" />
        {SEVERITIES.map((sev) => (
          <Chip
            key={sev}
            active={severities.includes(sev)}
            onClick={() => {
              setSeverities((cur) => (cur.includes(sev) ? cur.filter((x) => x !== sev) : [...cur, sev]));
              setPage(1);
            }}
          >
            {sev}
          </Chip>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-paper-dim">
          <span className="sr-only">Alert type</span>
          <select
            value={alertType}
            onChange={(e) => { setAlertType(e.target.value as AlertType | ""); setPage(1); }}
            className="h-8 rounded-md border border-input bg-ink px-2 text-xs"
          >
            <option value="">All types</option>
            {ALERT_TYPES.map((t) => (
              <option key={t} value={t}>{formatAlertType(t)}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <section className="panel flex min-h-[560px] flex-col" aria-label="Alert list">
          {canManage && checked.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-ink-3/60 px-4 py-2">
              <span className="num text-xs text-paper">{checked.size} selected</span>
              <Button size="sm" onClick={() => bulk("acknowledged")}>Acknowledge</Button>
              <Button size="sm" variant="outline" onClick={() => bulk("resolved")}>Resolve</Button>
              <Button size="sm" variant="ghost" onClick={() => bulk("false_positive")}>False positive</Button>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setChecked(new Set())}>Clear</Button>
            </div>
          )}
          {isLoading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          )}
          {!isLoading && items.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
              <p className="text-paper">Nothing here.</p>
              <p className="mt-1 max-w-sm text-sm text-paper-dim">
                No alerts match these filters. New anomalies appear the moment the detectors raise them.
              </p>
            </div>
          )}
          <ul className="flex-1 divide-y divide-rule">
            {items.map((alert: Alert) => {
              const selected = alert.id === selectedId;
              const badge = alertSeverityBadge[alert.severity];
              return (
                <li key={alert.id} className={cn("flex items-stretch", selected && "bg-ink-3/70")}>
                  <span className={cn("w-[3px] shrink-0", SEVERITY_BAR[alert.severity])} aria-hidden="true" />
                  {canManage && (
                    <label className="flex items-center pl-3">
                      <span className="sr-only">Select {alert.title}</span>
                      <input
                        type="checkbox"
                        checked={checked.has(alert.id)}
                        onChange={(e) =>
                          setChecked((cur) => {
                            const next = new Set(cur);
                            if (e.target.checked) next.add(alert.id);
                            else next.delete(alert.id);
                            return next;
                          })
                        }
                        className="size-4 accent-[var(--amber)]"
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => setPickedId(alert.id)}
                    aria-current={selected ? "true" : undefined}
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-3/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] text-paper">{alert.title}</span>
                      <span className="block truncate font-mono text-[10px] uppercase tracking-[0.06em] text-paper-faint">
                        {formatAlertType(alert.alert_type)}
                        {cameraName(alert.camera_id) && ` · ${cameraName(alert.camera_id)}`} · {relativeTime(alert.created_at)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {alert.status !== "open" && (
                        <span className="hidden font-mono text-[10px] uppercase tracking-[0.06em] text-paper-faint sm:inline">
                          {alert.status.replace("_", " ")}
                        </span>
                      )}
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-rule px-4 py-2">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="num text-xs text-paper-dim">Page {page} of {pages} · {data?.total} alerts</span>
              <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </section>

        <div className="xl:sticky xl:top-20 xl:self-start">
          {selectedId ? (
            <AlertDetail id={selectedId} canManage={canManage} />
          ) : (
            <div className="panel flex h-[560px] items-center justify-center p-8 text-center text-sm text-paper-dim">
              Select an alert to see its snapshot, location and actions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AlertsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AlertsView />
    </Suspense>
  );
}
