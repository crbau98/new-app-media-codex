# Creators Capture Queue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace fire-and-forget performer captures with a persistent queue, auto-enqueue on every add, show live progress in a bottom panel, and add bulk-capture tooling.

**Architecture:** A `capture_queue` SQLite table tracks every capture job. A daemon thread in `service.py` pops the oldest `queued` entry and calls `_run_performer_capture`, one at a time. Every code path that adds a performer auto-enqueues. The frontend polls `/api/performers/capture-queue` and renders a live bottom panel.

**Tech Stack:** FastAPI, SQLite (via `app/db.py`), Python threading, React 19, TanStack Query v5, TypeScript/Tailwind

**Key constraint:** Every `.tsx` edit MUST also be applied to the sibling `.js` file at the same path. Vite dev server resolves `.js` before `.tsx`, so both must stay in sync.

---

### Task 1: DB — capture_queue table + methods

**Files:**
- Modify: `app/db.py` — `SCHEMA` constant (add table) + `_migrate` method + 5 new methods

**Step 1: Add table to SCHEMA string**

Find the line in `SCHEMA` (around line 269) that defines `performer_links`. After the `performer_links` block, add:

```python
CREATE TABLE IF NOT EXISTS capture_queue (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    performer_id   INTEGER NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
    status         TEXT NOT NULL DEFAULT 'queued',
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    started_at     TEXT,
    finished_at    TEXT,
    captured_count INTEGER NOT NULL DEFAULT 0,
    error_msg      TEXT
);
CREATE INDEX IF NOT EXISTS idx_capture_queue_status    ON capture_queue(status);
CREATE INDEX IF NOT EXISTS idx_capture_queue_performer ON capture_queue(performer_id);
```

**Step 2: Add migration in `_migrate`**

After the last block in `_migrate` (around line 395), add:

```python
        # capture_queue table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS capture_queue (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                performer_id   INTEGER NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
                status         TEXT NOT NULL DEFAULT 'queued',
                created_at     TEXT NOT NULL DEFAULT (datetime('now')),
                started_at     TEXT,
                finished_at    TEXT,
                captured_count INTEGER NOT NULL DEFAULT 0,
                error_msg      TEXT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_capture_queue_status ON capture_queue(status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_capture_queue_performer ON capture_queue(performer_id)")
```

**Step 3: Add DB methods**

After `delete_performer_link` (around line 2124), add these five methods:

```python
    def enqueue_capture(self, performer_id: int) -> dict | None:
        """Add to capture queue. Returns None if already queued/running."""
        with self.connect() as conn:
            existing = conn.execute(
                "SELECT id FROM capture_queue WHERE performer_id = ? AND status IN ('queued', 'running')",
                (performer_id,),
            ).fetchone()
            if existing:
                return None
            cursor = conn.execute(
                "INSERT INTO capture_queue (performer_id, status) VALUES (?, 'queued')",
                (performer_id,),
            )
            conn.commit()
            row = conn.execute(
                """SELECT cq.*, p.username, p.display_name, p.platform, p.avatar_local, p.avatar_url
                   FROM capture_queue cq JOIN performers p ON cq.performer_id = p.id
                   WHERE cq.id = ?""",
                (cursor.lastrowid,),
            ).fetchone()
        return dict(row) if row else None

    def get_capture_queue(self) -> list[dict]:
        """Active entries plus anything finished in the last 5 minutes."""
        with self.connect() as conn:
            rows = conn.execute(
                """SELECT cq.*, p.username, p.display_name, p.platform, p.avatar_local, p.avatar_url
                   FROM capture_queue cq JOIN performers p ON cq.performer_id = p.id
                   WHERE cq.status IN ('queued', 'running')
                      OR cq.finished_at > datetime('now', '-5 minutes')
                   ORDER BY cq.created_at ASC"""
            ).fetchall()
        return [dict(r) for r in rows]

    def update_queue_entry(self, entry_id: int, **fields: Any) -> None:
        sets = ", ".join(f"{k} = ?" for k in fields)
        vals = list(fields.values()) + [entry_id]
        with self.connect() as conn:
            conn.execute(f"UPDATE capture_queue SET {sets} WHERE id = ?", vals)
            conn.commit()

    def cancel_queue_entry(self, entry_id: int) -> bool:
        with self.connect() as conn:
            result = conn.execute(
                "DELETE FROM capture_queue WHERE id = ? AND status = 'queued'",
                (entry_id,),
            )
            conn.commit()
        return result.rowcount > 0

    def get_stale_performer_ids(self, stale_days: int = 7) -> list[int]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT id FROM performers WHERE status != 'inactive' "
                "AND (last_checked_at IS NULL OR last_checked_at < datetime('now', ?))",
                (f"-{stale_days} days",),
            ).fetchall()
        return [r["id"] for r in rows]
```

