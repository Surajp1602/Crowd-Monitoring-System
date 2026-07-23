"""WebSocket gateway.

Phase 1 ships a minimal connectivity check endpoint so the app is fully
runnable end-to-end. Phase 4 replaces/extends this with the real Redis
pub/sub bridge that fans out live detections, tracks, heatmap frames,
alerts, and camera status to connected dashboard clients.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/status")
async def websocket_status(websocket: WebSocket):
    await websocket.accept()
    try:
        await websocket.send_json({"type": "connected", "message": "Crowd Density Platform WS gateway"})
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        return
