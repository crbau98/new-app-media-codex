from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.get("")
def runs(limit: int = Query(default=12, ge=1, le=100)) -> JSONResponse:
    from app.main import db
    return JSONResponse(db.get_recent_runs(limit=limit))


@router.get("/{run_id}")
def run_detail(run_id: int) -> JSONResponse:
    from app.main import db
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return JSONResponse(run)