**Step 4: Verify the app starts without errors**

```bash
cd "/Users/chasebauman/Documents/App research codex"
python -c "from app.db import Database; db = Database('test_tmp.db'); db.init(); print('ok')"
rm test_tmp.db
```
Expected: `ok`

**Step 5: Commit**

```bash
git add app/db.py
git commit -m "feat: capture_queue DB table + enqueue/poll/cancel/stale methods"
```

---

### Task 2: Queue worker thread in service.py

**Files:**
- Modify: `app/service.py`

**Step 1: Add imports at top of file**

After `from threading import Lock` (line 6), add:

```python
import threading
import time
```

**Step 2: Add `_utcnow` helper at module level**

After `item_snapshot` function (around line 48):

```python
def _utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
```

**Step 3: Add `_run_queue_worker` function**

After `_utcnow`, add:

```python
def _run_queue_worker(app_state: Any, stop_event: threading.Event) -> None:
    """Daemon thread: process capture_queue one entry at a time."""
    from app.api.performers import _run_performer_capture
    db = app_state.db
    while not stop_event.is_set():
        with db.connect() as conn:
            row = conn.execute(
                """SELECT cq.id, cq.performer_id, p.username, p.display_name, p.platform
                   FROM capture_queue cq JOIN performers p ON cq.performer_id = p.id
                   WHERE cq.status = 'queued'
                   ORDER BY cq.created_at ASC LIMIT 1"""
            ).fetchone()
        if not row:
            stop_event.wait(2)
            continue
        entry_id = row["id"]
        performer_id = row["performer_id"]
        db.update_queue_entry(entry_id, status="running", started_at=_utcnow())
        try:
            captured = _run_performer_capture(
                app_state,
                performer_id,
                row["username"],
                row["platform"],
                row.get("display_name") or None,
            )
            db.update_queue_entry(
                entry_id,
                status="done",
                finished_at=_utcnow(),
                captured_count=captured,
            )
        except Exception as exc:
            print(f"[queue-worker] error for performer {performer_id}: {exc}")
            db.update_queue_entry(
                entry_id,
                status="failed",
                finished_at=_utcnow(),
                error_msg=str(exc)[:200],
            )
```

**Step 4: Add `_queue_stop_event` attribute and start/stop worker in `ResearchService`**

In `ResearchService.__init__` (around line 68), after `self._callbacks_lock = Lock()`, add:

```python
        self._queue_stop_event = threading.Event()
        self._queue_thread: threading.Thread | None = None
```

In `ResearchService.start()`, after `self.scheduler.start()` (around line 195), add:

```python
        # Start capture queue worker
        self._queue_stop_event.clear()
        self._queue_thread = threading.Thread(
            target=_run_queue_worker,
            args=(self, self._queue_stop_event),
            daemon=True,
            name="capture-queue-worker",
        )
        self._queue_thread.start()
```

In `ResearchService.stop()` (around line 198), after `self.scheduler.shutdown(wait=False)`, add:

```python
        self._queue_stop_event.set()
```

