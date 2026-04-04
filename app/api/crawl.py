from __future__ import annotations
import asyncio
import json
from fastapi import APIRouter, BackgroundTasks, Request, WebSocket
from fastapi.responses import JSONResponse

router = APIRouter(tags=["crawl"])

@router.post("/api/run")
async def run_now(
    background_tasks: BackgroundTasks,
    request: Request,
) -> JSONResponse:
    service = request.app.state.service
    if service.lock.locked():
        return JSONResponse({"status": "busy"})
    background_tasks.add_task(service.run_crawl)
    return JSONResponse({"status": "queued"})

@router.websocket("/ws/crawl")
async def crawl_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    service = websocket.app.state.service
    queue: asyncio.Queue[dict] = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def on_event(event: dict) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, event)

    service.add_progress_callback(on_event)
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30)
                await websocket.send_text(json.dumps(event))
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"type": "ping"}))
    except Exception:
        pass
    finally:
        service.remove_progress_callback(on_event)
