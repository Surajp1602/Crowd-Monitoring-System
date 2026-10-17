"""In-memory cache of the DB-backed `settings` table (YOLO thresholds, tracking
params, density/anomaly config). Refreshed on a timer by the pipeline manager so
operators changing thresholds via the backend's Settings API take effect here
without a redeploy, without hitting Postgres on every single frame.
"""

import logging

from sqlalchemy import select

from common.default_settings import DEFAULT_SETTINGS
from common.models import Setting

from app.db.session import session_scope

logger = logging.getLogger("ccd.ai.settings")


class RuntimeSettings:
    def __init__(self) -> None:
        self._values: dict[str, dict] = {k: dict(v) for k, v in DEFAULT_SETTINGS.items()}

    async def refresh(self) -> None:
        try:
            async with session_scope() as db:
                rows = (await db.execute(select(Setting))).scalars().all()
            for row in rows:
                if row.key in self._values:
                    self._values[row.key].update(row.value)
                else:
                    self._values[row.key] = dict(row.value)
        except Exception:
            logger.exception("Failed to refresh runtime settings from DB; keeping previous values")

    @property
    def yolo(self) -> dict:
        return self._values["yolo"]

    @property
    def tracking(self) -> dict:
        return self._values["tracking"]

    @property
    def density(self) -> dict:
        return self._values["density"]

    @property
    def anomaly(self) -> dict:
        return self._values["anomaly"]


runtime_settings = RuntimeSettings()