**Step 5: Verify the service starts without import errors**

```bash
cd "/Users/chasebauman/Documents/App research codex"
python -c "from app.service import ResearchService; print('ok')"
```
Expected: `ok`

**Step 6: Commit**

```bash
git add app/service.py
git commit -m "feat: capture queue worker thread — processes one performer at a time"
```

---

### Task 3: Auto-enqueue on add + update capture endpoints to use queue

**Files:**
- Modify: `app/api/performers.py`

**Step 1: Auto-enqueue in `add_performer` endpoint**

Find the `add_performer` endpoint (around line 318). After `return performer`, change to:

```python
    try:
        performer = db.add_performer(
            username=body.username,
            platform=body.platform,
            display_name=body.display_name,
            profile_url=body.profile_url,
            bio=body.bio,
            tags=body.tags,
            avatar_url=body.avatar_url,
            discovered_via=body.discovered_via,
        )
        db.enqueue_capture(performer["id"])
        return performer
    except Exception as e:
        raise HTTPException(400, detail=str(e))
```

**Step 2: Auto-enqueue in `import_from_url`**

Find `import_from_url` (around line 230). After `return performer`, change to:

```python
    performer = db.add_performer(
        username=username,
        platform=platform,
        profile_url=body.url,
        discovered_via="url_import",
    )
    db.enqueue_capture(performer["id"])
    return performer
```

**Step 3: Auto-enqueue in `bulk_import`**

Find `bulk_import` (around line 254). After `created_performers.append(performer)`, add `db.enqueue_capture(performer["id"])`:

```python
        try:
            performer = db.add_performer(
                username=username,
                platform=body.platform,
                discovered_via="bulk_import",
            )
            db.enqueue_capture(performer["id"])
            created_performers.append(performer)
            created_count += 1
        except Exception:
            skipped_count += 1
```

**Step 4: Update `capture_performer_content` to use queue**

Replace the entire `capture_performer_content` endpoint (around line 792) with:

```python
@router.post("/{performer_id}/capture")
def capture_performer_content(performer_id: int, request: Request):
    """Enqueue a targeted capture for a specific performer."""
    db = request.app.state.db
    performer = db.get_performer(performer_id)
    if not performer:
        raise HTTPException(404, detail="Performer not found")
    entry = db.enqueue_capture(performer_id)
    if entry is None:
        return {"status": "already_queued", "performer_id": performer_id}
    return {"status": "queued", "performer_id": performer_id}
```

**Step 5: Update `capture_all_performers` to use queue**

Replace the entire `capture_all_performers` endpoint (around line 825) with:

```python
@router.post("/capture-all")
def capture_all_performers(request: Request):
    """Enqueue capture for ALL active performers."""
    db = request.app.state.db
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id FROM performers WHERE status != 'inactive' "
            "ORDER BY last_checked_at ASC NULLS FIRST"
        ).fetchall()
    queued = sum(1 for r in rows if db.enqueue_capture(r["id"]) is not None)
    return {"status": "queued", "queued": queued}
```

**Step 6: Update `capture_watchlist` to use queue**

Replace the entire `capture_watchlist` endpoint (around line 861) with:

```python
@router.post("/watchlist/capture-all")
def capture_watchlist(request: Request):
    """Enqueue capture for all favorited performers."""
    db = request.app.state.db
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id FROM performers WHERE is_favorite = 1 AND status != 'inactive' "
            "ORDER BY last_checked_at ASC NULLS FIRST"
        ).fetchall()
    if not rows:
        return {"status": "no_watchlist", "queued": 0}
    queued = sum(1 for r in rows if db.enqueue_capture(r["id"]) is not None)
    return {"status": "queued", "queued": queued}
```

**Step 7: Verify the router imports and starts**

```bash
cd "/Users/chasebauman/Documents/App research codex"
python -c "from app.api.performers import router; print('ok')"
```
Expected: `ok`

**Step 8: Commit**

