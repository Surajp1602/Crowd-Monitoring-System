from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()

engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True, echo=False)
AsyncSessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False, class_=AsyncSession)


@asynccontextmanager
async def session_scope() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
