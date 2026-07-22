"""Liveness vs readiness, split properly (blueprint sections 5 and 12):

- ``/api/v1/healthz`` — process is alive. No dependencies touched; if this
  fails, the orchestrator restarts the container.
- ``/api/v1/readyz`` — the pod may receive traffic: db ping, outbox backlog
  within budget, disk headroom. Fails -> removed from rotation, NOT restarted.
"""

from __future__ import annotations

import asyncio
import shutil
import sqlite3

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.api.deps import get_connection, get_outbox_store, get_settings
from app.core.settings import CoreSettings
from app.repositories.outbox import SqliteOutboxStore

router = APIRouter(tags=["health"])

_DISK_LOW_WATERMARK = 0.95
_OUTBOX_LAG_BUDGET = 1000


@router.get("/healthz")
def liveness() -> dict:
    return {"status": "ok"}


@router.get("/readyz")
async def readiness(
    conn: sqlite3.Connection = Depends(get_connection),
    outbox: SqliteOutboxStore = Depends(get_outbox_store),
    settings: CoreSettings = Depends(get_settings),
) -> JSONResponse:
    checks: dict[str, str] = {}

    def _db_ping() -> bool:
        try:
            conn.execute("SELECT 1").fetchone()
            return True
        except sqlite3.Error:
            return False

    db_ok = await asyncio.to_thread(_db_ping)
    checks["database"] = "ok" if db_ok else "error"

    pending = await asyncio.to_thread(outbox.pending_count) if db_ok else -1
    checks["outbox"] = "ok" if 0 <= pending < _OUTBOX_LAG_BUDGET else "lagging"

    try:
        usage = shutil.disk_usage(str(settings.database_path.parent))
        disk_ok = usage.free / usage.total > (1 - _DISK_LOW_WATERMARK)
        checks["disk"] = "ok" if disk_ok else "low"
    except OSError:
        checks["disk"] = "unknown"

    ready = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ready" if ready else "not_ready", "checks": checks},
    )
