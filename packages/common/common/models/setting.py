from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from common.models.base import Base, TimestampMixin
from common.models.types import PortableJSON


class Setting(Base, TimestampMixin):
    """Global platform key/value settings (YOLO confidence, alert thresholds, etc.)."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict] = mapped_column(PortableJSON, nullable=False, default=dict)
