import { loadRecording, loadTopic, loopPhase, shiftTimes, type RecordedMessage } from "@/lib/demo/recording";
import type { FloorTracks } from "@/lib/live-types";

/**
 * Speaks the /ws/live protocol (see app/ws/router.py) to LiveSocket, replaying each recorded
 * topic in a loop on the shared demo clock, with timestamps moved to the moment of replay.
 */

const TICK_MS = 100;
/** Repeating these when a topic starts would re-announce alerts the viewer already saw. */
const NO_INITIAL = new Set(["alert.created", "alert.updated", "anomaly.signal"]);

/** Tracks as record_demo.py stores them: one camera table and [camera index, track, x, y, speed] rows. */
interface PackedTracks {
  floor_id: string;
  cams: string[];
  p: [number, number, number, number, number][];
}

function unpackTracks({ floor_id, cams, p }: PackedTracks): FloorTracks {
  return {
    floor_id,
    people: p.map(([ci, track_id, x, y, speed_mps]) => ({
      camera_id: cams[ci] ?? "",
      track_id,
      global_person_id: null,
      x,
      y,
      speed_mps,
      direction_deg: null,
      dwell_time_s: 0,
    })),
  };
}

interface Player {
  timer: ReturnType<typeof setInterval> | null;
  stopped: boolean;
}

export class DemoWebSocket {
  readyState: number = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private players = new Map<string, Player>();

  constructor() {
    setTimeout(() => {
      if (this.readyState !== WebSocket.CONNECTING) return;
      this.readyState = WebSocket.OPEN;
      this.onopen?.(new Event("open"));
    }, 50);
  }

  send(raw: string) {
    const msg = JSON.parse(raw) as { action: string; topics?: string[] };
    if (msg.action === "auth") this.emit({ type: "ready", data: {} });
    else if (msg.action === "subscribe") msg.topics?.forEach((t) => this.play(t));
    else if (msg.action === "unsubscribe") msg.topics?.forEach((t) => this.stop(t));
  }

  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    [...this.players.keys()].forEach((t) => this.stop(t));
    this.onclose?.({ code: 1000 });
  }

  private emit(message: Record<string, unknown>) {
    if (this.readyState === WebSocket.OPEN) this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** `offsetMs` is how far the current pass of the loop is from the recording (a whole number of loops). */
  private replay(topic: string, m: RecordedMessage, offsetMs: number) {
    const data = m.type === "floor.tracks" ? unpackTracks(m.data as PackedTracks) : m.data;
    this.emit({ type: m.type, topic, data: shiftTimes(data, offsetMs) });
  }

  private async play(topic: string) {
    if (this.players.has(topic)) return;
    const player: Player = { timer: null, stopped: false };
    this.players.set(topic, player);
    const [rec, messages] = await Promise.all([loadRecording(), loadTopic(topic)]);
    if (player.stopped || !messages.length) return;

    const loopMs = topic.startsWith("camera:") ? rec.frameLoopMs : rec.loopMs;
    const recordedAtMs = Date.parse(rec.recordedAt);
    const passOffset = () => Date.now() - loopPhase(rec, loopMs) - recordedAtMs;

    let last = loopPhase(rec, loopMs);
    const latest = new Map<string, RecordedMessage>();
    for (const m of messages) if (m.t <= last && !NO_INITIAL.has(m.type)) latest.set(m.type, m);
    latest.forEach((m) => this.replay(topic, m, passOffset()));

    player.timer = setInterval(() => {
      const phase = loopPhase(rec, loopMs);
      const offset = passOffset();
      const due =
        phase >= last
          ? messages.filter((m) => m.t > last && m.t <= phase)
          : messages.filter((m) => m.t > last || m.t <= phase);
      last = phase;
      // After a wrap, messages past the new phase belong to the pass that just ended.
      due.forEach((m) => this.replay(topic, m, m.t > phase ? offset - loopMs : offset));
    }, TICK_MS);
  }

  private stop(topic: string) {
    const player = this.players.get(topic);
    if (!player) return;
    player.stopped = true;
    if (player.timer) clearInterval(player.timer);
    this.players.delete(topic);
  }
}