```bash
git add app/api/performers.py
git commit -m "feat: auto-enqueue capture on add/import, migrate capture endpoints to queue"
```

---

### Task 4: New API endpoints — queue status, cancel, capture-stale, enrich

**Files:**
- Modify: `app/api/performers.py`

**Step 1: Add `get_capture_queue` endpoint**

Before the `capture_all_performers` endpoint (around line 825), add:

```python
# ── Capture Queue ─────────────────────────────────────────────────────────

@router.get("/capture-queue")
def get_capture_queue(request: Request):
    db = request.app.state.db
    return {"queue": db.get_capture_queue()}


@router.delete("/capture-queue/{entry_id}")
def cancel_queue_entry(entry_id: int, request: Request):
    db = request.app.state.db
    ok = db.cancel_queue_entry(entry_id)
    if not ok:
        raise HTTPException(404, detail="Queue entry not found or already running")
    return {"ok": True}


@router.post("/capture-stale")
def capture_stale(
    request: Request,
    stale_days: int = Query(7, ge=1, le=365),
):
    """Enqueue capture for all performers not checked in stale_days days."""
    db = request.app.state.db
    ids = db.get_stale_performer_ids(stale_days)
    queued = sum(1 for pid in ids if db.enqueue_capture(pid) is not None)
    return {"queued": queued, "total_stale": len(ids)}


@router.post("/enrich/{performer_id}")
def enrich_performer(performer_id: int, request: Request):
    """Attempt to fetch avatar_url from Redgifs user profile (best-effort)."""
    db = request.app.state.db
    performer = db.get_performer(performer_id)
    if not performer:
        raise HTTPException(404, detail="Performer not found")
    username = performer["username"]
    avatar_url = None
    try:
        resp = req.get(
            f"https://api.redgifs.com/v2/users/{username.lower()}",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=8,
        )
        if resp.ok:
            data = resp.json()
            user = data.get("user") or {}
            avatar_url = user.get("profileImageUrl") or user.get("poster") or None
    except Exception as exc:
        print(f"[enrich] redgifs error for {username}: {exc}")
    if avatar_url and not performer.get("avatar_url"):
        db.update_performer(performer_id, avatar_url=avatar_url)
    return {"avatar_url": avatar_url, "updated": bool(avatar_url and not performer.get("avatar_url"))}
```

**Step 2: Verify routes load**

```bash
cd "/Users/chasebauman/Documents/App research codex"
python -c "from app.api.performers import router; routes = [r.path for r in router.routes]; print([r for r in routes if 'queue' in r or 'stale' in r or 'enrich' in r])"
```
Expected output includes `/capture-queue`, `/capture-queue/{entry_id}`, `/capture-stale`, `/enrich/{performer_id}`

**Step 3: Start backend and test queue endpoint manually**

```bash
# In one terminal:
cd "/Users/chasebauman/Documents/App research codex"
uvicorn app.main:app --port 8000 --reload &
sleep 3
curl -s http://localhost:8000/api/performers/capture-queue | python3 -m json.tool
```
Expected: `{"queue": [...]}`

**Step 4: Commit**

```bash
git add app/api/performers.py
git commit -m "feat: capture-queue GET/DELETE, capture-stale, enrich endpoints"
```

---

### Task 5: Auto-enqueue seeded performers in service.py

**Files:**
- Modify: `app/service.py`

**Step 1: Update `_seed_default_performers` to enqueue new seeds**

In `_seed_default_performers` (around line 150), change the add block:

```python
    def _seed_default_performers(self) -> None:
        """Pre-populate the DB with a curated set of gay male content creators."""
        seeded = 0
        for p in self._DEFAULT_PERFORMERS:
            try:
                existing = self.db.get_performer_by_username(p["username"])
                if not existing:
                    performer = self.db.add_performer(
                        username=p["username"],
                        platform=p["platform"],
                        display_name=p.get("display_name"),
                        bio=p.get("bio"),
                        tags=p.get("tags"),
                        discovered_via="seed",
                    )
                    self.db.enqueue_capture(performer["id"])
                    seeded += 1
            except Exception as exc:
                print(f"[seed] error adding {p['username']}: {exc}")
        if seeded:
            print(f"[seed] added {seeded} default performers, queued for capture")
```

