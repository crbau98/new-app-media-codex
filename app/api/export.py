from __future__ import annotations
import csv
import io
import json

from fastapi import APIRouter, Query
from fastapi.responses import Response

router = APIRouter(prefix="/api/export", tags=["export"])


def _query_params(theme, source_type, review_status, saved_only, search, sort, compound, mechanism):
    return dict(
        limit=5000, offset=0, theme=theme, source_type=source_type,
        review_status=review_status, saved_only=saved_only,
        search=search, sort=sort, compound=compound, mechanism=mechanism,
    )


@router.get("/items.csv")
def export_items_csv(
    theme: str | None = Query(default=None),
    source_type: str | None = Query(default=None),
    review_status: str | None = Query(default=None),
    saved_only: bool = Query(default=False),
    search: str = Query(default=""),
    sort: str = Query(default="newest"),
    compound: str | None = Query(default=None),
    mechanism: str | None = Query(default=None),
) -> Response:
    from app.main import db
    result = db.browse_items(**_query_params(theme, source_type, review_status, saved_only, search, sort, compound, mechanism))
    items = result["items"]
    if not items:
        return Response(content="", media_type="text/csv")
    fields = ["id", "title", "url", "author", "published_at", "source_type", "theme", "score", "review_status", "is_saved", "compounds", "mechanisms", "summary"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    for item in items:
        row = {k: item.get(k, "") for k in fields}
        row["compounds"] = "; ".join(item.get("compounds") or [])
        row["mechanisms"] = "; ".join(item.get("mechanisms") or [])
        w.writerow(row)
    return Response(content=buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=items.csv"})


@router.get("/items.json")
def export_items_json(
    theme: str | None = Query(default=None),
    source_type: str | None = Query(default=None),
    review_status: str | None = Query(default=None),
    saved_only: bool = Query(default=False),
    search: str = Query(default=""),
    sort: str = Query(default="newest"),
    compound: str | None = Query(default=None),
    mechanism: str | None = Query(default=None),
) -> Response:
    from app.main import db
    result = db.browse_items(**_query_params(theme, source_type, review_status, saved_only, search, sort, compound, mechanism))
    return Response(content=json.dumps(result["items"], default=str), media_type="application/json", headers={"Content-Disposition": "attachment; filename=items.json"})
