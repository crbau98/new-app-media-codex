from __future__ import annotations

import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api", tags=["recommendations"])


@router.get("/recommendations")
def get_recommendations(request: Request) -> JSONResponse:
    """Return up to 5 recommended items based on compound/mechanism overlap with saved items."""
    db = request.app.state.db

    with db.connect() as conn:
        # 1. Get compounds and mechanisms from saved/promoted items
        saved_rows = conn.execute(
            "SELECT compounds_json, mechanisms_json FROM items WHERE is_saved = 1"
        ).fetchall()

        if not saved_rows:
            return JSONResponse({"items": [], "reason": "no_saved_items"})

        saved_compounds: set[str] = set()
        saved_mechanisms: set[str] = set()
        for row in saved_rows:
            for c in json.loads(row["compounds_json"] or "[]"):
                if c:
                    saved_compounds.add(c)
            for m in json.loads(row["mechanisms_json"] or "[]"):
                if m:
                    saved_mechanisms.add(m)

        if not saved_compounds and not saved_mechanisms:
            return JSONResponse({"items": [], "reason": "no_signals"})

        # 2. Get unreviewed items (not saved, not shortlisted or archived)
        candidates = conn.execute(
            """SELECT id, title, url, summary, source_type, theme, score,
                      compounds_json, mechanisms_json, first_seen_at
               FROM items
               WHERE is_saved = 0
                 AND review_status IN ('new', 'reviewing')
            """
        ).fetchall()

        # 3. Score each candidate by overlap count
        scored: list[tuple[dict, int, list[str], list[str]]] = []
        for row in candidates:
            compounds = json.loads(row["compounds_json"] or "[]")
            mechanisms = json.loads(row["mechanisms_json"] or "[]")

            overlapping_compounds = [c for c in compounds if c in saved_compounds]
            overlapping_mechanisms = [m for m in mechanisms if m in saved_mechanisms]
            overlap_count = len(overlapping_compounds) + len(overlapping_mechanisms)

            if overlap_count > 0:
                scored.append((
                    dict(row),
                    overlap_count,
                    overlapping_compounds,
                    overlapping_mechanisms,
                ))

        # 4. Sort by overlap count DESC, then score DESC
        scored.sort(key=lambda x: (x[1], x[0].get("score", 0)), reverse=True)

        # 5. Return top 5
        results = []
        for row_dict, overlap_count, oc, om in scored[:5]:
            results.append({
                "id": row_dict["id"],
                "title": row_dict["title"],
                "url": row_dict["url"],
                "summary": row_dict["summary"],
                "source_type": row_dict["source_type"],
                "theme": row_dict["theme"],
                "score": row_dict["score"],
                "overlap_count": overlap_count,
                "overlapping_compounds": oc,
                "overlapping_mechanisms": om,
            })

        return JSONResponse({"items": results, "reason": "ok"})
