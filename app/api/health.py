from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(tags=["health"])


@router.get("/api/source-health")
async def source_health(request: Request) -> JSONResponse:
    """Return scraping health metrics for all configured sources."""
    service = request.app.state.service
    payload = {"sources": service.source_health_snapshot()}
    return JSONResponse(payload)
