import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Enum as SAEnum
from sqlalchemy import DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from common.enums import MetricScope
from common.models.base import Base, UUIDPKMixin
from common.models.types import GUID


class AnalyticsMetric(Base, UUIDPKMixin):
    """Generic time-series fact table backing historical trends and dashboards."""

    __tablename__ = "analytics_metrics"

    scope_type: Mapped[MetricScope] = mapped_column(
        SAEnum(MetricScope, name="metric_scope", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        index=True,
    )
    scope_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), nullable=True, index=True)
    metric_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    """e.g. people_count, density, avg_speed, fps, inference_ms, gpu_usage, cpu_usage."""
    value: Mapped[float] = mapped_column(Float, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
