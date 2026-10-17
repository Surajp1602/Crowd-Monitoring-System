import pytest

from common.default_settings import DEFAULT_SETTINGS

from app.dispatch.routing import StaffContact, Subscriber, haversine_m, mask_address, plan_recipients
from app.providers.registry import build_providers

RULES = DEFAULT_SETTINGS["notifications"]
ORIGIN = (12.9767, 77.5713)
STAFF = [
    StaffContact("u1", "Asha", "asha@ops.example", "+919800000001", "security_officer"),
    StaffContact("u2", "Ravi", "ravi@ops.example", None, "supervisor"),
]
NEAR = Subscriber("s1", 12.9770, 77.5715, 200, ("push", "sms"), phone="+919811111111", device_token="tok-abcdef", unsubscribe_token="u-1")
FAR = Subscriber("s2", 13.0500, 77.6000, 200, ("sms",), phone="+919822222222")


def alert(severity="critical", alert_type="panic"):
    return {"id": "a1", "severity": severity, "alert_type": alert_type, "title": "Possible panic", "description": "6 of 9 running."}


def plan(a, rules=RULES, subs=(NEAR, FAR)):
    return plan_recipients(a, rules, STAFF, list(subs), ORIGIN, "Ticket Hall, Central Station", "https://ccd.example")


def test_haversine():
    assert haversine_m(*ORIGIN, *ORIGIN) == 0
    assert 30 < haversine_m(*ORIGIN, NEAR.latitude, NEAR.longitude) < 50


def test_critical_alert_reaches_staff_nearby_public_and_announcement():
    recipients = plan(alert())
    staff = [(r.channel, r.address) for r in recipients if r.audience == "staff"]
    assert ("email", "asha@ops.example") in staff and ("sms", "+919800000001") in staff
    assert ("email", "ravi@ops.example") in staff and not any(a is None for _, a in staff)

    public = [r for r in recipients if r.audience == "public"]
    assert {r.channel for r in public} == {"push", "sms"}
    assert all(r.subscription_id == "s1" for r in public), "out-of-radius subscriber must not be notified"
    sms = next(r for r in public if r.channel == "sms")
    assert "unsubscribe=u-1" in sms.body and "running" not in sms.body.lower() + sms.title.lower()

    assert [r.channel for r in recipients if r.audience == "announcement"] == ["public_announcement"]


def test_high_alert_stays_internal():
    recipients = plan(alert(severity="high", alert_type="restricted_area_intrusion"))
    assert {r.audience for r in recipients} == {"staff"}


def test_low_alert_goes_nowhere_by_default():
    assert plan(alert(severity="low", alert_type="loitering")) == []


def test_muted_types_and_disabled_channels():
    assert plan(alert(), {**RULES, "muted_alert_types": ["panic"]}) == []
    no_sms = plan(alert(), {**RULES, "enabled_channels": ["email", "push"]})
    assert {r.channel for r in no_sms} == {"email", "push"}


def test_staff_links_point_at_the_alert():
    staff = [r for r in plan(alert()) if r.audience == "staff"]
    assert staff[0].url == "https://ccd.example/alerts?focus=a1"


@pytest.mark.parametrize(
    "channel,address,expected",
    [("email", "priya@example.com", "pr***@example.com"), ("sms", "+919811111111", "+91****11"), ("push", "tok-abcdef", "device …abcdef")],
)
def test_masking(channel, address, expected):
    assert mask_address(channel, address) == expected


def test_misconfigured_provider_falls_back_to_noop():
    from app.config import Settings

    providers, status = build_providers(Settings(NOTIFICATION_SMS_PROVIDER="twilio", NOTIFICATION_EMAIL_PROVIDER="console"))
    assert status["sms"]["ready"] is False and "TWILIO_ACCOUNT_SID" in status["sms"]["error"]
    assert providers["sms"].name == "noop:sms"
    assert status["email"] == {"provider": "console", "ready": True, "error": None}
