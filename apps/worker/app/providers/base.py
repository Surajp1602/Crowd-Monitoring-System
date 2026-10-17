"""Notification provider contract.

A provider delivers one message to one recipient on one channel and reports what
happened. Providers never raise for delivery failures; they return a failed result
with the provider's response, so the dispatcher can record and retry uniformly.
Transient failures (network, 5xx, rate limiting) are marked retryable.
"""

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class OutgoingMessage:
    channel: str
    recipient: str
    title: str
    body: str
    severity: str = "medium"
    url: str | None = None
    data: dict = field(default_factory=dict)


@dataclass
class SendResult:
    ok: bool
    provider: str
    response: dict = field(default_factory=dict)
    retryable: bool = False


class Provider(Protocol):
    name: str

    async def send(self, message: OutgoingMessage) -> SendResult: ...


class NoopProvider:
    """Accepts and drops everything: the safe default until a channel is configured."""

    def __init__(self, channel: str) -> None:
        self.name = f"noop:{channel}"

    async def send(self, message: OutgoingMessage) -> SendResult:
        return SendResult(ok=True, provider=self.name, response={"delivered": False, "reason": "provider not configured"})


class ConsoleProvider:
    """Logs every message: for development and demos."""

    def __init__(self, channel: str, logger) -> None:
        self.name = f"console:{channel}"
        self._logger = logger

    async def send(self, message: OutgoingMessage) -> SendResult:
        self._logger.info("[%s → %s] %s — %s", message.channel, message.recipient, message.title, message.body)
        return SendResult(ok=True, provider=self.name, response={"delivered": True, "logged": True})


def http_result(provider: str, status: int, body: dict | str) -> SendResult:
    ok = 200 <= status < 300
    return SendResult(
        ok=ok,
        provider=provider,
        response={"status": status, "body": body},
        retryable=not ok and (status >= 500 or status == 429),
    )
