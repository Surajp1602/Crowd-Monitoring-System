import { Perm } from "@/lib/permissions";
import type { Alert } from "@/lib/types";
import { loadRecording, loopPhase, shiftTimes, type Recording, type Sample } from "@/lib/demo/recording";

/** A stand-in for fetch() against the API: answers from the recording, refuses every change. */

const READ_ONLY = { detail: "This is a read-only demo, so changes are turned off." };
const GUEST_PERMISSIONS = [Perm.CAMERA_VIEW, Perm.MAP_VIEW, Perm.ANALYTICS_VIEW];
const HOUR_MS = 3_600_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function base64url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Unsigned: the dashboard only decodes tokens for display, and nothing here verifies them. */
function demoToken(claims: Record<string, unknown>): string {
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  return `${base64url({ alg: "none", typ: "JWT" })}.${base64url({ ...claims, exp })}.demo`;
}

function respondToChange(rec: Recording, path: string): Response {
  const claims = rec.session.claims;
  switch (path) {
    case "/api/v1/auth/login":
      return json({ access_token: demoToken(claims), refresh_token: "demo", token_type: "bearer", user: rec.session.user });
    case "/api/v1/auth/guest":
      return json({
        access_token: demoToken({ ...claims, sub: "guest", role: "guest", is_guest: true, permissions: GUEST_PERMISSIONS }),
        token_type: "bearer",
        expires_in_minutes: 120,
      });
    case "/api/v1/auth/refresh":
      return json({ access_token: demoToken(claims) });
    case "/api/v1/auth/logout":
      return new Response(null, { status: 204 });
    default:
      return json(READ_ONLY, 403);
  }
}

/** `since` is "now minus a range", so it is matched by its age in hours rather than its value. */
function requestKey(url: URL, refMs: number, ignore: string[] = []): string {
  const params = [...url.searchParams.entries()]
    .filter(([k]) => k !== "tz_offset_minutes" && !ignore.includes(k))
    .map(([k, v]): [string, string] => [k, k === "since" ? `${Math.round((refMs - Date.parse(v)) / HOUR_MS)}h` : v])
    .sort(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y));
  return `${url.pathname}?${params.map(([k, v]) => `${k}=${v}`).join("&")}`;
}

/** Floor series are recorded for every floor at once and narrowed to the floors asked for. */
function ignoredParams(url: URL): string[] {
  return url.pathname.startsWith("/api/v1/analytics/timeseries") && url.searchParams.get("scope_type") === "floor"
    ? ["scope_id"]
    : [];
}

interface Index {
  rest: Map<string, Sample[]>;
  alerts: Alert[];
  history: Record<string, unknown>[];
}

let index: Index | null = null;

function buildIndex(rec: Recording): Index {
  const rest = new Map<string, Sample[]>();
  for (const { path, samples } of rec.rest) {
    const url = new URL(path, "http://demo");
    if (samples[0]) rest.set(requestKey(url, samples[0].at, ignoredParams(url)), samples);
  }
  const delta = Date.now() - rec.listsAt;
  return { rest, alerts: shiftTimes(rec.alerts, delta), history: shiftTimes(rec.notificationHistory, delta) };
}

/** The sample recorded at this point of the loop; samples are in time order and the first is at 0. */
function pickSample(rec: Recording, samples: Sample[]): Sample | undefined {
  const phase = loopPhase(rec, rec.loopMs);
  return samples.filter((s) => s.t <= phase).at(-1) ?? samples[0];
}

function recorded(rec: Recording, idx: Index, url: URL): unknown {
  const samples = idx.rest.get(requestKey(url, Date.now(), ignoredParams(url)));
  const sample = samples && pickSample(rec, samples);
  if (!sample) return undefined;
  const body = shiftTimes(sample.body, Date.now() - sample.at) as Record<string, unknown>;
  const wanted = url.searchParams.getAll("scope_id");
  if (ignoredParams(url).length && wanted.length) {
    const series = body.series as { scope_id: string }[];
    return { ...body, series: series.filter((s) => wanted.includes(s.scope_id)) };
  }
  return body;
}

function page<T>(items: T[], params: URLSearchParams) {
  const pageNo = Number(params.get("page") ?? 1);
  const size = Number(params.get("page_size") ?? 50);
  return { items: items.slice((pageNo - 1) * size, pageNo * size), total: items.length, page: pageNo, page_size: size };
}

function filterAlerts(alerts: Alert[], p: URLSearchParams): Alert[] {
  const statuses = p.getAll("status");
  const severities = p.getAll("severity");
  const types = p.getAll("alert_type");
  const since = p.get("since") ? Date.parse(p.get("since")!) : null;
  return alerts
    .filter(
      (a) =>
        (!statuses.length || statuses.includes(a.status)) &&
        (!severities.length || severities.includes(a.severity)) &&
        (!types.length || types.includes(a.alert_type)) &&
        (!p.get("camera_id") || a.camera_id === p.get("camera_id")) &&
        (!p.get("zone_id") || a.zone_id === p.get("zone_id")) &&
        (since === null || Date.parse(a.created_at) >= since)
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function filterHistory(history: Record<string, unknown>[], p: URLSearchParams) {
  return history.filter(
    (h) =>
      (!p.get("channel") || h.channel === p.get("channel")) &&
      (!p.get("status") || h.status === p.get("status")) &&
      (!p.get("alert_id") || h.alert_id === p.get("alert_id"))
  );
}

function timeseriesCsv(rec: Recording, idx: Index, url: URL): Response {
  const source = new URL(url);
  source.pathname = "/api/v1/analytics/timeseries";
  const body = recorded(rec, idx, source) as { series: { scope_id: string; points: Record<string, unknown>[] }[] } | undefined;
  if (!body) return json({ detail: "Not available in the demo" }, 404);
  const rows = body.series.flatMap((s) => s.points.map((pt) => [pt.t, s.scope_id, pt.avg, pt.max, pt.min].join(",")));
  return new Response(["t,scope_id,avg,max,min", ...rows].join("\n"), { headers: { "Content-Type": "text/csv" } });
}

export async function demoFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const rec = await loadRecording();
  index ??= buildIndex(rec);
  const url = new URL(input, "http://demo");
  if ((init.method ?? "GET").toUpperCase() !== "GET") return respondToChange(rec, url.pathname);

  const alertId = url.pathname.match(/^\/api\/v1\/alerts\/([0-9a-f-]{36})$/)?.[1];
  if (alertId) {
    const alert = index.alerts.find((a) => a.id === alertId);
    return alert ? json(alert) : json({ detail: "Alert not found" }, 404);
  }
  switch (url.pathname) {
    case "/api/v1/alerts":
      return json(page(filterAlerts(index.alerts, url.searchParams), url.searchParams));
    case "/api/v1/notifications/history":
      return json(page(filterHistory(index.history, url.searchParams), url.searchParams));
    case "/api/v1/analytics/timeseries.csv":
      return timeseriesCsv(rec, index, url);
  }
  const body = recorded(rec, index, url);
  return body === undefined ? json({ detail: "Not available in the demo" }, 404) : json(body);
}
