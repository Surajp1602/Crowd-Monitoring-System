"""CCD worker: notification dispatch, analytics rollups, data retention.

Stateless apart from its Redis consumer-group membership; run as many replicas as
throughput needs. Every periodic job claims its time bucket in Redis first, so
replicas never double-write.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone

import orjson
import uvicorn
from fastapi import FastAPI

from common.redis_channels import WORKER_HEARTBEAT_KEY

from app.analytics.backfill import backfill
from app.analytics.rollup import run_minute, run_retention
from app.config import get_settings
from app.db import get_redis
from app.dispatch.dispatcher import Dispatcher, consumer_name
from app.providers.registry import build_providers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("ccd.worker")

PROVIDERS_KEY = "worker:providers"

settings = get_settings()
providers, provider_status = build_providers(settings)
dispatcher = Dispatcher(providers)
started_at = time.time()
app = FastAPI(title="CCD Worker")


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "consumer": dispatcher.consumer,
        "uptime_s": round(time.time() - started_at),
        "sent": dispatcher.sent,
        "failed": dispatcher.failed,
        "providers": provider_status,
    }


async def _every(seconds: float, job, stop: asyncio.Event, name: str) -> None:
    while not stop.is_set():
        try:
            await job()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("%s failed", name)
        try:
            await asyncio.wait_for(stop.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass


async def _heartbeat() -> None:
    payload = {
        "ts": time.time(),
        "consumer": consumer_name(),
        "sent": dispatcher.sent,
        "failed": dispatcher.failed,
        "started_at": datetime.fromtimestamp(started_at, tz=timezone.utc).isoformat(),
    }
    r = get_redis()
    await r.set(WORKER_HEARTBEAT_KEY, orjson.dumps(payload).decode(), ex=30)
    await r.set(PROVIDERS_KEY, orjson.dumps(provider_status).decode(), ex=60)


async def _run() -> None:
    stop = asyncio.Event()
    server = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=settings.HEALTH_PORT, log_level="warning"))
    logger.info("Providers: %s", {c: s["provider"] for c, s in provider_status.items()})
    if settings.SEED_DEMO_HISTORY:
        try:
            await backfill()
        except Exception:
            logger.exception("Demo history backfill failed")
    tasks = [
        asyncio.create_task(dispatcher.run(stop), name="dispatcher"),
        asyncio.create_task(_every(10, _heartbeat, stop, "heartbeat"), name="heartbeat"),
        asyncio.create_task(_every(settings.ROLLUP_INTERVAL_S, run_minute, stop, "rollup"), name="rollup"),
        asyncio.create_task(_every(1800, run_retention, stop, "retention"), name="retention"),
        asyncio.create_task(server.serve(), name="health-server"),
    ]
    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        pass
    finally:
        stop.set()
        server.should_exit = True
        for task in tasks:
            task.cancel()


if __name__ == "__main__":
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        pass
