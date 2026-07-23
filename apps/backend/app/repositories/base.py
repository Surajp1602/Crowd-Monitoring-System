import uuid
from typing import Any, Generic, TypeVar

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from common.models.base import Base

ModelT = TypeVar("ModelT", bound=Base)


class BaseRepository(Generic[ModelT]):
    """Thin CRUD layer over a single SQLAlchemy model. Service classes own business
    rules (encryption, cross-entity validation, cache invalidation); repositories
    only translate between the domain and the database."""

    model: type[ModelT]

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get(self, id_: uuid.UUID) -> ModelT | None:
        return await self.db.get(self.model, id_)

    async def list(
        self, *, offset: int = 0, limit: int = 50, order_by: Any = None, **filters: Any
    ) -> tuple[list[ModelT], int]:
        stmt = select(self.model)
        count_stmt = select(func.count()).select_from(self.model)
        for field, value in filters.items():
            if value is None:
                continue
            stmt = stmt.where(getattr(self.model, field) == value)
            count_stmt = count_stmt.where(getattr(self.model, field) == value)
        if order_by is not None:
            stmt = stmt.order_by(order_by)
        stmt = stmt.offset(offset).limit(limit)
        items = (await self.db.execute(stmt)).scalars().all()
        total = (await self.db.execute(count_stmt)).scalar_one()
        return list(items), total

    async def create(self, **kwargs: Any) -> ModelT:
        obj = self.model(**kwargs)
        self.db.add(obj)
        await self.db.flush()
        await self.db.refresh(obj)
        return obj

    async def update(self, obj: ModelT, **kwargs: Any) -> ModelT:
        for key, value in kwargs.items():
            if value is not None:
                setattr(obj, key, value)
        await self.db.flush()
        await self.db.refresh(obj)
        return obj

    async def delete(self, obj: ModelT) -> None:
        await self.db.delete(obj)
        await self.db.flush()
