from __future__ import annotations
from fastapi import APIRouter, HTTPException, Depends
from app.security import require_admin
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/themes", tags=["themes"])


class ThemeCreate(BaseModel):
    slug: str
    label: str


@router.get("")
def list_themes() -> JSONResponse:
    from app.main import db
    return JSONResponse(db.get_themes())


@router.post("", dependencies=[Depends(require_admin)])
def create_theme(payload: ThemeCreate) -> JSONResponse:
    from app.main import db
    theme = db.create_theme(payload.slug, payload.label)
    return JSONResponse(theme)


@router.delete("/{slug}", dependencies=[Depends(require_admin)])
def delete_theme(slug: str) -> JSONResponse:
    from app.main import db
    ok = db.delete_theme(slug)
    if not ok:
        raise HTTPException(status_code=404, detail="Theme not found")
    return JSONResponse({"ok": True})
