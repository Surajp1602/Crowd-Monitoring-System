"""Concrete providers: SMTP email, Twilio SMS and WhatsApp, Firebase Cloud Messaging,
and signed webhooks (push gateways, public-address and signage systems)."""

import asyncio
import hashlib
import hmac
import json
import smtplib
import time
from email.message import EmailMessage

import httpx
from jose import jwt

from app.providers.base import OutgoingMessage, SendResult, http_result

_TIMEOUT = httpx.Timeout(10.0)


class SmtpEmailProvider:
    name = "smtp"

    def __init__(self, host: str, port: int, username: str, password: str, starttls: bool, sender: str) -> None:
        self.host, self.port, self.username, self.password = host, port, username, password
        self.starttls, self.sender = starttls, sender

    def _send_sync(self, message: OutgoingMessage) -> None:
        email = EmailMessage()
        email["From"] = self.sender
        email["To"] = message.recipient
        email["Subject"] = f"[{message.severity.upper()}] {message.title}"
        text = message.body + (f"\n\n{message.url}" if message.url else "")
        email.set_content(text)
        with smtplib.SMTP(self.host, self.port, timeout=15) as smtp:
            if self.starttls:
                smtp.starttls()
            if self.username:
                smtp.login(self.username, self.password)
            smtp.send_message(email)

    async def send(self, message: OutgoingMessage) -> SendResult:
        try:
            await asyncio.to_thread(self._send_sync, message)
            return SendResult(ok=True, provider=self.name, response={"delivered": True})
        except smtplib.SMTPRecipientsRefused as exc:
            return SendResult(ok=False, provider=self.name, response={"error": str(exc)}, retryable=False)
        except (smtplib.SMTPException, OSError) as exc:
            return SendResult(ok=False, provider=self.name, response={"error": str(exc)}, retryable=True)


class TwilioProvider:
    """Twilio Programmable Messaging; `whatsapp=True` addresses the WhatsApp channel."""

    def __init__(self, account_sid: str, auth_token: str, sender: str, whatsapp: bool = False) -> None:
        self.account_sid, self.auth_token, self.whatsapp = account_sid, auth_token, whatsapp
        self.sender = f"whatsapp:{sender}" if whatsapp and not sender.startswith("whatsapp:") else sender
        self.name = "twilio-whatsapp" if whatsapp else "twilio-sms"

    async def send(self, message: OutgoingMessage) -> SendResult:
        to = f"whatsapp:{message.recipient}" if self.whatsapp else message.recipient
        text = f"{message.title}\n{message.body}"[:1500]
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Messages.json"
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(
                    url, data={"From": self.sender, "To": to, "Body": text}, auth=(self.account_sid, self.auth_token)
                )
            body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text
            if isinstance(body, dict):
                body = {k: body.get(k) for k in ("sid", "status", "code", "message") if k in body}
            return http_result(self.name, resp.status_code, body)
        except httpx.HTTPError as exc:
            return SendResult(ok=False, provider=self.name, response={"error": str(exc)}, retryable=True)


class FcmProvider:
    """Firebase Cloud Messaging HTTP v1, authenticated with a service-account JWT.
    The recipient is a device registration token."""

    name = "fcm"
    SCOPE = "https://www.googleapis.com/auth/firebase.messaging"

    def __init__(self, service_account_file: str) -> None:
        with open(service_account_file, encoding="utf-8") as fh:
            self._account = json.load(fh)
        self._token: str | None = None
        self._token_expiry = 0.0

    async def _access_token(self, client: httpx.AsyncClient) -> str:
        if self._token and time.time() < self._token_expiry - 60:
            return self._token
        now = int(time.time())
        assertion = jwt.encode(
            {
                "iss": self._account["client_email"],
                "scope": self.SCOPE,
                "aud": self._account["token_uri"],
                "iat": now,
                "exp": now + 3600,
            },
            self._account["private_key"],
            algorithm="RS256",
        )
        resp = await client.post(
            self._account["token_uri"],
            data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
        )
        resp.raise_for_status()
        payload = resp.json()
        self._token, self._token_expiry = payload["access_token"], now + int(payload.get("expires_in", 3600))
        return self._token

    async def send(self, message: OutgoingMessage) -> SendResult:
        project = self._account["project_id"]
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                token = await self._access_token(client)
                resp = await client.post(
                    f"https://fcm.googleapis.com/v1/projects/{project}/messages:send",
                    headers={"Authorization": f"Bearer {token}"},
                    json={
                        "message": {
                            "token": message.recipient,
                            "notification": {"title": message.title, "body": message.body},
                            "data": {k: str(v) for k, v in {**message.data, "url": message.url or ""}.items()},
                            "android": {"priority": "high"},
                            "apns": {"headers": {"apns-priority": "10"}},
                        }
                    },
                )
            return http_result(self.name, resp.status_code, resp.json() if resp.content else {})
        except httpx.HTTPError as exc:
            return SendResult(ok=False, provider=self.name, response={"error": str(exc)}, retryable=True)


def sign_body(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


class WebhookProvider:
    """POSTs a JSON envelope to a URL. Used for push gateways and for public-address,
    signage or radio systems that accept HTTP triggers."""

    def __init__(self, url: str, secret: str, channel: str) -> None:
        self.url, self.secret = url, secret
        self.name = f"webhook:{channel}"

    async def send(self, message: OutgoingMessage) -> SendResult:
        body = json.dumps(
            {
                "channel": message.channel,
                "recipient": message.recipient,
                "title": message.title,
                "body": message.body,
                "severity": message.severity,
                "url": message.url,
                "data": message.data,
            }
        ).encode()
        headers = {"Content-Type": "application/json"}
        if self.secret:
            headers["X-CCD-Signature"] = sign_body(self.secret, body)
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(self.url, content=body, headers=headers)
            return http_result(self.name, resp.status_code, resp.text[:500])
        except httpx.HTTPError as exc:
            return SendResult(ok=False, provider=self.name, response={"error": str(exc)}, retryable=True)
