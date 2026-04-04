from __future__ import annotations

import json

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("")
async def get_settings(request: Request):
    db = request.app.state.db
    return db.get_all_settings()


@router.put("")
async def update_settings(request: Request):
    db = request.app.state.db
    body = await request.json()
    for key, value in body.items():
        db.set_setting(key, json.dumps(value))
    return {"ok": True}


@router.delete("/cache")
async def clear_cache(request: Request):
    db = request.app.state.db
    with db.connect() as conn:
        result = conn.execute("DELETE FROM compound_cache")
        count = result.rowcount
        conn.commit()
    return {"ok": True, "deleted": count}


@router.put("/reset")
async def reset_settings(request: Request):
    db = request.app.state.db
    with db.connect() as conn:
        conn.execute("DELETE FROM user_settings")
        conn.commit()
    return {"ok": True}