**Step 2: Verify**

```bash
cd "/Users/chasebauman/Documents/App research codex"
python -c "from app.service import ResearchService; print('ok')"
```
Expected: `ok`

**Step 3: Commit**

```bash
git add app/service.py
git commit -m "feat: auto-enqueue capture for newly seeded performers"
```

---

### Task 6: Frontend API client — queue types + methods

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/api.js`

**Step 1: Add `CaptureQueueEntry` interface to `api.ts`**

After the `BulkImportResult` interface (find it near `bulkImportPerformers`), add:

```typescript
export interface CaptureQueueEntry {
  id: number
  performer_id: number
  status: 'queued' | 'running' | 'done' | 'failed'
  created_at: string
  started_at: string | null
  finished_at: string | null
  captured_count: number
  error_msg: string | null
  username: string
  display_name: string | null
  platform: string
  avatar_local: string | null
  avatar_url: string | null
}
```

**Step 2: Add API methods to `api.ts`**

After `captureAllPerformers` (around line 566), add:

```typescript
  getCaptureQueue: () =>
    apiFetch<{ queue: CaptureQueueEntry[] }>('/api/performers/capture-queue'),
  cancelQueueEntry: (entryId: number) =>
    apiFetch<{ ok: boolean }>(`/api/performers/capture-queue/${entryId}`, { method: 'DELETE' }),
  captureStale: (staleDays = 7) =>
    apiFetch<{ queued: number; total_stale: number }>('/api/performers/capture-stale', {
      method: 'POST',
      body: JSON.stringify({ stale_days: staleDays }),
    }),
  enrichPerformer: (id: number) =>
    apiFetch<{ avatar_url: string | null; updated: boolean }>(`/api/performers/enrich/${id}`, { method: 'POST' }),
```

**Step 3: Apply identical changes to `api.js`**

In `frontend/src/lib/api.js`, add the same methods without TypeScript types. The `CaptureQueueEntry` interface is TypeScript-only, skip it. Add after `captureAllPerformers`:

```javascript
  getCaptureQueue: () =>
    apiFetch('/api/performers/capture-queue'),
  cancelQueueEntry: (entryId) =>
    apiFetch(`/api/performers/capture-queue/${entryId}`, { method: 'DELETE' }),
  captureStale: (staleDays = 7) =>
    apiFetch('/api/performers/capture-stale', {
      method: 'POST',
      body: JSON.stringify({ stale_days: staleDays }),
    }),
  enrichPerformer: (id) =>
    apiFetch(`/api/performers/enrich/${id}`, { method: 'POST' }),
```

**Step 4: Verify TypeScript compiles**

```bash
cd "/Users/chasebauman/Documents/App research codex/frontend"
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors (or only pre-existing unrelated errors)

**Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/api.js
git commit -m "feat: capture queue API client methods + CaptureQueueEntry type"
```

---

### Task 7: CaptureQueuePanel component

**Files:**
- Modify: `frontend/src/features/performers/PerformersPage.tsx`
- Modify: `frontend/src/features/performers/PerformersPage.js`

**Step 1: Add `CaptureQueuePanel` component to `PerformersPage.tsx`**

Add this component BEFORE the `PerformerCard` component (before the `/* ── Performer Card */` comment around line 529):

```tsx
/* ── Capture Queue Panel ──────────────────────────────────────────────────── */

