import asyncio
import logging

import uvicorn
from fastapi import FastAPI

from app.core.config import get_settings
from app.pipeline.manager import PipelineManager
from app.utils.backend_client import backend_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("ccd.ai.main")

manager = PipelineManager()
app = FastAPI(title="Crowd Density AI Service")


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "active_cameras": manager.active_camera_count,
        "camera_ids": manager.camera_ids,
    }


async def _run() -> None:
    settings = get_settings()
    config = uvicorn.Config(app, host="0.0.0.0", port=settings.HEALTH_PORT, log_level="warning")
    server = uvicorn.Server(config)

    manager_task = asyncio.create_task(manager.run(), name="pipeline-manager")
    server_task = asyncio.create_task(server.serve(), name="health-server")

    try:
        await asyncio.gather(manager_task, server_task)
    except asyncio.CancelledError:
        pass
    finally:
        logger.info("Shutting down: stopping camera workers")
        await manager.stop()
        await backend_client.aclose()
        server.should_exit = True


if __name__ == "__main__":
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        pass
