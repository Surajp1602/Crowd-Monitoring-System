"""In-memory stand-in for the slice of redis.asyncio the backend uses, so the test
suite needs no Redis server and can assert on what was published."""

import asyncio
import fnmatch
import time
from collections import defaultdict


class FakePubSub:
    def __init__(self, redis: "FakeRedis") -> None:
        self._redis = redis
        self._queue: asyncio.Queue = asyncio.Queue()
        self.channels: set[str] = set()
        self.patterns: set[str] = set()

    async def subscribe(self, *channels: str) -> None:
        self.channels.update(channels)
        self._redis._subscribers.append(self)

    async def psubscribe(self, *patterns: str) -> None:
        self.patterns.update(patterns)
        self._redis._subscribers.append(self)

    def _deliver(self, channel: str, data: str) -> None:
        if channel in self.channels:
            self._queue.put_nowait({"type": "message", "channel": channel, "data": data})
            return
        for pattern in self.patterns:
            if fnmatch.fnmatchcase(channel, pattern):
                self._queue.put_nowait({"type": "pmessage", "pattern": pattern, "channel": channel, "data": data})
                return

    async def get_message(self, ignore_subscribe_messages: bool = True, timeout: float = 0.0):
        try:
            return await asyncio.wait_for(self._queue.get(), timeout=timeout or 0.01)
        except asyncio.TimeoutError:
            return None

    async def listen(self):
        while True:
            yield await self._queue.get()

    async def unsubscribe(self, *args) -> None:
        self.channels.clear()

    async def punsubscribe(self, *args) -> None:
        self.patterns.clear()

    async def aclose(self) -> None:
        if self in self._redis._subscribers:
            self._redis._subscribers.remove(self)

    close = aclose


class FakeRedis:
    def __init__(self) -> None:
        self.published: list[tuple[str, str]] = []
        self.streams: dict[str, list[tuple[str, dict]]] = defaultdict(list)
        self.kv: dict[str, tuple[str, float | None]] = {}
        self._subscribers: list[FakePubSub] = []
        self._seq = 0

    async def ping(self) -> bool:
        return True

    async def publish(self, channel: str, data: str) -> int:
        self.published.append((channel, data))
        for sub in list(self._subscribers):
            sub._deliver(channel, data)
        return len(self._subscribers)

    async def xadd(self, stream: str, fields: dict, maxlen: int | None = None, approximate: bool = True) -> str:
        self._seq += 1
        entry_id = f"{int(time.time() * 1000)}-{self._seq}"
        self.streams[stream].append((entry_id, dict(fields)))
        return entry_id

    async def set(self, key: str, value: str, ex: int | None = None) -> bool:
        self.kv[key] = (value, time.time() + ex if ex else None)
        return True

    async def get(self, key: str) -> str | None:
        item = self.kv.get(key)
        if item is None:
            return None
        value, expires = item
        if expires is not None and expires < time.time():
            del self.kv[key]
            return None
        return value

    async def mget(self, keys: list[str]) -> list[str | None]:
        return [await self.get(k) for k in keys]

    async def incr(self, key: str) -> int:
        value = int((await self.get(key)) or 0) + 1
        _, expires = self.kv.get(key, (None, None))
        self.kv[key] = (str(value), expires)
        return value

    async def expire(self, key: str, seconds: int) -> bool:
        if key in self.kv:
            self.kv[key] = (self.kv[key][0], time.time() + seconds)
        return True

    async def delete(self, *keys: str) -> int:
        return sum(1 for k in keys if self.kv.pop(k, None) is not None)

    async def scan_iter(self, match: str = "*"):
        for key in list(self.kv):
            if fnmatch.fnmatchcase(key, match):
                yield key

    def pubsub(self) -> FakePubSub:
        return FakePubSub(self)

    async def aclose(self) -> None:
        pass
