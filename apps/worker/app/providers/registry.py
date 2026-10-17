"""Builds one provider per channel from configuration. A channel whose provider is
misconfigured falls back to noop and reports why, rather than crashing the worker."""

import logging

from app.config import Settings
from app.providers.base import ConsoleProvider, NoopProvider, Provider
from app.providers.channels import FcmProvider, SmtpEmailProvider, TwilioProvider, WebhookProvider

logger = logging.getLogger("ccd.worker.providers")

CHANNELS = ("email", "sms", "whatsapp", "push", "public_announcement")


def _build(channel: str, kind: str, s: Settings) -> Provider:
    if kind == "console":
        return ConsoleProvider(channel, logger)
    if channel == "email" and kind == "smtp":
        return SmtpEmailProvider(s.SMTP_HOST, s.SMTP_PORT, s.SMTP_USERNAME, s.SMTP_PASSWORD, s.SMTP_STARTTLS, s.SMTP_FROM)
    if channel in ("sms", "whatsapp") and kind == "twilio":
        if not (s.TWILIO_ACCOUNT_SID and s.TWILIO_AUTH_TOKEN):
            raise ValueError("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required")
        sender = s.TWILIO_WHATSAPP_FROM if channel == "whatsapp" else s.TWILIO_SMS_FROM
        if not sender:
            raise ValueError(f"TWILIO_{'WHATSAPP' if channel == 'whatsapp' else 'SMS'}_FROM is required")
        return TwilioProvider(s.TWILIO_ACCOUNT_SID, s.TWILIO_AUTH_TOKEN, sender, whatsapp=channel == "whatsapp")
    if channel == "push" and kind == "fcm":
        if not s.FCM_SERVICE_ACCOUNT_FILE:
            raise ValueError("FCM_SERVICE_ACCOUNT_FILE is required")
        return FcmProvider(s.FCM_SERVICE_ACCOUNT_FILE)
    if kind == "webhook":
        url = s.PUSH_WEBHOOK_URL if channel == "push" else s.ANNOUNCEMENT_WEBHOOK_URL
        if not url:
            raise ValueError(f"{'PUSH' if channel == 'push' else 'ANNOUNCEMENT'}_WEBHOOK_URL is required")
        return WebhookProvider(url, s.WEBHOOK_SECRET, channel)
    if kind == "noop":
        return NoopProvider(channel)
    raise ValueError(f"unknown provider {kind!r} for channel {channel}")


def build_providers(s: Settings) -> tuple[dict[str, Provider], dict[str, dict]]:
    configured = {
        "email": s.NOTIFICATION_EMAIL_PROVIDER,
        "sms": s.NOTIFICATION_SMS_PROVIDER,
        "whatsapp": s.NOTIFICATION_WHATSAPP_PROVIDER,
        "push": s.NOTIFICATION_PUSH_PROVIDER,
        "public_announcement": s.NOTIFICATION_ANNOUNCEMENT_PROVIDER,
    }
    providers: dict[str, Provider] = {}
    status: dict[str, dict] = {}
    for channel in CHANNELS:
        kind = configured[channel].strip().lower() or "noop"
        try:
            providers[channel] = _build(channel, kind, s)
            status[channel] = {"provider": kind, "ready": kind != "noop", "error": None}
        except Exception as exc:  # noqa: BLE001 - surface any config error without crashing
            logger.error("Channel %s: provider %s unavailable: %s", channel, kind, exc)
            providers[channel] = NoopProvider(channel)
            status[channel] = {"provider": kind, "ready": False, "error": str(exc)}
    return providers, status
