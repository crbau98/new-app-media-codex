from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/images", tags=["images"])


@router.get("")
def images(
    theme: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=40, ge=1, le=200),
) -> JSONResponse:
    from app.main import db, service
    return JSONResponse(service.serialize_images(db.get_recent_images(limit=limit, theme=theme, offset=offset)))


browse_router = APIRouter(prefix="/api/browse", tags=["images"])


@browse_router.get("/images")
def browse_images(
    theme: str | None = Query(default=None),
    source_type: str | None = Query(default=None),
    search: str = Query(default=""),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=40, ge=1, le=200),
) -> JSONResponse:
    from app.main import db, service
    payload = db.browse_images(
        limit=limit,
        offset=offset,
        theme=theme,
        source_type=source_type,
        search=search,
    )
    payload["images"] = service.serialize_images(payload["images"])
    return JSONResponse(payload)
