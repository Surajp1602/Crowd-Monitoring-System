import { refreshAccessToken } from "@/lib/api-client";
import { DEMO_MODE } from "@/lib/demo/mode";
import { DemoWebSocket } from "@/lib/demo/socket";
import type { LiveMessage, LiveStatus } from "@/lib/live-types";
import { useAuthStore } from "@/stores/auth-store";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";

/** An empty NEXT_PUBLIC_WS_URL means same origin (behind the reverse proxy): ws or wss to this host. */
function wsBase() {
  if (WS_URL) return WS_URL;
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
}
const CLOSE_UNAUTHORIZED = 4401;
const IDLE_CLOSE_MS = 20_000;
const MAX_BACKOFF_MS = 15_000;

type Handler = (message: LiveMessage) => void;

/**
 * One WebSocket per tab, shared by every component. Components subscribe to topics
 * with handlers; the socket opens on the first subscription, re-subscribes everything
 * after a reconnect, refreshes the token when the server reports it expired, and
 * closes itself once nothing has been watched for a while.
 */
class LiveSocket {
  private ws: WebSocket | null = null;
  private ready = false;
  private handlers = new Map<string, Set<Handler>>();
  private statusListeners = new Set<() => void>();
  private _status: LiveStatus = "idle";
  private backoff = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastToken: string | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      useAuthStore.subscribe((state) => {
        if (state.accessToken === this.lastToken) return;
        this.lastToken = state.accessToken;
        if (!state.accessToken) {
          this.close("idle");
        } else if (this.ws?.readyState === WebSocket.OPEN) {
          this.send({ action: "auth", token: state.accessToken });
        }
      });
    }
  }

  get status(): LiveStatus {
    return this._status;
  }

  onStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  subscribe(topic: string, handler: Handler): () => void {
    let set = this.handlers.get(topic);
    const isNewTopic = !set;
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
    }
    set.add(handler);
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.ws) this.connect();
    else if (isNewTopic && this.ready) this.send({ action: "subscribe", topics: [topic] });

    return () => {
      const current = this.handlers.get(topic);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(topic);
        if (this.ready) this.send({ action: "unsubscribe", topics: [topic] });
      }
      if (this.handlers.size === 0) {
        this.idleTimer = setTimeout(() => this.close("idle"), IDLE_CLOSE_MS);
      }
    };
  }

  private setStatus(status: LiveStatus) {
    if (this._status === status) return;
    this._status = status;
    this.statusListeners.forEach((l) => l());
  }

  private send(payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  private connect() {
    const token = useAuthStore.getState().accessToken;
    if (!token || typeof window === "undefined") return;
    this.lastToken = token;
    this.setStatus(this._status === "idle" ? "connecting" : "reconnecting");

    const ws = DEMO_MODE ? (new DemoWebSocket() as unknown as WebSocket) : new WebSocket(`${wsBase()}/ws/live`);
    this.ws = ws;
    this.ready = false;

    ws.onopen = () => {
      ws.send(JSON.stringify({ action: "auth", token: useAuthStore.getState().accessToken }));
    };

    ws.onmessage = (event) => {
      let message: { type: string; topic?: string; data?: unknown };
      try {
        message = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (message.type === "ready") {
        const firstReady = !this.ready;
        this.ready = true;
        this.backoff = 1000;
        this.setStatus("open");
        if (firstReady && this.handlers.size > 0) {
          this.send({ action: "subscribe", topics: [...this.handlers.keys()] });
        }
        return;
      }
      if (message.topic) {
        this.handlers.get(message.topic)?.forEach((h) => h(message as LiveMessage));
      }
    };

    ws.onclose = async (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      if (this.handlers.size === 0) {
        this.setStatus("idle");
        return;
      }
      if (event.code === CLOSE_UNAUTHORIZED) {
        const fresh = await refreshAccessToken();
        if (!fresh) {
          this.setStatus("offline");
          return;
        }
        this.backoff = 500;
      }
      this.setStatus("reconnecting");
      this.reconnectTimer = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    };
  }

  private close(status: LiveStatus) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    ws?.close();
    this.setStatus(status);
  }
}

let instance: LiveSocket | null = null;

export function liveSocket(): LiveSocket {
  if (!instance) instance = new LiveSocket();
  return instance;
}
