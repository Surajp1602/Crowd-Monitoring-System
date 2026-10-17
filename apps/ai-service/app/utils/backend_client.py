import logging

import httpx

from app.core.config import get_settings

logger = logging.getLogger("ccd.ai.backend_client")


class BackendClient:
    def __init__(self) -> None:
        settings = get_settings()
        self._base_url = settings.BACKEND_URL.rstrip("/")
        self._headers = {"X-Internal-Api-Key": settings.INTERNAL_SERVICE_API_KEY}
        self._client = httpx.AsyncClient(base_url=self._base_url, headers=self._headers, timeout=5.0)

    async def report_camera_health(
        self, camera_id: str, status: str, fps: float, latency_ms: float, error: str | None = None
    ) -> None:
        try:
            resp = await self._client.post(
                f"/api/v1/cameras/{camera_id}/health",
                json={"status": status, "fps": fps, "latency_ms": latency_ms, "error": error},
            )
            resp.raise_for_status()
        except httpx.HTTPError:
            logger.warning("Failed to report health for camera %s", camera_id, exc_info=True)

    async def aclose(self) -> None:
        await self._client.aclose()


backend_client = BackendClient()
