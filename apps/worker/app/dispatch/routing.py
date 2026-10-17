"""Who hears about an alert, on which channel, and what they are told.

Pure functions over plain data, so routing policy is unit-tested without a database.

Staff and the public get different messages. Staff see the operational detail and a
link to the alert. Public subscribers only learn what to avoid and where: no
snapshots, no track ids, nothing about individuals, and always an unsubscribe link.
"""

import math
from dataclasses import dataclass, field

SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}

PUBLIC_GUIDANCE = {
    "panic": "People are moving away quickly. Stay calm, keep clear and follow staff directions.",
    "stampede": "Dangerous crowd movement. Do not enter the area; move away from the crowd's path.",
    "crowd_congestion": "The area is very crowded. Use another route if you can.",
    "rapid_density_increase": "The area is filling quickly. Expect delays and consider another route.",
    "abandoned_object": "An unattended item is being checked. Keep clear and follow staff directions.",
    "fighting": "Security is responding to an incident. Please keep clear of the area.",
}


@dataclass(frozen=True)
class StaffContact:
    user_id: str
    name: str
    email: str
    phone: str | None
    role: str


@dataclass(frozen=True)
class Subscriber:
    id: str
    latitude: float
    longitude: float
    radius_m: float
    channels: tuple[str, ...]
    email: str | None = None
    phone: str | None = None
    device_token: str | None = None
    unsubscribe_token: str | None = None


@dataclass
class Recipient:
    audience: str
    """staff | public | announcement"""
    channel: str
    address: str
    title: str
    body: str
    url: str | None = None
    subscription_id: str | None = None
    data: dict = field(default_factory=dict)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _at_least(severity: str, threshold: str) -> bool:
    return SEVERITY_RANK.get(severity, 0) >= SEVERITY_RANK.get(threshold, 99)


def mask_address(channel: str, address: str) -> str:
    """For history rows of public subscribers: enough to recognise, not to harvest."""
    if channel == "email" and "@" in address:
        local, domain = address.split("@", 1)
        return f"{local[:2]}***@{domain}"
    if channel in ("sms", "whatsapp"):
        return f"{address[:3]}****{address[-2:]}" if len(address) > 6 else "****"
    if channel == "push":
        return f"device …{address[-6:]}"
    return address


def plan_recipients(
    alert: dict,
    rules: dict,
    staff: list[StaffContact],
    subscribers: list[Subscriber],
    origin: tuple[float, float] | None,
    place: str,
    dashboard_url: str,
) -> list[Recipient]:
    severity = alert.get("severity", "low")
    alert_type = alert.get("alert_type", "")
    if alert_type in set(rules.get("muted_alert_types", [])):
        return []
    enabled = set(rules.get("enabled_channels", []))
    out: list[Recipient] = []

    if _at_least(severity, rules.get("staff_min_severity", "high")):
        channels = [c for c in rules.get("staff_channels", []) if c in enabled]
        title = f"{severity.upper()}: {alert.get('title', 'Alert')}"
        body = f"{alert.get('description') or ''} — {place}".strip(" —")
        url = f"{dashboard_url.rstrip('/')}/alerts?focus={alert.get('id')}"
        for person in staff:
            for channel in channels:
                address = person.email if channel == "email" else person.phone if channel in ("sms", "whatsapp") else None
                if address:
                    out.append(Recipient("staff", channel, address, title, body, url=url, data={"alert_id": alert.get("id")}))

    if origin and _at_least(severity, rules.get("public_min_severity", "critical")):
        allowed = set(rules.get("public_channels", [])) & enabled
        guidance = PUBLIC_GUIDANCE.get(alert_type, "Safety notice for this area. Please follow staff directions.")
        title = f"Safety notice: {place}"
        for sub in subscribers:
            if haversine_m(origin[0], origin[1], sub.latitude, sub.longitude) > sub.radius_m:
                continue
            unsubscribe = f"{dashboard_url.rstrip('/')}/subscribe?unsubscribe={sub.unsubscribe_token}" if sub.unsubscribe_token else None
            for channel in sub.channels:
                if channel not in allowed:
                    continue
                address = {"email": sub.email, "sms": sub.phone, "whatsapp": sub.phone, "push": sub.device_token}.get(channel)
                if not address:
                    continue
                body = guidance + (f"\nStop these alerts: {unsubscribe}" if unsubscribe and channel in ("email", "sms", "whatsapp") else "")
                out.append(Recipient("public", channel, address, title, body, subscription_id=sub.id))

    if "public_announcement" in enabled and _at_least(severity, rules.get("announcement_min_severity", "critical")):
        out.append(
            Recipient(
                "announcement",
                "public_announcement",
                place,
                f"Announcement: {place}",
                PUBLIC_GUIDANCE.get(alert_type, "Attention please. Follow staff directions."),
                data={"alert_type": alert_type, "zone_id": alert.get("zone_id")},
            )
        )
    return out
