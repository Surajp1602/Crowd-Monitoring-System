"""Connected dashboard clients and their topic subscriptions.

Topics are the unit of both routing and authorization:

    cameras          every camera's health and a 1 Hz people-count summary  camera:view
    camera:<id>      one camera's full frames (boxes + JPEG preview)          camera:view
    floor:<id>       a floor's heatmap and live track positions              map:view
    alerts           alert lifecycle events and raw anomaly signals          alert:view

Each client has a bounded queue drained by its own sender task. Live data is only
useful while fresh, so a slow client loses its oldest messages instead of growing
memory or stalling the broadcast for everyone else.
"""

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field

from fastapi import WebSocket

from common.rbac import Perm

from app.deps import CurrentUser

logger = logging.getLogger("ccd.ws")

CLIENT_QUEUE_SIZE = 256

_TOPIC_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^cameras$"), Perm.CAMERA_VIEW),
    (re.compile(r"^camera:[0-9a-f-]{36}$"), Perm.CAMERA_VIEW),
    (re.compile(r"^floor:[0-9a-f-]{36}$"), Perm.MAP_VIEW),
    (re.compile(r"^alerts$"), Perm.ALERT_VIEW),
]


def required_permission(topic: str) -> str | None:
    """The permission a topic needs, or None if the topic name is not valid at all."""
    for pattern, perm in _TOPIC_RULES:
        if pattern.match(topic):
            return perm
    return None


@dataclass(eq=False)
class Client:
    websocket: WebSocket
    user: CurrentUser
    expires_at: float
    topics: set[str] = field(default_factory=set)
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=CLIENT_QUEUE_SIZE))
    dropped: int = 0

    @property
    def expired(self) -> bool:
        return time.time() >= self.expires_at

    def offer(self, text: str) -> None:
        if self.queue.full():
            try:
                self.queue.get_nowait()
                self.dropped += 1
            except asyncio.QueueEmpty:
                pass
        self.queue.put_nowait(text)


class ConnectionManager:
    def __init__(self) -> None:
        self._topics: dict[str, set[Client]] = {}
        self._clients: set[Client] = set()

    @property
    def client_count(self) -> int:
        return len(self._clients)

    def register(self, client: Client) -> None:
        self._clients.add(client)

    def unregister(self, client: Client) -> None:
        self._clients.discard(client)
        for topic in list(client.topics):
            self._remove(client, topic)

    def subscribe(self, client: Client, topic: str) -> tuple[bool, str | None]:
        perm = required_permission(topic)
        if perm is None:
            return False, "unknown topic"
        if not client.user.has_permission(perm):
            return False, f"missing permission {perm}"
        client.topics.add(topic)
        self._topics.setdefault(topic, set()).add(client)
        return True, None

    def unsubscribe(self, client: Client, topic: str) -> None:
        self._remove(client, topic)

    def _remove(self, client: Client, topic: str) -> None:
        client.topics.discard(topic)
        subscribers = self._topics.get(topic)
        if subscribers is not None:
            subscribers.discard(client)
            if not subscribers:
                del self._topics[topic]

    def has_subscribers(self, topic: str) -> bool:
        return bool(self._topics.get(topic))

    def active_topics(self) -> set[str]:
        return set(self._topics)

    def broadcast(self, topic: str, text: str) -> int:
        subscribers = self._topics.get(topic)
        if not subscribers:
            return 0
        for client in list(subscribers):
            client.offer(text)
        return len(subscribers)


connections = ConnectionManager()
