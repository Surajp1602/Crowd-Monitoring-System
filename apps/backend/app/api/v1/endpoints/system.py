"""One call that tells an operator whether the platform is healthy: every service's
liveness and latency, host load and GPU, the notification backlog, and which cameras
are not delivering."""

import time

import orjson
import psutil
from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text

from common.enums import CameraStatus
from common.models import Camera
from common.rbac import Perm
from common.redis_channels import AI_SERVICE_HEARTBEAT_KEY, ALERTS_STREAM, WORKER_HEARTBEAT_KEY

from app.core.redis import get_redis
from app.deps import DbSession, require_authenticated_staff, require_permission
from app.ws.connections import connections

router = APIRouter(prefix="/system", tags=["system"])

HEARTBEAT_STALE_S = 20


def _status(ok: bool, degraded: bool = False) -> str:
    return "ok" if ok and not degraded else "degraded" if ok else "down"


@router.get(
    "/health",
    dependencies=[Depends(require_permission(Perm.ANALYTICS_VIEW)), Depends(require_authenticated_staff)],
)
async def system_health(db: DbSession) -> dict:
    services: dict[str, dict] = {}

    started = time.perf_counter()
    try:
        await db.execute(text("SELECT 1"))
        services["database"] = {"status": "ok", "latency_ms": round((time.perf_counter() - started) * 1000, 1)}
    except Exception as exc:  # noqa: BLE001
        services["database"] = {"status": "down", "error": str(exc)[:200]}

    r = get_redis()
    redis_ok = False
    try:
        started = time.perf_counter()
        await r.ping()
        redis_ok = True
        services["redis"] = {"status": "ok", "latency_ms": round((time.perf_counter() - started) * 1000, 1)}
    except Exception as exc:  # noqa: BLE001
        services["redis"] = {"status": "down", "error": str(exc)[:200]}

    ai = worker = None
    backlog = None
    if redis_ok:
        ai_raw, worker_raw = await r.mget([AI_SERVICE_HEARTBEAT_KEY, WORKER_HEARTBEAT_KEY])
        ai = orjson.loads(ai_raw) if ai_raw else None
        worker = orjson.loads(worker_raw) if worker_raw else None
        try:
            groups = await r.xinfo_groups(ALERTS_STREAM)
            backlog = {
                "length": await r.xlen(ALERTS_STREAM),
                "pending": sum(g.get("pending", 0) for g in groups),
                "lag": sum((g.get("lag") or 0) for g in groups),
                "consumers": sum(g.get("consumers", 0) for g in groups),
            }
        except Exception:  # noqa: BLE001 - stream not created yet before the first alert
            backlog = {"length": 0, "pending": 0, "lag": 0, "consumers": 0}

    now = time.time()
    if ai:
        age = now - ai.get("ts", 0)
        services["ai_service"] = {
            "status": _status(age < HEARTBEAT_STALE_S),
            "age_s": round(age, 1),
            "active_cameras": len(ai.get("cameras", [])),
            "device": ai.get("device"),
            "cpu_pct": ai.get("cpu_pct"),
            "memory_pct": ai.get("memory_pct"),
            "process_rss_mb": ai.get("process_rss_mb"),
            "gpus": ai.get("gpus", []),
        }
    else:
        services["ai_service"] = {"status": "down", "error": "no heartbeat"}

    if worker:
        age = now - worker.get("ts", 0)
        services["worker"] = {
            "status": _status(age < HEARTBEAT_STALE_S, degraded=bool(backlog and backlog["pending"] > 50)),
            "age_s": round(age, 1),
            "consumer": worker.get("consumer"),
            "sent": worker.get("sent"),
            "failed": worker.get("failed"),
        }
    else:
        services["worker"] = {"status": "down", "error": "no heartbeat"}

    proc = psutil.Process()
    services["api"] = {
        "status": "ok",
        "websocket_clients": connections.client_count,
        "cpu_pct": psutil.cpu_percent(interval=None),
        "memory_pct": psutil.virtual_memory().percent,
        "process_rss_mb": round(proc.memory_info().rss / 2**20, 1),
    }

    counts = dict((await db.execute(select(Camera.status, func.count()).group_by(Camera.status))).all())
    unhealthy = (
        await db.execute(
            select(Camera).where(Camera.is_active.is_(True), Camera.status.in_([CameraStatus.ERROR, CameraStatus.OFFLINE]))
        )
    ).scalars().all()

    overall = "ok"
    if any(s["status"] == "down" for s in services.values()):
        overall = "down" if services["database"]["status"] == "down" or services["redis"]["status"] == "down" else "degraded"
    elif any(s["status"] == "degraded" for s in services.values()) or unhealthy:
        overall = "degraded"

    return {
        "status": overall,
        "checked_at": now,
        "services": services,
        "notification_backlog": backlog,
        "cameras": {
            "by_status": {k.value: v for k, v in counts.items()},
            "unhealthy": [
                {"id": str(c.id), "name": c.name, "code": c.code, "status": c.status.value,
                 "error": c.last_error, "last_seen_at": c.last_seen_at.isoformat() if c.last_seen_at else None}
                for c in unhealthy
            ],
        },
    }
