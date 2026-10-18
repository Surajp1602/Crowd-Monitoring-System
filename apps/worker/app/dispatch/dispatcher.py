"""Consumes alerts from the `alerts:dispatch` Redis Stream and delivers notifications.

A consumer group means each alert is handled by exactly one worker replica, and an
entry is acknowledged only after every recipient has been attempted and recorded, so
a crash mid-dispatch leaves it pending. Entries a dead consumer left pending are
reclaimed after CLAIM_IDLE_MS. A per-recipient, per-alert-type cooldown (Redis SET NX)
keeps a burst of related alerts from flooding anyone's phone.

`notifications:outbox` carries one-off messages (test sends from the dashboard)
through the same providers and history.
"""

import asyncio
import logging
import os
import socket
import uuid
from datetime import datetime, timezone

import orjson
from sqlalchemy import select

from common.default_settings import DEFAULT_SETTINGS
from common.enums import NotificationChannel, NotificationStatus, RoleName
from common.models import Building, Camera, GeofenceSubscription, NotificationHistory, Role, Setting, User, Zone
from common.redis_channels import ALERTS_STREAM

from app.config import get_settings
from app.db import get_redis, session_scope
from app.dispatch.routing import Recipient, StaffContact, Subscriber, mask_address, plan_recipients
from app.providers.base import OutgoingMessage, Provider, SendResult

logger = logging.getLogger("ccd.worker.dispatch")

GROUP = "dispatchers"
OUTBOX_STREAM = "notifications:outbox"
STAFF_ROLES = {RoleName.ADMIN.value, RoleName.SUPERVISOR.value, RoleName.SECURITY_OFFICER.value}


def consumer_name() -> str:
    return get_settings().CONSUMER_NAME or f"{socket.gethostname()}-{os.getpid()}"