function CaptureQueuePanel() {
  const addToast = useAppStore((s) => s.addToast)
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ["capture-queue"],
    queryFn: () => api.getCaptureQueue(),
    refetchInterval: (query) => {
      const queue = query.state.data?.queue ?? []
      const hasActive = queue.some((e) => e.status === "queued" || e.status === "running")
      return hasActive ? 3_000 : 30_000
    },
    staleTime: 0,
  })

  const cancelMutation = useMutation({
    mutationFn: (entryId: number) => api.cancelQueueEntry(entryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["capture-queue"] }),
    onError: () => addToast("Could not cancel — may have already started", "error"),
  })

  const queue = data?.queue ?? []
  if (queue.length === 0) return null

  const activeCount = queue.filter((e) => e.status === "queued" || e.status === "running").length
  const doneCount = queue.filter((e) => e.status === "done").length
  const failedCount = queue.filter((e) => e.status === "failed").length

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0a1628]/95 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-text-muted">
            Capture queue
            {activeCount > 0 && (
              <span className="ml-2 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] text-accent">{activeCount} active</span>
            )}
            {doneCount > 0 && (
              <span className="ml-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-400">{doneCount} done</span>
            )}
            {failedCount > 0 && (
              <span className="ml-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] text-red-400">{failedCount} failed</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {queue.map((entry) => {
            const initials = (entry.display_name || entry.username).charAt(0).toUpperCase()
            const pClass = PLATFORM_COLORS[entry.platform] ?? "bg-white/10 text-text-secondary border-white/10"
            return (
              <div
                key={entry.id}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs",
                  entry.status === "running" && "border-accent/30 bg-accent/10",
                  entry.status === "queued" && "border-white/10 bg-white/5",
                  entry.status === "done" && "border-emerald-500/20 bg-emerald-500/5",
                  entry.status === "failed" && "border-red-500/20 bg-red-500/5",
                )}
              >
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[9px] font-bold text-text-muted">
                  {initials}
                </div>
                <span className="text-text-secondary">@{entry.username}</span>
                <span className={cn("rounded-full border px-1.5 py-px text-[9px] leading-none", pClass)}>{entry.platform}</span>
                {entry.status === "running" && (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                )}
                {entry.status === "queued" && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                )}
                {entry.status === "done" && (
                  <span className="text-emerald-400">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                  </span>
                )}
                {entry.status === "failed" && (
                  <span className="text-red-400" title={entry.error_msg ?? ""}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </span>
                )}
                {entry.status === "done" && entry.captured_count > 0 && (
                  <span className="text-emerald-400">+{entry.captured_count}</span>
                )}
                {entry.status === "queued" && (
                  <button
                    onClick={() => cancelMutation.mutate(entry.id)}
                    className="ml-1 rounded p-px text-text-muted hover:text-red-400"
                    title="Cancel"
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Mount `CaptureQueuePanel` in the main `PerformersPage` return**

Find the main `PerformersPage` component return (it ends with a closing `</div>`). Add `<CaptureQueuePanel />` just before the final closing tag. Also add `pb-24` to the outermost container's className so content isn't hidden behind the panel.

**Step 3: Apply equivalent changes to `PerformersPage.js`**

In `PerformersPage.js`, add the `CaptureQueuePanel` function using the same `_jsx` call pattern already present in the file. Find an existing functional component in the `.js` file to match the pattern, then add the equivalent JS version before `PerformerCard`.

**Step 4: Check for console errors**

After saving, check `preview_console_logs` for any React errors.

**Step 5: Commit**

```bash
git add frontend/src/features/performers/PerformersPage.tsx frontend/src/features/performers/PerformersPage.js
git commit -m "feat: CaptureQueuePanel — live bottom drawer showing queue status"
```

---

### Task 8: Bulk select + "Capture Stale" button

**Files:**
- Modify: `frontend/src/features/performers/PerformersPage.tsx`
- Modify: `frontend/src/features/performers/PerformersPage.js`

**Step 1: Add selection state to `PerformersPage`**

In the main `PerformersPage` component, add state near the top:

```tsx
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
const [selectMode, setSelectMode] = useState(false)

function toggleSelect(id: number) {
  setSelectedIds((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
}

function clearSelect() {
  setSelectedIds(new Set())
  setSelectMode(false)
}
```

**Step 2: Add "Select" and "Capture Stale" buttons to the toolbar**

Find the toolbar row that contains the search input and sort selector (around the area that has "Add", "Discover", "Import" buttons). Add these two buttons:

```tsx
<button
  onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()) }}
  className={cn(
    "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors",
    selectMode
      ? "border-accent/40 bg-accent/10 text-accent"
      : "border-white/10 text-text-secondary hover:text-text-primary"
  )}
>
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg>
  Select
</button>

<button
  onClick={() => {
    api.captureStale().then((r) => {
      addToast(`Queued ${r.queued} stale creators for capture`, "success")
      qc.invalidateQueries({ queryKey: ["capture-queue"] })
    }).catch(() => addToast("Failed to queue stale captures", "error"))
  }}
  className="flex items-center gap-1.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-400 transition-colors hover:bg-amber-500/10"
  title="Capture all creators not checked in 7+ days"
>
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
  Capture Stale
</button>
```

**Step 3: Add bulk action bar**

Add this above the performers grid, visible when `selectedIds.size > 0`:

```tsx
{selectMode && selectedIds.size > 0 && (
  <div className="flex items-center gap-3 rounded-2xl border border-accent/20 bg-accent/5 px-4 py-2.5">
    <span className="text-sm text-text-secondary">{selectedIds.size} selected</span>
    <button
      onClick={() => {
        Array.from(selectedIds).forEach((id) => api.capturePerformerMedia(id))
        addToast(`Queued ${selectedIds.size} creators for capture`, "success")
        qc.invalidateQueries({ queryKey: ["capture-queue"] })
        clearSelect()
      }}
      className="rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
    >
      Capture {selectedIds.size}
    </button>
    <button
      onClick={clearSelect}
      className="text-sm text-text-muted hover:text-text-primary"
    >
      Cancel
    </button>
  </div>
)}
```

**Step 4: Wire checkbox into `PerformerCard`**

Add `selected` and `onToggleSelect` props to `PerformerCard`:

```tsx
function PerformerCard({
  performer,
  onSelect,
  onTagClick,
  selected,
  onToggleSelect,
  selectMode,
}: {
  performer: Performer
  onSelect: (id: number) => void
  onTagClick?: (tag: string) => void
  selected?: boolean
  onToggleSelect?: (id: number) => void
  selectMode?: boolean
}) {
```

When `selectMode` is true, show a checkbox in the top-left corner of the avatar area and clicking the card toggles selection instead of opening the profile. Add to the avatar `div`:

```tsx
{selectMode && (
  <button
    onClick={(e) => { e.stopPropagation(); onToggleSelect?.(performer.id) }}
    className={cn(
      "absolute -left-1 -top-1 z-10 h-5 w-5 rounded border-2 transition-colors",
      selected
        ? "border-accent bg-accent text-white"
        : "border-white/30 bg-[#0a1628]"
    )}
    aria-label="Select"
  >
    {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="m-auto"><path d="M20 6L9 17l-5-5"/></svg>}
  </button>
)}
```

**Step 5: Pass props in the grid map**

Where `PerformerCard` is rendered in the grid, pass:

```tsx
<PerformerCard
  key={p.id}
  performer={p}
  onSelect={(id) => selectMode ? toggleSelect(id) : setSelectedPerformer(id)}
  onTagClick={handleTagClick}
  selected={selectedIds.has(p.id)}
  onToggleSelect={toggleSelect}
  selectMode={selectMode}
/>
```

**Step 6: Apply equivalent changes to `PerformersPage.js`**

Mirror all the above changes in the `.js` sibling using the `_jsx` pattern.

**Step 7: Verify no console errors**

Check `preview_console_logs` for React errors after saving.

**Step 8: Commit**

```bash
git add frontend/src/features/performers/PerformersPage.tsx frontend/src/features/performers/PerformersPage.js
git commit -m "feat: bulk select mode, Capture Stale button, capture selected action"
```

---

### Task 9: Auto-capture on all add flows (frontend)

The backend already auto-enqueues on add. The frontend just needs to invalidate the `capture-queue` query after any successful add so the panel appears immediately.

**Files:**
- Modify: `frontend/src/features/performers/PerformersPage.tsx`
- Modify: `frontend/src/features/performers/PerformersPage.js`

**Step 1: Invalidate capture-queue in `AddCreatorForm` mutation's `onSuccess`**

Find `AddCreatorForm` (around line 103). In the `useMutation` `onSuccess`:

```tsx
onSuccess: () => {
  qc.invalidateQueries({ queryKey: ["performers"] })
  qc.invalidateQueries({ queryKey: ["performer-stats"] })
  qc.invalidateQueries({ queryKey: ["capture-queue"] })
  addToast("Creator added — capture queued", "success")
  onClose()
},
```

**Step 2: Do the same in `DiscoveryModal`'s `addMutation` `onSuccess`**

```tsx
onSuccess: (_data, c) => {
  setAddedSet((prev) => new Set(prev).add(c.username))
  qc.invalidateQueries({ queryKey: ["performers"] })
  qc.invalidateQueries({ queryKey: ["performer-stats"] })
  qc.invalidateQueries({ queryKey: ["capture-queue"] })
  addToast(`Added @${c.username} — capture queued`, "success")
},
```

**Step 3: Do the same in `ImportUrlPanel` and `BulkImportPanel` `onSuccess`**

```tsx
// ImportUrlPanel
onSuccess: (p) => {
  qc.invalidateQueries({ queryKey: ["performers"] })
  qc.invalidateQueries({ queryKey: ["performer-stats"] })
  qc.invalidateQueries({ queryKey: ["capture-queue"] })
  addToast(`Imported @${p.username} — capture queued`, "success")
  onClose()
},

// BulkImportPanel
onSuccess: (result) => {
  qc.invalidateQueries({ queryKey: ["performers"] })
  qc.invalidateQueries({ queryKey: ["performer-stats"] })
  qc.invalidateQueries({ queryKey: ["capture-queue"] })
  addToast(`Created ${result.created}, skipped ${result.skipped} — capture queued for new creators`, "success")
  onClose()
},
```

**Step 4: Apply identical `qc.invalidateQueries({ queryKey: ["capture-queue"] })` additions to `PerformersPage.js`**

**Step 5: Commit**

```bash
git add frontend/src/features/performers/PerformersPage.tsx frontend/src/features/performers/PerformersPage.js
git commit -m "feat: invalidate capture-queue after every add so panel appears immediately"
```

---

### Task 10: Verify end-to-end

**Step 1: Restart backend**

```bash
cd "/Users/chasebauman/Documents/App research codex"
# Stop any running uvicorn, then:
uvicorn app.main:app --port 8000 --reload
```

**Step 2: Open app and add a new creator**

1. Navigate to Creators page
2. Click "Add Creator"
3. Enter username: `testcreator123`, platform: `OnlyFans`
4. Click "Add"

Expected:
- Toast: "Creator added — capture queued"
- Bottom panel slides up showing `@testcreator123` with clock icon (queued)
- After a few seconds, spinner appears (running)
- After capture completes: green check + `+N` count

**Step 3: Test "Capture Stale"**

Click "Capture Stale" button.

Expected: toast showing "Queued N stale creators for capture", panel shows multiple entries.

**Step 4: Test bulk select**

1. Click "Select" button
2. Click 3 creator cards
3. Click "Capture 3"

Expected: all 3 appear in queue panel.

**Step 5: Test cancel**

While an entry is queued (not yet running), click its X button.

Expected: entry disappears from panel.

**Step 6: Final commit if any minor fixes needed, then done**
