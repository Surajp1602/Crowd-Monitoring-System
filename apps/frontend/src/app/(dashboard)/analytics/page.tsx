"use client";

import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { AXIS, ChartCard, EmptyChart, Legend, SERIES, SEVERITY_FILL, TooltipBox } from "@/components/analytics/chart-kit";
import { InstrumentStrip } from "@/components/dashboard/instrument-strip";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { RANGES, type RangeId, downloadCsv, useAlertsByDay, usePeakHours, useTimeseries, useZoneStats } from "@/hooks/use-insights";
import { useAllFloors } from "@/hooks/use-map";
import { Perm } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function timeLabel(iso: string, bucket: string) {
  const d = new Date(iso);
  if (bucket === "day") return d.toLocaleDateString([], { month: "short", day: "numeric" });
  // Spelled out as "Mon 18:00": the locale's "Mon, 18" reads as a day of the month.
  if (bucket === "hour") return `${d.toLocaleDateString([], { weekday: "short" })} ${String(d.getHours()).padStart(2, "0")}:00`;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fullTime(iso: string) {
  return new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<RangeId>("7d");
  const accessToken = useAuthStore((s) => s.accessToken);
  const canSeeAlerts = useAuthStore((s) => s.permissions.includes(Perm.ALERT_VIEW));
  const { floors } = useAllFloors();
  const [pickedFloor, setPickedFloor] = useState<string | null>(null);
  const zoneFloor = pickedFloor ?? floors[0]?.id ?? null;
  const shownFloors = floors.slice(0, SERIES.length);

  const site = useTimeseries(range, "global");
  const byFloor = useTimeseries(range, "floor", shownFloors.map((f) => f.id));
  const peaks = usePeakHours(range === "24h" ? 7 : RANGES.find((r) => r.id === range)!.hours / 24);
  const zones = useZoneStats(range, zoneFloor);
  const alerts = useAlertsByDay(range, canSeeAlerts);

  const sitePoints = useMemo(() => site.data?.series[0]?.points ?? [], [site.data]);
  const bucket = site.data?.bucket ?? "hour";
  const peak = sitePoints.reduce((best, p) => (p.max > (best?.max ?? -1) ? p : best), null as (typeof sitePoints)[number] | null);
  const average = sitePoints.length ? sitePoints.reduce((s, p) => s + p.avg, 0) / sitePoints.length : 0;
  const alertTotal = (alerts.data ?? []).reduce((s, d) => s + d.total, 0);
  const busiest = peaks.data?.busiest;

  const floorRows = useMemo(() => {
    const byTime = new Map<string, Record<string, number | string>>();
    for (const s of byFloor.data?.series ?? []) {
      for (const p of s.points) {
        const row = byTime.get(p.t) ?? { t: p.t };
        row[s.scope_id] = p.avg;
        byTime.set(p.t, row);
      }
    }
    return [...byTime.values()].sort((a, b) => String(a.t).localeCompare(String(b.t)));
  }, [byFloor.data]);

  const heat = useMemo(() => {
    const cells = new Map((peaks.data?.cells ?? []).map((c) => [`${c.weekday}:${c.hour}`, c]));
    const max = Math.max(1, ...(peaks.data?.cells ?? []).map((c) => c.avg));
    return { cells, max };
  }, [peaks.data]);

  return (
    <div className="space-y-4">
      <PageHeader
        index="05"
        eyebrow="Analytics"
        title="Occupancy and trends"
        description="How busy the facility gets, when, and where it runs closest to capacity. Built from minute rollups of the live pipeline."
        actions={
          <>
            <div role="tablist" aria-label="Time range" className="flex gap-0.5 rounded-[4px] border border-rule p-0.5">
              {RANGES.map((r) => (
                <button key={r.id} role="tab" aria-selected={range === r.id} onClick={() => setRange(r.id)}
                  className={cn("rounded-[3px] px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em]",
                    range === r.id ? "bg-ink-4 text-paper" : "text-paper-faint hover:text-paper")}>
                  {r.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => downloadCsv(range, "global", accessToken).catch((e) => toast.error(String(e.message ?? e)))}>
              <Download /> CSV
            </Button>
          </>
        }
      />

      <InstrumentStrip
        loading={site.isLoading}
        readouts={[
          { label: "Peak occupancy", value: peak ? Math.round(peak.max) : "—", tone: "amber", detail: peak ? fullTime(peak.t) : "No data yet" },
          { label: "Average", value: Math.round(average), detail: `People on site, per ${bucket}` },
          {
            label: "Busiest hour",
            value: busiest ? `${WEEKDAYS[busiest.weekday]} ${String(busiest.hour).padStart(2, "0")}:00` : "—",
            detail: busiest ? `${Math.round(busiest.avg)} people on average` : "Needs a few days of data",
          },
          { label: "Alerts", value: canSeeAlerts ? alertTotal : "—", detail: canSeeAlerts ? `In the last ${RANGES.find((r) => r.id === range)!.label}` : "Requires alert access" },
          { label: "Resolution", value: bucket, detail: "Auto-chosen for the range" },
        ]}
      />

      <ChartCard
        index="01"
        title="People on site"
        subtitle="Average per interval; the band shows the range within it."
        table={{ columns: ["Time", "Average", "Min", "Max"], rows: sitePoints.map((p) => [fullTime(p.t), p.avg, p.min, p.max]) }}
      >
        <div className="h-72">
          {sitePoints.length === 0 ? (
            <EmptyChart message="No occupancy recorded in this range. Rollups appear a minute after the pipeline starts." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sitePoints} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="siteFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={AXIS.grid} />
                <XAxis dataKey="t" tickFormatter={(v) => timeLabel(v, bucket)} stroke={AXIS.stroke} tick={AXIS.tick} minTickGap={48} tickLine={false} />
                <YAxis stroke={AXIS.stroke} tick={AXIS.tick} tickLine={false} axisLine={false} width={48} />
                <Tooltip
                  cursor={{ stroke: "rgb(236 232 222 / 0.35)", strokeWidth: 1 }}
                  content={({ active, payload }) =>
                    active && payload?.[0] ? (
                      <TooltipBox
                        title={fullTime(String(payload[0].payload.t))}
                        rows={[
                          { label: "Average", value: String(Math.round(Number(payload[0].payload.avg))), color: SERIES[0] },
                          { label: "Range", value: `${Math.round(Number(payload[0].payload.min))}–${Math.round(Number(payload[0].payload.max))}` },
                        ]}
                      />
                    ) : null
                  }
                />
                <Area type="monotone" dataKey="max" stroke="none" fill="rgb(201 133 0 / 0.08)" isAnimationActive={false} />
                <Area type="monotone" dataKey="avg" stroke={SERIES[0]} strokeWidth={2} fill="url(#siteFill)" isAnimationActive={false}
                  activeDot={{ r: 4, stroke: "var(--ink-2)", strokeWidth: 2, fill: SERIES[0] }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </ChartCard>

      <div className="grid gap-4 xl:grid-cols-12">
        <ChartCard
          className="xl:col-span-7"
          index="02"
          title="By floor"
          subtitle={floors.length > SERIES.length ? `First ${SERIES.length} floors shown.` : undefined}
          actions={<Legend items={shownFloors.map((f, i) => ({ label: f.name, color: SERIES[i]! }))} />}
          table={{
            columns: ["Time", ...shownFloors.map((f) => f.name)],
            rows: floorRows.map((r) => [fullTime(String(r.t)), ...shownFloors.map((f) => (r[f.id] as number) ?? "—")]),
          }}
        >
          <div className="h-64">
            {floorRows.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={floorRows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid vertical={false} stroke={AXIS.grid} />
                  <XAxis dataKey="t" tickFormatter={(v) => timeLabel(v, bucket)} stroke={AXIS.stroke} tick={AXIS.tick} minTickGap={48} tickLine={false} />
                  <YAxis stroke={AXIS.stroke} tick={AXIS.tick} tickLine={false} axisLine={false} width={48} />
                  <Tooltip
                    cursor={{ stroke: "rgb(236 232 222 / 0.35)", strokeWidth: 1 }}
                    content={({ active, payload }) =>
                      active && payload?.length ? (
                        <TooltipBox
                          title={fullTime(String(payload[0]!.payload.t))}
                          rows={shownFloors.map((f, i) => ({
                            label: f.name,
                            value: String(Math.round(Number(payload[0]!.payload[f.id] ?? 0))),
                            color: SERIES[i],
                          }))}
                        />
                      ) : null
                    }
                  />
                  {shownFloors.map((f, i) => (
                    <Line key={f.id} type="monotone" dataKey={f.id} name={f.name} stroke={SERIES[i]} strokeWidth={2} dot={false}
                      isAnimationActive={false} activeDot={{ r: 4, stroke: "var(--ink-2)", strokeWidth: 2 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        <ChartCard
          className="xl:col-span-5"
          index="03"
          title="Typical week"
          subtitle="Average people by weekday and hour, in your time zone."
          table={{
            columns: ["Day", "Hour", "Average", "Max"],
            rows: (peaks.data?.cells ?? []).map((c) => [WEEKDAYS[c.weekday]!, `${String(c.hour).padStart(2, "0")}:00`, c.avg, c.max]),
          }}
        >
          {peaks.data?.cells.length ? (
            <div>
              <div className="grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-[2px]" role="img" aria-label="Occupancy by weekday and hour">
                {WEEKDAYS.map((day, d) => (
                  <div key={day} className="contents">
                    <span className="flex items-center font-mono text-[10px] text-paper-faint">{day}</span>
                    {Array.from({ length: 24 }, (_, h) => {
                      const cell = heat.cells.get(`${d}:${h}`);
                      const pct = cell ? Math.round((cell.avg / heat.max) * 100) : 0;
                      return (
                        <span
                          key={h}
                          title={cell ? `${day} ${String(h).padStart(2, "0")}:00 — ${Math.round(cell.avg)} people on average` : `${day} ${h}:00 — no data`}
                          className="aspect-square rounded-[2px] transition-transform hover:scale-125 hover:ring-1 hover:ring-paper/60"
                          style={{ background: cell ? `color-mix(in oklab, #f2a93b ${Math.max(6, pct)}%, #1b1f1c)` : "#161917" }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-[2px] font-mono text-[9px] text-paper-faint">
                <span />
                {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center">{h % 6 === 0 ? String(h).padStart(2, "0") : ""}</span>)}
              </div>
              <div className="mt-3 flex items-center gap-2 font-mono text-[10px] text-paper-faint">
                Quiet
                <span className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(90deg, color-mix(in oklab, #f2a93b 6%, #1b1f1c), #f2a93b)" }} />
                Busy · peak {Math.round(heat.max)} people
              </div>
            </div>
          ) : (
            <EmptyChart message="Needs at least a day of rollups." />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <ChartCard
          className="xl:col-span-7"
          index="04"
          title="Zones nearest capacity"
          subtitle="Peak occupancy as a share of each zone's capacity."
          actions={
            floors.length > 1 && (
              <select aria-label="Floor" value={zoneFloor ?? ""} onChange={(e) => setPickedFloor(e.target.value)}
                className="h-7 rounded-md border border-input bg-ink px-2 text-xs">
                {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )
          }
          table={{
            columns: ["Zone", "Capacity", "Peak", "Average", "Peak density", "Utilisation"],
            rows: (zones.data ?? []).map((z) => [z.name, z.capacity ?? "—", z.peak_people, z.avg_people, z.peak_density,
              z.peak_utilisation != null ? `${Math.round(z.peak_utilisation * 100)}%` : "—"]),
          }}
        >
          {zones.data?.length ? (
            <ul className="space-y-3">
              {zones.data.filter((z) => z.capacity).map((z) => {
                const pct = Math.round((z.peak_utilisation ?? 0) * 100);
                const over = pct > 100;
                return (
                  <li key={z.zone_id} className="group" title={`${z.name}: peak ${z.peak_people} of ${z.capacity}, average ${z.avg_people}`}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="truncate text-paper">
                        {z.name}
                        {z.is_restricted && <span className="ml-2 font-mono text-[10px] uppercase text-severity-critical">restricted</span>}
                      </span>
                      <span className="num shrink-0 text-xs text-paper-dim">
                        <span className={over ? "text-severity-critical" : "text-paper"}>{pct}%</span>
                        {over && <span className="ml-1.5 text-severity-critical">over capacity</span>}
                        <span className="ml-2 text-paper-faint">{z.peak_people}/{z.capacity}</span>
                      </span>
                    </div>
                    <div className="relative h-2 overflow-hidden rounded-[2px] bg-ink-4">
                      <div className="absolute inset-y-0 left-0 rounded-[2px] transition-[width] duration-700 ease-out-expo"
                        style={{ width: `${Math.min(pct, 100)}%`, background: over ? SEVERITY_FILL.critical : SERIES[0] }} />
                      <div className="absolute inset-y-0 left-0 bg-paper/25" style={{ width: `${Math.min(100, Math.round(((z.avg_people || 0) / (z.capacity || 1)) * 100))}%` }} />
                    </div>
                  </li>
                );
              })}
              <li className="pt-1 font-mono text-[10px] uppercase tracking-[0.06em] text-paper-faint">
                Bar: peak · lighter overlay: average
              </li>
            </ul>
          ) : (
            <EmptyChart />
          )}
        </ChartCard>

        {canSeeAlerts && (
          <ChartCard
            className="xl:col-span-5"
            index="05"
            title="Alerts per day"
            actions={<Legend items={(["critical", "high", "medium", "low"] as const).map((s) => ({ label: s, color: SEVERITY_FILL[s] }))} />}
            table={{ columns: ["Day", "Critical", "High", "Medium", "Low", "Total"], rows: (alerts.data ?? []).map((d) => [d.day, d.critical, d.high, d.medium, d.low, d.total]) }}
          >
            <div className="h-64">
              {alerts.data?.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={alerts.data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid vertical={false} stroke={AXIS.grid} />
                    <XAxis dataKey="day" tickFormatter={(d) => new Date(d).toLocaleDateString([], { month: "short", day: "numeric" })}
                      stroke={AXIS.stroke} tick={AXIS.tick} tickLine={false} />
                    <YAxis allowDecimals={false} stroke={AXIS.stroke} tick={AXIS.tick} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))} />
                    <Tooltip
                      cursor={{ fill: "rgb(236 232 222 / 0.05)" }}
                      content={({ active, payload }) =>
                        active && payload?.length ? (
                          <TooltipBox
                            title={new Date(String(payload[0]!.payload.day)).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
                            rows={(["critical", "high", "medium", "low"] as const).map((s) => ({ label: s, value: String(payload[0]!.payload[s]), color: SEVERITY_FILL[s] }))}
                          />
                        ) : null
                      }
                    />
                    {(["low", "medium", "high", "critical"] as const).map((s, i, all) => (
                      <Bar key={s} dataKey={s} stackId="a" fill={SEVERITY_FILL[s]} stroke="var(--ink-2)" strokeWidth={2}
                        radius={i === all.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} maxBarSize={36} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No alerts in this range." />
              )}
            </div>
          </ChartCard>
        )}
      </div>
    </div>
  );
}
