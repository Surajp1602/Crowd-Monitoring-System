import type { Alert, User } from "@/lib/types";

/** Written by infra/scripts/record_demo.py. */
export interface Recording {
  version: 1;
  recordedAt: string;
  loopMs: number;
  frameLoopMs: number;
  tzOffsetMinutes: number;
  session: { user: User; claims: Record<string, unknown> };
  rest: { path: string; samples: Sample[] }[];
  listsAt: number;
  alerts: Alert[];
  notificationHistory: Record<string, unknown>[];
  topics: Record<string, string>;
}

/** `t` is the sample's place in the loop; `at` is when it was fetched (epoch ms). */
export interface Sample {
  t: number;
  at: number;
  body: unknown;
}

export interface RecordedMessage {
  t: number;
  type: string;
  data: unknown;
}

let recording: Promise<Recording> | null = null;
const topicCache = new Map<string, Promise<RecordedMessage[]>>();

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Demo data missing: ${path} (${res.status})`);
  return (await res.json()) as T;
}

export function loadRecording(): Promise<Recording> {
  recording ??= getJson<Recording>("/demo/manifest.json");
  return recording;
}

export async function loadTopic(topic: string): Promise<RecordedMessage[]> {
  const file = (await loadRecording()).topics[topic];
  if (!file) return [];
  let messages = topicCache.get(topic);
  if (!messages) {
    messages = getJson<RecordedMessage[]>(`/demo/${file}`);
    topicCache.set(topic, messages);
  }
  return messages;
}

/** Where every player is in its loop. One clock for all, so the API and live views stay in step. */
export function loopPhase(rec: Recording, loopMs: number, now = Date.now()): number {
  const elapsed = now - Date.parse(rec.recordedAt);
  return ((elapsed % loopMs) + loopMs) % loopMs;
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Moves every timestamp in a recorded value forward by `deltaMs`, so recorded data reads as current. */
export function shiftTimes<T>(value: T, deltaMs: number): T {
  if (typeof value === "string") {
    if (ISO_TIME.test(value)) {
      const ms = Date.parse(value);
      return (Number.isNaN(ms) ? value : new Date(ms + deltaMs).toISOString()) as T;
    }
    if (ISO_DAY.test(value)) {
      const day = new Date(`${value}T00:00:00Z`);
      day.setUTCDate(day.getUTCDate() + Math.round(deltaMs / DAY_MS));
      return day.toISOString().slice(0, 10) as T;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => shiftTimes(v, deltaMs)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = shiftTimes(v, deltaMs);
    return out as T;
  }
  return value;
}
