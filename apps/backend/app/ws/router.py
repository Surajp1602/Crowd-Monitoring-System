"""WebSocket gateway.

`/ws/live` protocol (JSON text frames):

    client -> {"action": "auth", "token": "<access token>"}        first message, within 10s
    server -> {"type": "ready", "data": {"role": ..., "is_guest": ...}}
    client -> {"action": "subscribe", "topics": ["cameras", "floor:<id>"]}
    server -> {"type": "subscribed", "data": {"accepted": [...], "rejected": {"topic": "reason"}}}
    client -> {"action": "unsubscribe", "topics": [...]}
    client -> {"action": "auth", "token": "<refreshed token>"}    any time, extends the session
    client -> {"action": "ping"}  /  server -> {"type": "pong"}

The token travels in the first message rather than the URL so it never lands in
proxy or access logs. When the token expires the server sends `auth.expired` and
closes with code 4401; the client refreshes and reconnects.
"""

import asyncio
import logging
import time

import orjson
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.security import decode_token
from app.deps import CurrentUser, user_from_token_payload
from app.ws.bridge import latest_snapshot_for
from app.ws.connections import Client, connections

logger = logging.getLogger("ccd.ws")
router = APIRouter(tags=["websocket"])

AUTH_TIMEOUT_S = 10.0
CLOSE_UNAUTHORIZED = 4401
CLOSE_POLICY = 4403


@router.websocket("/ws/status")
async def websocket_status(websocket: WebSocket):
    """Unauthenticated connectivity check."""
    await websocket.accept()
    try:
        await websocket.send_json({"type": "connected", "message": "Crowd Density Platform WS gateway"})
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        return


def _authenticate(token: str | None) -> tuple[CurrentUser, float] | None:
    if not token:
        return None
    try:
        payload = decode_token(token)
    except ValueError:
        return None
    if payload.get("type") != "access":
        return None
    return user_from_token_payload(payload), float(payload.get("exp", time.time()))


async def _send(websocket: WebSocket, kind: str, data: dict | None = None) -> None:
    await websocket.send_text(orjson.dumps({"type": kind, "data": data or {}}).decode())


async def _sender(client: Client) -> None:
    while True:
        text = await client.queue.get()
        if client.expired:
            await _send(client.websocket, "auth.expired")
            await client.websocket.close(code=CLOSE_UNAUTHORIZED)
            return
        await client.websocket.send_text(text)


async def _expiry_watch(client: Client) -> None:
    """Re-reads `expires_at` every lap, so a mid-session token refresh just extends it."""
    while True:
        await asyncio.sleep(max(1.0, client.expires_at - time.time()))
        if client.expired:
            await _send(client.websocket, "auth.expired")
            await client.websocket.close(code=CLOSE_UNAUTHORIZED)
            return


@router.websocket("/ws/live")
async def websocket_live(websocket: WebSocket):
    await websocket.accept()
    try:
        first = await asyncio.wait_for(websocket.receive_text(), timeout=AUTH_TIMEOUT_S)
        message = orjson.loads(first)
    except (asyncio.TimeoutError, orjson.JSONDecodeError, WebSocketDisconnect):
        await websocket.close(code=CLOSE_UNAUTHORIZED)
        return

    auth = _authenticate(message.get("token")) if message.get("action") == "auth" else None
    if auth is None:
        await _send(websocket, "error", {"message": "authentication required"})
        await websocket.close(code=CLOSE_UNAUTHORIZED)
        return

    user, expires_at = auth
    client = Client(websocket=websocket, user=user, expires_at=expires_at)
    connections.register(client)
    await _send(websocket, "ready", {"role": user.role, "is_guest": user.is_guest})

    sender = asyncio.create_task(_sender(client))
    watcher = asyncio.create_task(_expiry_watch(client))
    try:
        while True:
            receive = asyncio.create_task(websocket.receive_text())
            done, _ = await asyncio.wait({receive, sender, watcher}, return_when=asyncio.FIRST_COMPLETED)
            if receive not in done:
                receive.cancel()
                break
            await _handle(client, receive.result())
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 - one bad client must never take the gateway down
        logger.exception("WebSocket client loop failed")
    finally:
        sender.cancel()
        watcher.cancel()
        connections.unregister(client)


async def _handle(client: Client, text: str) -> None:
    try:
        message = orjson.loads(text)
    except orjson.JSONDecodeError:
        await _send(client.websocket, "error", {"message": "invalid JSON"})
        return
    action = message.get("action")

    if action == "ping":
        await _send(client.websocket, "pong")
    elif action == "subscribe":
        accepted, rejected = [], {}
        for topic in message.get("topics", [])[:50]:
            ok, reason = connections.subscribe(client, str(topic))
            if ok:
                accepted.append(topic)
            else:
                rejected[topic] = reason
        await _send(client.websocket, "subscribed", {"accepted": accepted, "rejected": rejected})
        for topic in accepted:
            snapshot = await latest_snapshot_for(topic)
            if snapshot:
                client.offer(snapshot)
    elif action == "unsubscribe":
        for topic in message.get("topics", []):
            connections.unsubscribe(client, str(topic))
        await _send(client.websocket, "unsubscribed", {"topics": message.get("topics", [])})
    elif action == "auth":
        auth = _authenticate(message.get("token"))
        if auth is None or auth[0].is_guest != client.user.is_guest:
            await _send(client.websocket, "error", {"message": "invalid token"})
            return
        client.user, client.expires_at = auth
        # Permissions may have changed with the new token: drop topics it no longer allows.
        for topic in list(client.topics):
            connections.unsubscribe(client, topic)
            connections.subscribe(client, topic)
        await _send(client.websocket, "ready", {"role": client.user.role, "is_guest": client.user.is_guest})
    else:
        await _send(client.websocket, "error", {"message": f"unknown action {action!r}"})
