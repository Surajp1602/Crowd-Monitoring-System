import fnmatch
import time
from collections import defaultdict

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from common.models import Base


class FakeRedis:
    """Covers the KV and Streams/consumer-group calls the worker makes."""

    def __init__(self) -> None:
        self.kv: dict[str, tuple[str, float | None]] = {}
        self.streams: dict[str, list[tuple[str, dict]]] = defaultdict(list)
        self.groups: dict[tuple[str, str], dict] = {}
        self._seq = 0

    async def set(self, key, value, ex=None, nx=False):
        if nx and await self.get(key) is not None:
            return None
        self.kv[key] = (value, time.time() + ex if ex else None)
        return True

    async def get(self, key):
        item = self.kv.get(key)
        if item is None or (item[1] is not None and item[1] < time.time()):
            return None
        return item[0]

    async def mget(self, keys):
        return [await self.get(k) for k in keys]

    async def scan_iter(self, match="*"):
        for k in list(self.kv):
            if fnmatch.fnmatchcase(k, match):
                yield k

    async def xadd(self, stream, fields, maxlen=None, approximate=True):
        self._seq += 1
        entry_id = f"{self._seq}-0"
        self.streams[stream].append((entry_id, dict(fields)))
        return entry_id

    async def xgroup_create(self, stream, group, id="$", mkstream=False):
        if (stream, group) in self.groups:
            raise Exception("BUSYGROUP Consumer Group name already exists")
        start = len(self.streams[stream]) if id == "$" else 0
        self.groups[(stream, group)] = {"next": start, "pending": {}}
        return True

    async def xreadgroup(self, group, consumer, streams, count=10, block=None):
        out = []
        for stream in streams:
            g = self.groups[(stream, group)]
            entries = self.streams[stream][g["next"] : g["next"] + count]
            g["next"] += len(entries)
            for entry_id, _ in entries:
                g["pending"][entry_id] = (consumer, time.time())
            if entries:
                out.append((stream, entries))
        return out

    async def xack(self, stream, group, *ids):
        g = self.groups[(stream, group)]
        return sum(1 for i in ids if g["pending"].pop(i, None) is not None)

    async def xautoclaim(self, stream, group, consumer, min_idle_time, start_id="0-0", count=10):
        g = self.groups[(stream, group)]
        now = time.time()
        claimed = []
        for entry_id, (owner, since) in list(g["pending"].items()):
            if (now - since) * 1000 >= min_idle_time:
                g["pending"][entry_id] = (consumer, now)
                claimed.append(next(e for e in self.streams[stream] if e[0] == entry_id))
        return ("0-0", claimed[:count], [])


class RecordingProvider:
    def __init__(self, channel, fail_times=0, retryable=True):
        self.name = f"recording:{channel}"
        self.sent = []
        self._fail = fail_times
        self._retryable = retryable

    async def send(self, message):
        from app.providers.base import SendResult

        if self._fail > 0:
            self._fail -= 1
            return SendResult(ok=False, provider=self.name, response={"error": "boom"}, retryable=self._retryable)
        self.sent.append(message)
        return SendResult(ok=True, provider=self.name, response={"delivered": True})


@pytest_asyncio.fixture
async def env(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, expire_on_commit=False, class_=AsyncSession)
    fake = FakeRedis()

    import app.analytics.rollup as rollup
    import app.db as db
    import app.dispatch.dispatcher as dispatcher

    monkeypatch.setattr(db, "_session_factory", lambda: factory)
    for module in (db, dispatcher, rollup):
        monkeypatch.setattr(module, "get_redis", lambda: fake)
    monkeypatch.setattr(dispatcher.get_settings(), "RETRY_BASE_DELAY_S", 0.0)
    yield type("Env", (), {"factory": factory, "redis": fake})
    await engine.dispose()


@pytest.fixture
def recording():
    return {c: RecordingProvider(c) for c in ("email", "sms", "whatsapp", "push", "public_announcement")}
