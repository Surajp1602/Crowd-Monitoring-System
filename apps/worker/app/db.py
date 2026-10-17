from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from functools import lru_cache

import redis.asyncio as redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings


@lru_cache
def _session_factory() -> async_sessionmaker[AsyncSession]:
    engine = create_async_engine(get_settings().DATABASE_URL, pool_pre_ping=True)
    return async_sessionmaker(bind=engine, expire_on_commit=False, class_=AsyncSession)


@asynccontextmanager
async def session_scope() -> AsyncGenerator[AsyncSession, None]:
    async with _session_factory()() as session:
        yield session


@lru_cache
def get_redis() -> redis.Redis:
    return redis.from_url(get_settings().REDIS_URL, decode_responses=True, socket_connect_timeout=3)
