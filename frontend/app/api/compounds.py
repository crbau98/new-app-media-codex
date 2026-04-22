from __future__ import annotations
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/compounds", tags=["compounds"])

def get_or_fetch(db, name: str) -> dict:
    import requests
    from app.sources.pubchem import lookup_compound

    cached = db.get_compound_cache(name)
    if cached:
        return cached
    session = requests.Session()
    data = lookup_compound(session, name)
    if data:
        try:
            db.set_compound_cache(name, data)
        except Exception:
            pass  # cache write failure is non-fatal
    return data

@router.get("/{name}")
def compound_detail(name: str, request: Request) -> JSONResponse:
    db = request.app.state.db
    return JSONResponse(get_or_fetch(db, name))
