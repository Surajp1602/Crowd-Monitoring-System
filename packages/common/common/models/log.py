from datetime import datetime

from sqlalchemy import Enum as SAEnum
from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from common.enums import LogLevel
from common.models.base import Base, UUIDPKMixin
from common.models.types import PortableJSON


class SystemLog(Base, UUIDPKMixin):
    __tablename__ = "system_logs"

    level: Mapped[LogLevel] = mapped_column(
        SAEnum(LogLevel, name="log_level", values_callable=lambda e: [m.value for m in e]),
        default=LogLevel.INFO,
        nullable=False,
        index=True,
    )
    source: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    message: Mapped[str] = mapped_column(String(2000), nullable=False)
    context: Mapped[dict] = mapped_column(PortableJSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
