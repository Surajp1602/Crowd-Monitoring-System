"""Records a running stack into the static demo the dashboard plays back without a backend.

Writes apps/frontend/public/demo/: manifest.json (every API response the dashboard reads,
with the fast-changing ones sampled through the loop), live/*.json (each WebSocket topic as
timed messages) and media/*.jpg (recent alert snapshots). The dashboard built with
NEXT_PUBLIC_DEMO_MODE=true serves these and shifts their timestamps to the viewer's clock.

    apps/backend/.venv/Scripts/python infra/scripts/record_demo.py --password <admin password>
"""

import argparse
import asyncio
import base64
import json
import re
import shutil
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

import httpx
import websockets

RANGE_HOURS = (24, 24 * 7, 24 * 14, 24 * 30)
PEAK_DAYS = (7, 14, 30)
SETTING_KEYS = ("anomaly", "yolo", "tracking", "heatmap", "notifications")
SAMPLED = ("/api/v1/analytics/summary", "/api/v1/system/health", "/api/v1/cameras?page_size=200")
SAMPLE_EVERY_S = 10
TZ_OFFSET_MIN = 330
"""India; hour-of-day charts are bucketed for this offset."""
SNAPSHOTS = 40
HISTORY_CAP = 600

DEMO_USER = {"full_name": "Demo Visitor", "email": "demo@ccd-demo.com", "phone_number": None}


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def jwt_claims(token: str) -> dict:
    payload = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))


def round_floats(value, digits: int = 2):
    """Live messages carry full-precision floats; centimetres and hundredths are plenty for
    playback, and dropping the rest roughly halves the size of the track streams."""
    if isinstance(value, float):
        return round(value, digits)
    if isinstance(value, list):
        return [round_floats(v, digits) for v in value]
    if isinstance(value, dict):
        return {k: round_floats(v, digits) for k, v in value.items()}
    return value


def pack_tracks(data: dict) -> dict:
    """floor.tracks is most of the recording: about 200 people, 4 times a second. Keeps only what
    the map draws, as [camera index, track id, x, y, speed] rows; apps/frontend/src/lib/demo/socket.ts
    expands them back."""
    cams: list[str] = []
    rows = []
    for p in data["people"]:
        if p["camera_id"] not in cams:
            cams.append(p["camera_id"])
        rows.append([cams.index(p["camera_id"]), p["track_id"], p["x"], p["y"], p["speed_mps"]])
    return {"floor_id": data["floor_id"], "cams": cams, "p": rows}


def topic_file(topic: str) -> str:
    return "live/" + re.sub(r"[^a-z0-9-]", "-", topic.lower()) + ".json"


