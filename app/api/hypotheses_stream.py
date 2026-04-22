from __future__ import annotations
import json
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from app.config import settings
from app.ai import stream_hypothesis

router = APIRouter(prefix="/api/hypotheses", tags=["hypotheses"])

@router.get("/stream")
def hypothesis_stream(theme: str | None = Query(default=None)) -> StreamingResponse:
    from app.main import db
    items = db.get_recent_items(limit=20, theme=theme)

    def event_stream():
        for chunk in stream_hypothesis(settings, items):
            yield f"data: {json.dumps(chunk)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
