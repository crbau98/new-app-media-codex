from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/api", tags=["notifications"])
_logger = logging.getLogger(__name__)

_DEFAULT_USER = "default"


class NotificationConnectionManager:
    """Keeps active WebSocket connections per user_id."""

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, user_id: str) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.setdefault(user_id, set()).add(websocket)

    async def disconnect(self, websocket: WebSocket, user_id: str) -> None:
        async with self._lock:
            conns = self._connections.get(user_id, set())
            conns.discard(websocket)
            if not conns:
                self._connections.pop(user_id, None)

    async def send_to_user(self, user_id: str, message: dict) -> None:
        async with self._lock:
            conns = list(self._connections.get(user_id, set()))
        dead: list[tuple[str, WebSocket]] = []
        for ws in conns:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append((user_id, ws))
        for uid, ws in dead:
            async with self._lock:
                self._connections.get(uid, set()).discard(ws)


notification_manager = NotificationConnectionManager()


@router.websocket("/ws/notifications")
async def ws_notifications(websocket: WebSocket) -> None:
    user_id = _DEFAULT_USER
    await notification_manager.connect(websocket, user_id)
    try:
        db = websocket.app.state.db
        count = db.get_unread_notification_count(user_id)
        await websocket.send_json({"type": "unread_count", "count": count})

        while True:
            data = await websocket.receive_text()
            if data.strip() == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        _logger.debug("ws_notifications error: %s", exc)
    finally:
        await notification_manager.disconnect(websocket, user_id)


@router.get("/notifications")
def list_notifications(
    request: Request,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict:
    db = request.app.state.db
    return db.get_notifications(_DEFAULT_USER, limit=limit, offset=offset)


@router.post("/notifications/{notification_id}/read")
def mark_read(notification_id: int, request: Request) -> dict:
    db = request.app.state.db
    ok = db.mark_notification_read(notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all_read(request: Request) -> dict:
    db = request.app.state.db
    marked = db.mark_all_notifications_read(_DEFAULT_USER)
    return {"ok": True, "marked": marked}


@router.get("/notifications/unread-count")
def unread_count(request: Request) -> dict:
    db = request.app.state.db
    return {"count": db.get_unread_notification_count(_DEFAULT_USER)}


@router.delete("/notifications/{notification_id}")
def delete_notification(notification_id: int, request: Request) -> dict:
    db = request.app.state.db
    ok = db.delete_notification(notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}