class Recorder:
    def __init__(self, api: str, out: Path, loop_s: int, frame_loop_s: int):
        self.api = api.rstrip("/")
        self.out = out
        self.loop_s = loop_s
        self.frame_loop_s = frame_loop_s
        self.client = httpx.AsyncClient(base_url=self.api, timeout=30)
        self.rest: dict[str, list[dict]] = {}

    async def get(self, path: str):
        resp = await self.client.get(path)
        resp.raise_for_status()
        return resp.json()

    async def record_once(self, path: str, t_ms: int = 0) -> None:
        """`t` places the sample in the loop; `at` is when it was fetched, which the player shifts to now."""
        at = int(time.time() * 1000)
        self.rest.setdefault(path, []).append({"t": t_ms, "at": at, "body": await self.get(path)})

    async def get_all(self, path: str, cap: int | None = None) -> list[dict]:
        items: list[dict] = []
        page = 1
        while True:
            sep = "&" if "?" in path else "?"
            body = await self.get(f"{path}{sep}page={page}&page_size=200")
            items.extend(body["items"])
            if len(items) >= body["total"] or not body["items"] or (cap and len(items) >= cap):
                return items[:cap] if cap else items
            page += 1

    async def run(self, email: str, password: str) -> None:
        login = await self.client.post("/api/v1/auth/login", json={"email": email, "password": password})
        login.raise_for_status()
        token = login.json()["access_token"]
        self.client.headers["Authorization"] = f"Bearer {token}"
        session = {"user": {**login.json()["user"], **DEMO_USER}, "claims": jwt_claims(token)}

        buildings = (await self.get("/api/v1/buildings?page_size=200"))["items"]
        floors = (await self.get("/api/v1/floors?page_size=200"))["items"]
        cameras = (await self.get("/api/v1/cameras?page_size=200"))["items"]
        topics = ["cameras", "alerts"] + [f"floor:{f['id']}" for f in floors] + [f"camera:{c['id']}" for c in cameras]
        print(f"{len(buildings)} buildings, {len(floors)} floors, {len(cameras)} cameras")

        start = time.time()
        live, _ = await asyncio.gather(self.record_live(token, topics, start), self.sample_rest(start))
        recorded_at = datetime.fromtimestamp(start, timezone.utc)

        await self.record_static(buildings, floors, recorded_at)
        lists_at = int(time.time() * 1000)
        alerts = await self.get_all("/api/v1/alerts")
        history = await self.get_all("/api/v1/notifications/history", cap=HISTORY_CAP)
        await self.save_snapshots(alerts, live.get("alerts", []))

        self.write(
            {
                "version": 1,
                "recordedAt": iso(recorded_at),
                "loopMs": self.loop_s * 1000,
                "frameLoopMs": self.frame_loop_s * 1000,
                "tzOffsetMinutes": TZ_OFFSET_MIN,
                "session": session,
                "rest": [{"path": p, "samples": s} for p, s in self.rest.items()],
                "listsAt": lists_at,
                "alerts": alerts,
                "notificationHistory": history,
                "topics": {t: topic_file(t) for t in live},
            },
            live,
        )
        print(f"{len(alerts)} alerts, {len(history)} notifications, {len(self.rest)} endpoints")

    async def record_live(self, token: str, topics: list[str], start: float) -> dict[str, list[dict]]:
        url = self.api.replace("http", "ws", 1) + "/ws/live"
        streams: dict[str, list[dict]] = {}
        async with websockets.connect(url, max_size=None) as ws:
            await ws.send(json.dumps({"action": "auth", "token": token}))
            while json.loads(await ws.recv()).get("type") != "ready":
                pass
            await ws.send(json.dumps({"action": "subscribe", "topics": topics}))
            deadline = start + self.loop_s
            while (remaining := deadline - time.time()) > 0:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                except asyncio.TimeoutError:
                    break
                msg = json.loads(raw)
                topic = msg.get("topic")
                if not topic:
                    continue
                t_ms = int((time.time() - start) * 1000)
                # Previews are the bulk of the recording, so camera topics loop on a shorter cycle.
                if topic.startswith("camera:") and t_ms >= self.frame_loop_s * 1000:
                    continue
                data = round_floats(msg.get("data"))
                if msg["type"] == "floor.tracks":
                    data = pack_tracks(data)
                streams.setdefault(topic, []).append({"t": t_ms, "type": msg["type"], "data": data})
        return streams

    async def sample_rest(self, start: float) -> None:
        while (t := time.time() - start) < self.loop_s:
            await asyncio.gather(*(self.record_once(p, int(t * 1000)) for p in SAMPLED))
            await asyncio.sleep(SAMPLE_EVERY_S)

    async def record_static(self, buildings: list[dict], floors: list[dict], now: datetime) -> None:
        paths = ["/api/v1/buildings?page_size=200", "/api/v1/floors?page_size=200"]
        paths += [f"/api/v1/floors?page_size=200&building_id={b['id']}" for b in buildings]
        for f in floors:
            paths += [f"/api/v1/zones?page_size=200&floor_id={f['id']}", f"/api/v1/cameras?page_size=200&floor_id={f['id']}"]
        paths += ["/api/v1/alerts/stats?hours=24", "/api/v1/users?page_size=100"]
        paths += ["/api/v1/notifications/subscriptions?page_size=200", "/api/v1/notifications/providers"]
        paths += [f"/api/v1/settings/{k}" for k in SETTING_KEYS]
        for hours in RANGE_HOURS:
            since = iso(now - timedelta(hours=hours))
            paths.append("/api/v1/analytics/timeseries?" + urlencode({"metric": "people", "scope_type": "global", "since": since}))
            floor_q = [("metric", "people"), ("scope_type", "floor"), ("since", since)] + [("scope_id", f["id"]) for f in floors]
            paths.append("/api/v1/analytics/timeseries?" + urlencode(floor_q))
            paths += [f"/api/v1/analytics/zones?{urlencode({'since': since, 'floor_id': f['id']})}" for f in floors]
            paths.append("/api/v1/analytics/alerts-by-day?" + urlencode({"since": since, "tz_offset_minutes": TZ_OFFSET_MIN}))
        paths += [f"/api/v1/analytics/peak-hours?days={d}&tz_offset_minutes={TZ_OFFSET_MIN}" for d in PEAK_DAYS]
        for p in paths:
            if p not in self.rest:
                await self.record_once(p)

    async def save_snapshots(self, alerts: list[dict], live_alerts: list[dict]) -> None:
        media = self.out / "media"
        shutil.rmtree(media, ignore_errors=True)
        media.mkdir(parents=True)
        wanted = {m["data"]["id"] for m in live_alerts if m.get("data", {}).get("snapshot_url")}
        recent = [a for a in sorted(alerts, key=lambda a: a["created_at"], reverse=True) if a.get("snapshot_url")]
        wanted |= {a["id"] for a in recent[:SNAPSHOTS]}
        urls = {a["id"]: a["snapshot_url"] for a in alerts if a.get("snapshot_url")}
        urls |= {m["data"]["id"]: m["data"]["snapshot_url"] for m in live_alerts if m.get("data", {}).get("snapshot_url")}
        saved = set()
        for alert_id in wanted:
            resp = await self.client.get(urls[alert_id])
            if resp.status_code == 200:
                (media / f"{alert_id}.jpg").write_bytes(resp.content)
                saved.add(alert_id)

        def rewrite(alert: dict) -> None:
            if alert.get("snapshot_url"):
                alert["snapshot_url"] = f"/demo/media/{alert['id']}.jpg" if alert["id"] in saved else None

        for a in alerts:
            rewrite(a)
        for m in live_alerts:
            if m["type"] in ("alert.created", "alert.updated"):
                rewrite(m["data"])
        print(f"{len(saved)} snapshots")

    def write(self, manifest: dict, live: dict[str, list[dict]]) -> None:
        shutil.rmtree(self.out / "live", ignore_errors=True)
        (self.out / "live").mkdir(parents=True)
        for topic, messages in live.items():
            (self.out / topic_file(topic)).write_text(json.dumps(messages, separators=(",", ":")))
        (self.out / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")))
        size = sum(p.stat().st_size for p in self.out.rglob("*") if p.is_file())
        print(f"wrote {self.out} ({size / 1e6:.1f} MB)")


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api", default="http://localhost:8000")
    parser.add_argument("--email", default="admin@ccd-platform.com")
    parser.add_argument("--password", default="ChangeMe123!")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "apps/frontend/public/demo")
    parser.add_argument("--loop", type=int, default=120, help="seconds of live data to record")
    parser.add_argument("--frame-loop", type=int, default=30, help="seconds of camera previews to keep")
    args = parser.parse_args()
    recorder = Recorder(args.api, args.out, args.loop, args.frame_loop)
    try:
        await recorder.run(args.email, args.password)
    finally:
        await recorder.client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