class Dispatcher:
    def __init__(self, providers: dict[str, Provider]) -> None:
        self.providers = providers
        self.settings = get_settings()
        self.consumer = consumer_name()
        self.sent = 0
        self.failed = 0

    # ---- stream plumbing --------------------------------------------------------

    async def ensure_groups(self) -> None:
        r = get_redis()
        for stream in (ALERTS_STREAM, OUTBOX_STREAM):
            try:
                # "$": a brand-new group starts at the tail, so first boot never replays
                # a backlog of old alerts to everyone's phone.
                await r.xgroup_create(stream, GROUP, id="$", mkstream=True)
            except Exception as exc:  # noqa: BLE001
                if "BUSYGROUP" not in str(exc):
                    raise

    async def run(self, stop: asyncio.Event) -> None:
        await self.ensure_groups()
        r = get_redis()
        while not stop.is_set():
            try:
                for stream in (ALERTS_STREAM, OUTBOX_STREAM):
                    _, claimed, *_ = await r.xautoclaim(
                        stream, GROUP, self.consumer, min_idle_time=self.settings.CLAIM_IDLE_MS, start_id="0-0", count=20
                    )
                    for entry_id, fields in claimed:
                        await self._handle(stream, entry_id, fields)
                batches = await r.xreadgroup(GROUP, self.consumer, {ALERTS_STREAM: ">", OUTBOX_STREAM: ">"}, count=20, block=3000)
                for stream, entries in batches or []:
                    for entry_id, fields in entries:
                        await self._handle(stream, entry_id, fields)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Dispatch loop error; retrying shortly")
                await asyncio.sleep(2)

    async def _handle(self, stream: str, entry_id: str, fields: dict) -> None:
        try:
            if stream == ALERTS_STREAM:
                await self.dispatch_alert(orjson.loads(fields["payload"]))
            else:
                await self.dispatch_outbox(orjson.loads(fields["payload"]))
        except Exception:
            # Poison entries are logged and acknowledged; leaving them pending would
            # make every replica retry them forever.
            logger.exception("Failed to process %s entry %s", stream, entry_id)
        await get_redis().xack(stream, GROUP, entry_id)

    # ---- alert dispatch ---------------------------------------------------------

    async def _context(self, alert: dict) -> tuple[dict, list[StaffContact], list[Subscriber], tuple[float, float] | None, str]:
        async with session_scope() as db:
            row = await db.get(Setting, "notifications")
            rules = {**DEFAULT_SETTINGS["notifications"], **(row.value if row else {})}

            staff_rows = (
                await db.execute(
                    select(User, Role)
                    .join(Role, User.role_id == Role.id)
                    .where(User.is_active.is_(True), User.notify_enabled.is_(True), Role.name.in_(STAFF_ROLES))
                )
            ).all()
            staff = [
                StaffContact(str(u.id), u.full_name, u.email, u.phone_number, role.name) for u, role in staff_rows
            ]

            subs = [
                Subscriber(
                    id=str(s.id), latitude=s.latitude, longitude=s.longitude, radius_m=s.radius_m,
                    channels=tuple(s.channels or ()), email=s.email, phone=s.phone_number,
                    device_token=s.device_token, unsubscribe_token=s.unsubscribe_token,
                )
                for s in (await db.execute(select(GeofenceSubscription).where(GeofenceSubscription.is_active.is_(True)))).scalars()
            ]

            origin, place = None, "the facility"
            camera = await db.get(Camera, uuid.UUID(alert["camera_id"])) if alert.get("camera_id") else None
            building = await db.get(Building, camera.building_id) if camera and camera.building_id else None
            zone = await db.get(Zone, uuid.UUID(alert["zone_id"])) if alert.get("zone_id") else None
            if camera and camera.latitude is not None and camera.longitude is not None:
                origin = (camera.latitude, camera.longitude)
            elif building and building.latitude is not None and building.longitude is not None:
                origin = (building.latitude, building.longitude)
            parts = [p for p in (zone.name if zone else None, building.name if building else None) if p]
            if parts:
                place = ", ".join(parts)
        return rules, staff, subs, origin, place

    async def dispatch_alert(self, alert: dict) -> list[SendResult]:
        rules, staff, subs, origin, place = await self._context(alert)
        recipients = plan_recipients(alert, rules, staff, subs, origin, place, self.settings.PUBLIC_DASHBOARD_URL)
        cooldown = int(rules.get("recipient_cooldown_s", 300))
        results = []
        for recipient in recipients:
            if not await self._claim_cooldown(recipient, alert.get("alert_type", ""), cooldown):
                continue
            results.append(await self._deliver(recipient, alert, severity=alert.get("severity", "medium")))
        if recipients:
            logger.info("Alert %s: %d recipients planned, %d attempted", alert.get("id"), len(recipients), len(results))
        return results

    async def _claim_cooldown(self, recipient: Recipient, alert_type: str, seconds: int) -> bool:
        if seconds <= 0 or (recipient.audience == "announcement" and alert_type in ("panic", "stampede")):
            return True
        key = f"notify:cooldown:{recipient.channel}:{recipient.address}:{alert_type}"
        return bool(await get_redis().set(key, "1", ex=seconds, nx=True))

    async def dispatch_outbox(self, item: dict) -> SendResult:
        recipient = Recipient(
            audience=item.get("audience", "test"),
            channel=item["channel"],
            address=item["recipient"],
            title=item.get("title", "CCD test notification"),
            body=item.get("body", "This is a test message from the CCD platform."),
        )
        return await self._deliver(recipient, None, severity="low")

    async def _deliver(self, recipient: Recipient, alert: dict | None, severity: str) -> SendResult:
        provider = self.providers.get(recipient.channel)
        message = OutgoingMessage(
            channel=recipient.channel, recipient=recipient.address, title=recipient.title, body=recipient.body,
            severity=severity, url=recipient.url, data=recipient.data,
        )
        result = SendResult(ok=False, provider="none", response={"error": "no provider for channel"})
        attempts = max(1, self.settings.SEND_ATTEMPTS)
        for attempt in range(1, attempts + 1):
            if provider is None:
                break
            result = await provider.send(message)
            if result.ok or not result.retryable or attempt == attempts:
                break
            await asyncio.sleep(self.settings.RETRY_BASE_DELAY_S * 2 ** (attempt - 1))
        result.response["attempts"] = attempt if provider else 0

        if result.ok:
            self.sent += 1
        else:
            self.failed += 1
            logger.warning("Delivery failed on %s via %s: %s", recipient.channel, result.provider, result.response)

        stored_address = recipient.address if recipient.audience in ("staff", "test", "announcement") else mask_address(recipient.channel, recipient.address)
        async with session_scope() as db:
            db.add(
                NotificationHistory(
                    alert_id=uuid.UUID(alert["id"]) if alert and alert.get("id") else None,
                    channel=NotificationChannel(recipient.channel),
                    recipient=stored_address,
                    status=NotificationStatus.SENT if result.ok else NotificationStatus.FAILED,
                    provider=result.provider,
                    provider_response={**result.response, "audience": recipient.audience},
                    sent_at=datetime.now(timezone.utc) if result.ok else None,
                    created_at=datetime.now(timezone.utc),
                )
            )
            await db.commit()
        return result
