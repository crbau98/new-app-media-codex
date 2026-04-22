from __future__ import annotations

import json
import re

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

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


# ── Theme CRUD (3.5) ─────────────────────────────────────────────────────────

_SLUG_RE = re.compile(r"^[a-z0-9_-]{1,64}$")


class ThemeCreateBody(BaseModel):
    slug: str
    label: str
    queries: list[str] = []


class ThemeUpdateBody(BaseModel):
    label: str | None = None
    queries: list[str] | None = None


def _ensure_theme_queries_table(db) -> None:
    """Create theme_queries table if it doesn't exist (lazy migration)."""
    with db.connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS theme_queries (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                slug    TEXT NOT NULL REFERENCES themes(slug) ON DELETE CASCADE,
                query   TEXT NOT NULL,
                UNIQUE(slug, query)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_theme_queries_slug ON theme_queries(slug)")
        conn.commit()


def _list_themes_with_queries(db) -> list[dict]:
    _ensure_theme_queries_table(db)
    with db.connect() as conn:
        themes = conn.execute("SELECT slug, label FROM themes ORDER BY label").fetchall()
        queries = conn.execute("SELECT slug, query FROM theme_queries ORDER BY id").fetchall()
    by_slug: dict[str, list[str]] = {}
    for q in queries:
        by_slug.setdefault(q["slug"], []).append(q["query"])
    return [
        {"slug": t["slug"], "label": t["label"], "queries": by_slug.get(t["slug"], [])}
        for t in themes
    ]


@router.get("/themes")
async def list_themes(request: Request):
    db = request.app.state.db
    return _list_themes_with_queries(db)


@router.post("/themes")
async def create_theme(body: ThemeCreateBody, request: Request):
    db = request.app.state.db
    if not _SLUG_RE.match(body.slug):
        raise HTTPException(status_code=422, detail="slug must be 1-64 lowercase alphanumeric/dash/underscore characters")
    _ensure_theme_queries_table(db)
    with db.connect() as conn:
        existing = conn.execute("SELECT slug FROM themes WHERE slug = ?", (body.slug,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail=f"Theme '{body.slug}' already exists")
        conn.execute("INSERT INTO themes (slug, label) VALUES (?, ?)", (body.slug, body.label))
        for q in body.queries:
            if q.strip():
                conn.execute(
                    "INSERT OR IGNORE INTO theme_queries (slug, query) VALUES (?, ?)",
                    (body.slug, q.strip()),
                )
        conn.commit()
    db._invalidate_after_write()
    return {"slug": body.slug, "label": body.label, "queries": body.queries}


@router.put("/themes/{slug}")
async def update_theme(slug: str, body: ThemeUpdateBody, request: Request):
    db = request.app.state.db
    _ensure_theme_queries_table(db)
    with db.connect() as conn:
        existing = conn.execute("SELECT slug FROM themes WHERE slug = ?", (slug,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail=f"Theme '{slug}' not found")
        if body.label is not None:
            conn.execute("UPDATE themes SET label = ? WHERE slug = ?", (body.label, slug))
        if body.queries is not None:
            conn.execute("DELETE FROM theme_queries WHERE slug = ?", (slug,))
            for q in body.queries:
                if q.strip():
                    conn.execute(
                        "INSERT OR IGNORE INTO theme_queries (slug, query) VALUES (?, ?)",
                        (slug, q.strip()),
                    )
        conn.commit()
    db._invalidate_after_write()
    updated = next(
        (t for t in _list_themes_with_queries(db) if t["slug"] == slug), None
    )
    return updated or {"slug": slug}


@router.delete("/themes/{slug}")
async def delete_theme(slug: str, request: Request):
    db = request.app.state.db
    deleted = db.delete_theme(slug)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Theme '{slug}' not found")
    return {"ok": True, "deleted": slug}

