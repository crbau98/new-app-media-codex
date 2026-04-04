# UI Polish, Power Features & Screenshot Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the app into a polished, professional research tool with a Playwright screenshot pipeline for explicit image terms, a power-user Items feed, and refined AppShell layout.

**Architecture:** Backend adds a `screenshots` SQLite table, a new `app/sources/screenshot.py` Playwright collector, and `/api/screenshots` REST endpoints. Frontend refactors Sidebar into grouped sections with collapse, adds a right-side ItemDrawer, filter presets in localStorage, density toggle, keyboard nav, replaces MediaPage with a screenshots gallery, and adds Overview charts + polish (toasts, transitions, empty states, skeletons).

**Tech Stack:** FastAPI, SQLite, Playwright (Python), React 19, Zustand, TanStack Query v5, Tailwind CSS v4, Recharts

---

## Task 1: Add `screenshots` DB table + migration

**Files:**
- Modify: `app/db.py`

**Step 1: Add table DDL to SCHEMA constant**

In `app/db.py`, append to the `SCHEMA` string (after the `compound_cache` table, around line 137):

```python
CREATE TABLE IF NOT EXISTS screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    term TEXT NOT NULL,
    source TEXT NOT NULL,
    page_url TEXT NOT NULL UNIQUE,
    local_path TEXT NOT NULL,
    captured_at TEXT NOT NULL
);
```

**Step 2: Add migration in `_migrate`**

In the `_migrate` method (around line 166), add after the last `conn.execute` migration block:

```python
# screenshots table
conn.execute("""
    CREATE TABLE IF NOT EXISTS screenshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        term TEXT NOT NULL,
        source TEXT NOT NULL,
        page_url TEXT NOT NULL UNIQUE,
        local_path TEXT NOT NULL,
        captured_at TEXT NOT NULL
    )
""")
```

**Step 3: Add DB methods for screenshots**

After `set_compound_cache` at the bottom of the `Database` class:

```python
def insert_screenshot(self, term: str, source: str, page_url: str, local_path: str) -> bool:
    """Insert screenshot record. Returns True if inserted, False if duplicate."""
    with self.connect() as conn:
        try:
            conn.execute(
                "INSERT INTO screenshots (term, source, page_url, local_path, captured_at) VALUES (?,?,?,?,?)",
                (term, source, page_url, local_path, utcnow())
            )
            return True
        except sqlite3.IntegrityError:
            return False

def browse_screenshots(
    self,
    term: str | None = None,
    source: str | None = None,
    limit: int = 40,
    offset: int = 0,
) -> dict:
    where, params = [], []
    if term:
        where.append("term = ?")
        params.append(term)
    if source:
        where.append("source = ?")
        params.append(source)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    with self.connect() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM screenshots {clause}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM screenshots {clause} ORDER BY captured_at DESC LIMIT ? OFFSET ?",
            params + [limit, offset]
        ).fetchall()
    screenshots = [dict(r) for r in rows]
    return {"screenshots": screenshots, "total": total, "offset": offset, "limit": limit, "has_more": offset + len(screenshots) < total}
```

**Step 4: Verify migration runs cleanly**

```bash
cd "/Users/chasebauman/Documents/App research codex"
python -c "from app.db import Database; from pathlib import Path; db = Database(Path('data/test_migrate.db')); db.init(); print('OK')"
rm data/test_migrate.db
```
Expected: `OK`

**Step 5: Commit**

```bash
git add app/db.py
git commit -m "feat: add screenshots table and db methods"
```

---

## Task 2: Playwright screenshot collector

**Files:**
- Create: `app/sources/screenshot.py`

**Step 1: Install Playwright**

```bash
pip install playwright
playwright install chromium
```

Verify: `python -c "from playwright.sync_api import sync_playwright; print('OK')"`

**Step 2: Create `app/sources/screenshot.py`**

```python
"""Screenshot-based image collector using Playwright."""
from __future__ import annotations

import time
from pathlib import Path
from typing import Generator

SCREENSHOT_TERMS = [
    "penis",
    "cock",
    "hyperspermia",
    "ejaculate",
    "twink",
    "twunk",
    "foreskin",
]

SOURCES = ["ddg", "tumblr", "x"]

_SEARCH_URLS = {
    "ddg": "https://duckduckgo.com/?q={term}&iax=images&ia=images",
    "tumblr": "https://www.tumblr.com/search/{term}/recent",
    "x": "https://x.com/search?q={term}&f=top",
}

# Max individual results to screenshot per term per source
MAX_RESULTS_PER_COMBO = 12


def _iter_ddg_links(page, term: str) -> list[str]:
    """Return up to MAX_RESULTS_PER_COMBO individual image page URLs from DDG Images."""
    import urllib.parse
    url = _SEARCH_URLS["ddg"].format(term=urllib.parse.quote(term))
    page.goto(url, wait_until="networkidle", timeout=15000)
    page.wait_for_timeout(2000)
    # Collect image result links
    links = page.evaluate("""
        () => Array.from(document.querySelectorAll('a[data-testid="image-result"]'))
            .slice(0, 12)
            .map(a => a.href)
            .filter(Boolean)
    """)
    return links or []


def _iter_tumblr_links(page, term: str) -> list[str]:
    import urllib.parse
    url = _SEARCH_URLS["tumblr"].format(term=urllib.parse.quote(term))
    page.goto(url, wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(3000)
    links = page.evaluate("""
        () => Array.from(document.querySelectorAll('article a[href*="tumblr.com"]'))
            .slice(0, 12)
            .map(a => a.href)
            .filter(h => h.includes('/post/'))
    """)
    return links or []


def _iter_x_links(page, term: str) -> list[str]:
    import urllib.parse
    url = _SEARCH_URLS["x"].format(term=urllib.parse.quote(term))
    page.goto(url, wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(3000)
    links = page.evaluate("""
        () => Array.from(document.querySelectorAll('article a[href*="/status/"]'))
            .slice(0, 12)
            .map(a => a.href)
            .filter(Boolean)
    """)
    # Deduplicate
    seen, out = set(), []
    for l in links:
        if l not in seen:
            seen.add(l)
            out.append(l)
    return out


def capture_screenshots(
    image_dir: Path,
    progress_cb=None,
) -> Generator[dict, None, None]:
    """
    Yield result dicts: {"term", "source", "page_url", "local_path", "ok": bool}.
    progress_cb(term, source, done, total) called after each capture.
    """
    from playwright.sync_api import sync_playwright

    image_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        )
        page = context.new_page()

        for term in SCREENSHOT_TERMS:
            for source in SOURCES:
                try:
                    if source == "ddg":
                        links = _iter_ddg_links(page, term)
                    elif source == "tumblr":
                        links = _iter_tumblr_links(page, term)
                    else:
                        links = _iter_x_links(page, term)
                except Exception as e:
                    print(f"[screenshot] link fetch failed {term}/{source}: {e}")
                    links = []

                total = len(links)
                for i, link in enumerate(links[:MAX_RESULTS_PER_COMBO]):
                    slug = f"{term}_{source}_{i}_{int(time.time())}.png"
                    out_path = image_dir / slug
                    ok = False
                    try:
                        page.goto(link, wait_until="domcontentloaded", timeout=12000)
                        page.wait_for_timeout(1500)
                        page.screenshot(path=str(out_path), full_page=False)
                        ok = True
                    except Exception as e:
                        print(f"[screenshot] capture failed {link}: {e}")

                    if progress_cb:
                        progress_cb(term, source, i + 1, total)

                    yield {
                        "term": term,
                        "source": source,
                        "page_url": link,
                        "local_path": str(out_path),
                        "ok": ok,
                    }
                    time.sleep(0.5)

        context.close()
        browser.close()
```

**Step 3: Quick smoke test (manual)**

```bash
cd "/Users/chasebauman/Documents/App research codex"
python -c "
from app.sources.screenshot import capture_screenshots
from pathlib import Path
results = list(capture_screenshots(Path('data/screenshots_test'), progress_cb=lambda *a: print(a)))
print(f'Captured {len(results)} screenshots')
"
```
Expected: prints progress tuples, captures PNGs in `data/screenshots_test/`

**Step 4: Commit**

```bash
git add app/sources/screenshot.py
git commit -m "feat: add playwright screenshot collector for explicit terms"
```

---

## Task 3: Screenshot API endpoints

**Files:**
- Create: `app/api/screenshots.py`
- Modify: `app/main.py`

**Step 1: Create `app/api/screenshots.py`**

```python
from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/screenshots", tags=["screenshots"])


@router.get("")
def browse_screenshots(
    request: Request,
    term: str | None = None,
    source: str | None = None,
    limit: int = 40,
    offset: int = 0,
):
    db = request.app.state.db
    result = db.browse_screenshots(term=term, source=source, limit=limit, offset=offset)
    # Attach local URL for serving
    for s in result["screenshots"]:
        local = Path(s.get("local_path", ""))
        if local.exists():
            s["local_url"] = f"/cached-screenshots/{local.name}"
        else:
            s["local_url"] = None
    return result


def _run_capture(app_state):
    """Run in thread — Playwright is sync."""
    from app.sources.screenshot import capture_screenshots
    db = app_state.db
    image_dir = Path(app_state.settings.image_dir).parent / "screenshots"
    captured = 0
    for result in capture_screenshots(image_dir):
        if result["ok"]:
            db.insert_screenshot(
                term=result["term"],
                source=result["source"],
                page_url=result["page_url"],
                local_path=result["local_path"],
            )
            captured += 1
    return captured


@router.post("/capture")
async def trigger_capture(request: Request, background_tasks: BackgroundTasks):
    if getattr(request.app.state, "screenshot_running", False):
        return JSONResponse({"status": "already_running"}, status_code=409)
    request.app.state.screenshot_running = True

    async def run():
        try:
            loop = asyncio.get_event_loop()
            count = await loop.run_in_executor(None, _run_capture, request.app.state)
            print(f"[screenshots] capture complete: {count} new")
        finally:
            request.app.state.screenshot_running = False

    background_tasks.add_task(run)
    return {"status": "started"}


@router.get("/status")
def capture_status(request: Request):
    running = getattr(request.app.state, "screenshot_running", False)
    return {"running": running}
```

**Step 2: Register router + static mount in `app/main.py`**

Find the section where other routers are included (look for `app.include_router`). Add:

```python
from app.api.screenshots import router as screenshots_router
app.include_router(screenshots_router)
```

Also add the static mount for screenshots alongside the existing `/cached-images` mount. Find:
```python
app.mount("/cached-images", ...)
```
And add after it:
```python
from fastapi.staticfiles import StaticFiles
screenshots_dir = Path(settings.image_dir).parent / "screenshots"
screenshots_dir.mkdir(parents=True, exist_ok=True)
app.mount("/cached-screenshots", StaticFiles(directory=str(screenshots_dir)), name="cached-screenshots")
```

**Step 3: Verify endpoints exist**

```bash
cd "/Users/chasebauman/Documents/App research codex"
uvicorn app.main:app --port 8001 &
sleep 2
curl -s http://localhost:8001/api/screenshots | python -m json.tool | head -5
curl -s http://localhost:8001/api/screenshots/status
kill %1
```
Expected: `{"screenshots": [], "total": 0, ...}` and `{"running": false}`

**Step 4: Commit**

```bash
git add app/api/screenshots.py app/main.py
git commit -m "feat: add screenshot API endpoints and static file mount"
```

---

## Task 4: Wire screenshot scheduled job

**Files:**
- Modify: `app/service.py`

**Step 1: Add screenshot job to `ResearchService`**

Find where APScheduler is configured in `app/service.py` (look for `scheduler.add_job` or `BackgroundScheduler`). Add a new job after the crawl job:

```python
# Screenshot capture job — runs every 12 hours
self.scheduler.add_job(
    self._run_screenshot_capture,
    "interval",
    hours=12,
    id="screenshot_capture",
    replace_existing=True,
    max_instances=1,
)
```

**Step 2: Add `_run_screenshot_capture` method to `ResearchService`**

```python
def _run_screenshot_capture(self) -> None:
    """Run Playwright screenshot capture for explicit terms."""
    from app.sources.screenshot import capture_screenshots
    from pathlib import Path
    image_dir = Path(self.settings.image_dir).parent / "screenshots"
    captured = 0
    for result in capture_screenshots(image_dir):
        if result["ok"]:
            self.db.insert_screenshot(
                term=result["term"],
                source=result["source"],
                page_url=result["page_url"],
                local_path=result["local_path"],
            )
            captured += 1
    print(f"[service] screenshot capture done: {captured} new")
```

**Step 3: Commit**

```bash
git add app/service.py
git commit -m "feat: wire screenshot capture as scheduled job (12h interval)"
```

---

## Task 5: Store — add selectedItemId, sidebarCollapsed, toast queue

**Files:**
- Modify: `frontend/src/store.ts`

**Step 1: Update store**

Replace the entire contents of `frontend/src/store.ts`:

```typescript
import { create } from "zustand"

export type ActiveView = "overview" | "items" | "images" | "hypotheses" | "graph"

export interface Filters {
  search: string
  sourceType: string
  reviewStatus: string
  savedOnly: boolean
  sort: string
  theme: string
  imageTheme: string
}

const DEFAULT_FILTERS: Filters = {
  search: "",
  sourceType: "",
  reviewStatus: "",
  savedOnly: false,
  sort: "newest",
  theme: "",
  imageTheme: "",
}

export interface Toast {
  id: string
  message: string
  type?: "success" | "error" | "info"
}

interface AppState {
  activeView: ActiveView
  setActiveView: (view: ActiveView) => void
  selectedTheme: string | null
  setSelectedTheme: (theme: string | null) => void
  selectedSource: string | null
  setSelectedSource: (source: string | null) => void
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void
  selectedItemIds: Set<number>
  toggleItemSelection: (id: number) => void
  clearItemSelection: () => void
  crawlRunning: boolean
  setCrawlRunning: (running: boolean) => void
  filters: Filters
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void
  resetFilters: () => void
  // Drawer
  selectedItemId: number | null
  setSelectedItemId: (id: number | null) => void
  // Toasts
  toasts: Toast[]
  addToast: (message: string, type?: Toast["type"]) => void
  removeToast: (id: string) => void
  // Sidebar
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeView: "overview",
  setActiveView: (activeView) => set({ activeView }),
  selectedTheme: null,
  setSelectedTheme: (selectedTheme) => set({ selectedTheme }),
  selectedSource: null,
  setSelectedSource: (selectedSource) => set({ selectedSource }),
  commandPaletteOpen: false,
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  selectedItemIds: new Set(),
  toggleItemSelection: (id) => set((s) => {
    const next = new Set(s.selectedItemIds)
    next.has(id) ? next.delete(id) : next.add(id)
    return { selectedItemIds: next }
  }),
  clearItemSelection: () => set({ selectedItemIds: new Set() }),
  crawlRunning: false,
  setCrawlRunning: (crawlRunning) => set({ crawlRunning }),
  filters: { ...DEFAULT_FILTERS },
  setFilter: (key, value) => set((s) => ({ filters: { ...s.filters, [key]: value } })),
  resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),
  // Drawer
  selectedItemId: null,
  setSelectedItemId: (selectedItemId) => set({ selectedItemId }),
  // Toasts
  toasts: [],
  addToast: (message, type = "success") => set((s) => ({
    toasts: [...s.toasts, { id: `${Date.now()}-${Math.random()}`, message, type }]
  })),
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  // Sidebar
  sidebarCollapsed: false,
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
}))
```

**Step 2: Commit**

```bash
cd frontend && npm run build 2>&1 | tail -5
cd ..
git add frontend/src/store.ts
git commit -m "feat: add selectedItemId, toasts, sidebarCollapsed to store"
```

---

## Task 6: Sidebar — section groups, collapse mode, crawl footer

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/components/AppShell.tsx`

**Step 1: Rewrite `Sidebar.tsx`**

```tsx
import type { ReactNode } from "react"
import { useEffect } from "react"
import { cn } from "@/lib/cn"
import { useAppStore, type ActiveView } from "../store"
import { useQuery } from "@tanstack/react-query"
import { api } from "../lib/api"

interface NavItem {
  id: ActiveView
  label: string
  icon: ReactNode
}

const RESEARCH_ITEMS: NavItem[] = [
  {
    id: "overview",
    label: "Overview",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  },
  {
    id: "items",
    label: "Items",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>,
  },
  {
    id: "graph",
    label: "Graph",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="12" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><circle cx="12" cy="4" r="2"/><path d="m8 11 4-5M8 13l8 4M14 5l2.5 1"/></svg>,
  },
]

const MEDIA_ITEMS: NavItem[] = [
  {
    id: "images",
    label: "Images",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>,
  },
]

const AI_ITEMS: NavItem[] = [
  {
    id: "hypotheses",
    label: "Hypotheses",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.3 6H8.3A7.012 7.012 0 0 1 5 9a7 7 0 0 1 7-7Z"/></svg>,
  },
]

function NavGroup({ label, items, activeView, setActiveView, collapsed }: {
  label: string
  items: NavItem[]
  activeView: ActiveView
  setActiveView: (v: ActiveView) => void
  collapsed: boolean
}) {
  return (
    <div className="mb-1">
      {!collapsed && (
        <p className="px-4 pt-3 pb-1 text-[10px] font-semibold tracking-widest uppercase text-text-muted select-none">
          {label}
        </p>
      )}
      <ul className={cn("space-y-0.5", collapsed ? "px-1" : "px-2")}>
        {items.map((item) => {
          const isActive = activeView === item.id
          return (
            <li key={item.id}>
              <button
                onClick={() => setActiveView(item.id)}
                aria-current={isActive ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "w-full flex items-center gap-3 rounded-md text-sm font-medium",
                  "transition-colors duration-150 border-l-2",
                  collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2",
                  isActive
                    ? "border-accent text-accent bg-bg-elevated"
                    : "border-transparent text-text-muted hover:text-text-primary hover:bg-bg-elevated"
                )}
              >
                <span className="shrink-0">{item.icon}</span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function CrawlFooter({ collapsed }: { collapsed: boolean }) {
  const crawlRunning = useAppStore((s) => s.crawlRunning)
  const { data: dashboard } = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  const lastRun = dashboard?.last_run
  const lastRunAgo = lastRun?.finished_at
    ? (() => {
        const diff = Date.now() - new Date(lastRun.finished_at).getTime()
        const mins = Math.floor(diff / 60000)
        if (mins < 60) return `${mins}m ago`
        return `${Math.floor(mins / 60)}h ago`
      })()
    : null

  async function handleRun() {
    if (crawlRunning) return
    await api.triggerCrawl()
  }

  if (collapsed) {
    return (
      <div className="px-1 py-3 border-t border-border flex flex-col items-center gap-2">
        <button
          onClick={handleRun}
          disabled={crawlRunning}
          title="Run Crawl"
          className={cn(
            "w-8 h-8 rounded-md flex items-center justify-center",
            "text-text-muted hover:text-accent hover:bg-bg-elevated transition-colors",
            crawlRunning && "opacity-50 cursor-not-allowed"
          )}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 border-t border-border space-y-2">
      <div className="flex items-center gap-2">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", crawlRunning ? "bg-green animate-pulse" : "bg-text-muted")} />
        <span className="text-[11px] text-text-muted font-mono truncate">
          {crawlRunning ? "Crawling…" : lastRunAgo ? `Last: ${lastRunAgo}` : "Never crawled"}
        </span>
      </div>
      <button
        onClick={handleRun}
        disabled={crawlRunning}
        className={cn(
          "w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md",
          "text-[11px] font-medium border border-border text-text-secondary",
          "hover:border-accent/40 hover:text-accent transition-colors",
          crawlRunning && "opacity-50 cursor-not-allowed"
        )}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        {crawlRunning ? "Running…" : "Run Now"}
      </button>
    </div>
  )
}

export function Sidebar() {
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed)

  // Persist collapse state
  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed")
    if (stored === "true") setSidebarCollapsed(true)
  }, [setSidebarCollapsed])

  function toggleCollapse() {
    const next = !collapsed
    setSidebarCollapsed(next)
    localStorage.setItem("sidebar-collapsed", String(next))
  }

  const width = collapsed ? "w-[64px]" : "w-[260px]"

  return (
    <aside
      className={cn("fixed left-0 top-0 h-screen z-30 flex flex-col border-r border-border bg-bg-surface transition-[width] duration-200", width)}
      aria-label="Main navigation"
    >
      {/* Logo */}
      <div className={cn("flex items-center border-b border-border", collapsed ? "justify-center px-2 py-4" : "justify-between px-5 pt-5 pb-4")}>
        {!collapsed && (
          <div>
            <span className="text-accent font-mono font-bold text-base tracking-widest uppercase leading-none">Codex</span>
            <span className="block text-text-muted text-[11px] font-mono mt-0.5 tracking-wide">Research Radar</span>
          </div>
        )}
        <button
          onClick={toggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {collapsed
              ? <path d="M9 18l6-6-6-6"/>
              : <path d="M15 18l-6-6 6-6"/>}
          </svg>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto" aria-label="Views">
        <NavGroup label="Research" items={RESEARCH_ITEMS} activeView={activeView} setActiveView={setActiveView} collapsed={collapsed} />
        <NavGroup label="Media" items={MEDIA_ITEMS} activeView={activeView} setActiveView={setActiveView} collapsed={collapsed} />
        <NavGroup label="AI" items={AI_ITEMS} activeView={activeView} setActiveView={setActiveView} collapsed={collapsed} />
      </nav>

      <CrawlFooter collapsed={collapsed} />
    </aside>
  )
}
```

**Step 2: Update `AppShell.tsx` to use dynamic sidebar width**

Find the `ml-[220px]` or `left-[220px]` references in `AppShell.tsx` and update:

```tsx
import { useAppStore } from "../store"

// In component:
const collapsed = useAppStore((s) => s.sidebarCollapsed)
const sidebarW = collapsed ? "ml-[64px]" : "ml-[260px]"
```

Apply `sidebarW` to the main content area className (replacing hardcoded `ml-[220px]`).

**Step 3: Also update TopBar's `left-[220px]` to be dynamic**

In `TopBar.tsx`, import `useAppStore` and apply the same pattern:
```tsx
const collapsed = useAppStore((s) => s.sidebarCollapsed)
const leftOffset = collapsed ? "left-[64px]" : "left-[260px]"
```

Replace `left-[220px]` with `{leftOffset}` in the header className (use template literal or cn).

**Step 4: Build and verify**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: no errors.

**Step 5: Commit**

```bash
cd ..
git add frontend/src/components/Sidebar.tsx frontend/src/components/AppShell.tsx frontend/src/components/TopBar.tsx
git commit -m "feat: sidebar section groups, collapse mode, crawl footer"
```

---

## Task 7: Toast notification system

**Files:**
- Create: `frontend/src/components/Toast.tsx`
- Modify: `frontend/src/components/AppShell.tsx`

**Step 1: Create `Toast.tsx`**

```tsx
import { useEffect } from "react"
import { useAppStore } from "../store"
import { cn } from "@/lib/cn"

function ToastItem({ id, message, type }: { id: string; message: string; type?: string }) {
  const removeToast = useAppStore((s) => s.removeToast)

  useEffect(() => {
    const timer = setTimeout(() => removeToast(id), 3500)
    return () => clearTimeout(timer)
  }, [id, removeToast])

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg",
        "text-sm font-medium text-text-primary bg-bg-elevated border-border",
        "animate-in slide-in-from-bottom-2 duration-200",
        type === "error" && "border-red/40 text-red",
        type === "success" && "border-green/30"
      )}
    >
      {type === "error" && <span className="text-red">✕</span>}
      {type === "success" && <span className="text-green">✓</span>}
      <span>{message}</span>
      <button
        onClick={() => removeToast(id)}
        className="ml-auto text-text-muted hover:text-text-primary transition-colors"
        aria-label="Dismiss"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 w-80"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} {...t} />
      ))}
    </div>
  )
}
```

**Step 2: Add `animate-in` / `slide-in-from-bottom-2` utilities to `index.css`**

In `frontend/src/index.css`, add to the `@layer utilities` block (or create one):

```css
@layer utilities {
  .animate-in {
    animation-name: animateIn;
    animation-duration: var(--tw-duration, 200ms);
    animation-fill-mode: both;
  }
  .slide-in-from-bottom-2 {
    --slide-from: 0.5rem;
  }
  @keyframes animateIn {
    from { opacity: 0; transform: translateY(var(--slide-from, 0)); }
    to   { opacity: 1; transform: translateY(0); }
  }
}
```

**Step 3: Add `<ToastContainer />` to `AppShell.tsx`**

Import and place at the end of the `AppShell` return, just before closing tag:

```tsx
import { ToastContainer } from "./Toast"
// ...inside return:
<ToastContainer />
```

**Step 4: Commit**

```bash
cd frontend && npm run build 2>&1 | tail -5 && cd ..
git add frontend/src/components/Toast.tsx frontend/src/components/AppShell.tsx frontend/src/index.css
git commit -m "feat: add toast notification system"
```

---

## Task 8: Item Detail Drawer

**Files:**
- Create: `frontend/src/features/items/ItemDrawer.tsx`

**Step 1: Create `ItemDrawer.tsx`**

```tsx
import { useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useAppStore } from "../../store"
import { api, type ResearchItem } from "../../lib/api"
import { Badge } from "../../components/Badge"
import { Button } from "../../components/Button"
import { cn } from "@/lib/cn"
import { Spinner } from "../../components/Spinner"

function ActionBar({ item }: { item: ResearchItem }) {
  const qc = useQueryClient()
  const addToast = useAppStore((s) => s.addToast)

  async function toggle(patch: Parameters<typeof api.updateItem>[1]) {
    await api.updateItem(item.id, patch)
    qc.invalidateQueries({ queryKey: ["browse-items"] })
    qc.invalidateQueries({ queryKey: ["item", item.id] })
    const key = Object.keys(patch)[0]
    addToast(key === "is_saved" ? (patch.is_saved ? "Saved" : "Unsaved") : `Marked ${patch.review_status}`)
  }

  return (
    <div className="flex gap-2 flex-wrap">
      <Button size="sm" variant={item.is_saved ? "primary" : "secondary"} onClick={() => toggle({ is_saved: !item.is_saved })}>
        {item.is_saved ? "★ Saved" : "☆ Save"}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => toggle({ review_status: "shortlisted" })}>
        Shortlist
      </Button>
      <Button size="sm" variant="secondary" onClick={() => toggle({ review_status: "archived" })}>
        Archive
      </Button>
      <a href={item.url} target="_blank" rel="noopener noreferrer">
        <Button size="sm" variant="secondary">↗ Open</Button>
      </a>
    </div>
  )
}

export function ItemDrawer() {
  const selectedItemId = useAppStore((s) => s.selectedItemId)
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId)
  const drawerRef = useRef<HTMLDivElement>(null)

  const { data: item, isLoading } = useQuery({
    queryKey: ["item", selectedItemId],
    queryFn: () => api.item(selectedItemId!),
    enabled: selectedItemId != null,
    staleTime: 30_000,
  })

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedItemId(null)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [setSelectedItemId])

  const isOpen = selectedItemId != null

  return (
    <>
      {/* Backdrop (mobile) */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 lg:hidden"
          onClick={() => setSelectedItemId(null)}
          aria-hidden
        />
      )}

      {/* Drawer panel */}
      <aside
        ref={drawerRef}
        className={cn(
          "fixed top-12 right-0 bottom-0 z-40 w-[400px] flex flex-col",
          "bg-bg-surface border-l border-border",
          "transition-transform duration-200",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
        aria-label="Item details"
        aria-hidden={!isOpen}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <span className="text-xs font-mono text-text-muted uppercase tracking-wider">Detail</span>
          <button
            onClick={() => setSelectedItemId(null)}
            className="text-text-muted hover:text-text-primary transition-colors"
            aria-label="Close detail panel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isLoading && <div className="flex justify-center pt-8"><Spinner /></div>}
          {item && (
            <>
              <h2 className="text-text-primary font-semibold text-base leading-snug">{item.title}</h2>

              <div className="flex gap-2 flex-wrap">
                <Badge variant="default">{item.source_type}</Badge>
                <Badge variant="default">{item.theme}</Badge>
                <Badge variant={item.review_status === "shortlisted" ? "teal" : "default"}>{item.review_status}</Badge>
                {item.score > 0 && <Badge variant="amber">score {item.score.toFixed(1)}</Badge>}
              </div>

              <ActionBar item={item} />

              {item.summary && (
                <div>
                  <p className="text-[11px] font-mono text-text-muted uppercase tracking-wider mb-1">Summary</p>
                  <p className="text-sm text-text-secondary leading-relaxed">{item.summary}</p>
                </div>
              )}

              {item.compounds.length > 0 && (
                <div>
                  <p className="text-[11px] font-mono text-text-muted uppercase tracking-wider mb-1">Compounds</p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.compounds.map((c) => (
                      <span key={c} className="font-mono text-xs px-2 py-0.5 rounded bg-bg-elevated border border-border text-teal">{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {item.mechanisms.length > 0 && (
                <div>
                  <p className="text-[11px] font-mono text-text-muted uppercase tracking-wider mb-1">Mechanisms</p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.mechanisms.map((m) => (
                      <span key={m} className="font-mono text-xs px-2 py-0.5 rounded bg-bg-elevated border border-border text-purple">{m}</span>
                    ))}
                  </div>
                </div>
              )}

              {item.content && (
                <div>
                  <p className="text-[11px] font-mono text-text-muted uppercase tracking-wider mb-1">Content</p>
                  <p className="text-xs text-text-muted leading-relaxed whitespace-pre-wrap line-clamp-[20]">{item.content}</p>
                </div>
              )}

              <div className="text-[10px] text-text-muted font-mono space-y-0.5 pt-2 border-t border-border">
                {item.author && <p>Author: {item.author}</p>}
                {item.published_at && <p>Published: {item.published_at.slice(0, 10)}</p>}
                <p>Domain: {item.domain}</p>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  )
}
```

**Step 2: Add `ItemDrawer` to `ItemsPage.tsx`**

In `frontend/src/features/items/ItemsPage.tsx`, import and render `<ItemDrawer />`:

```tsx
import { ItemDrawer } from "./ItemDrawer"
// In JSX, add before closing wrapper div:
<ItemDrawer />
```

Also add `pr-[400px]` to the main content area className when drawer is open (check `selectedItemId`):

```tsx
const selectedItemId = useAppStore((s) => s.selectedItemId)
// Add to the list container:
className={cn("...", selectedItemId != null && "pr-[400px]")}
```

**Step 3: Wire click on `SourceCard` to open drawer**

In `SourceCard.tsx`, accept an `onSelect` prop and call it on card click (not on checkbox or action button clicks). Alternatively, in `ItemsPage.tsx` wrap each card with an `onClick`:

```tsx
const setSelectedItemId = useAppStore((s) => s.setSelectedItemId)
// On each item render:
<div onClick={() => setSelectedItemId(item.id)} className="cursor-pointer">
  <SourceCard item={item} ... />
</div>
```

Make sure action buttons inside `SourceCard` call `e.stopPropagation()` to prevent drawer opening on save/archive clicks.

**Step 4: Build and verify**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

**Step 5: Commit**

```bash
cd ..
git add frontend/src/features/items/ItemDrawer.tsx frontend/src/features/items/ItemsPage.tsx frontend/src/features/items/SourceCard.tsx
git commit -m "feat: add item detail drawer with keyboard close and action bar"
```

---

## Task 9: Items — filter chips, presets, density toggle, keyboard nav

**Files:**
- Modify: `frontend/src/features/items/FiltersBar.tsx`
- Modify: `frontend/src/features/items/ItemsPage.tsx`

**Step 1: Add filter chip display + preset logic to `FiltersBar.tsx`**

At the top of the component, after existing filter state reads, add:

```tsx
// Active filter chips
const activeFilters: { key: string; label: string; value: string }[] = []
if (filters.search) activeFilters.push({ key: "search", label: "search", value: filters.search })
if (filters.sourceType) activeFilters.push({ key: "sourceType", label: "source", value: filters.sourceType })
if (filters.theme) activeFilters.push({ key: "theme", label: "theme", value: filters.theme })
if (filters.reviewStatus) activeFilters.push({ key: "reviewStatus", label: "status", value: filters.reviewStatus })
if (filters.savedOnly) activeFilters.push({ key: "savedOnly", label: "saved only", value: "yes" })
```

Add a `Presets` block using `localStorage`:

```tsx
const PRESETS_KEY = "filter-presets"

function loadPresets(): Record<string, typeof DEFAULT_FILTERS> {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || "{}") }
  catch { return {} }
}

function savePreset(name: string, filters: typeof DEFAULT_FILTERS) {
  const p = loadPresets()
  p[name] = filters
  localStorage.setItem(PRESETS_KEY, JSON.stringify(p))
}
```

Render active chips below the search bar:

```tsx
{activeFilters.length > 0 && (
  <div className="flex flex-wrap gap-1.5 mt-2">
    {activeFilters.map((f) => (
      <button
        key={f.key}
        onClick={() => setFilter(f.key as any, f.key === "savedOnly" ? false : "")}
        className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs hover:bg-accent/20 transition-colors"
      >
        <span className="text-text-muted">{f.label}:</span> {f.value}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    ))}
    <button onClick={resetFilters} className="text-xs text-text-muted hover:text-text-primary transition-colors px-1">clear all</button>
    <button
      onClick={() => {
        const name = prompt("Preset name:")
        if (name) { savePreset(name, filters); addToast(`Preset "${name}" saved`) }
      }}
      className="text-xs text-text-muted hover:text-accent transition-colors px-1"
    >
      💾 save preset
    </button>
  </div>
)}
```

**Step 2: Add density toggle to `ItemsPage.tsx`**

```tsx
type Density = "compact" | "comfortable" | "spacious"
const [density, setDensity] = useState<Density>("comfortable")

// Render toggle in top-right of page:
<div className="flex items-center gap-1 text-xs text-text-muted">
  {(["compact", "comfortable", "spacious"] as Density[]).map((d) => (
    <button
      key={d}
      onClick={() => setDensity(d)}
      className={cn("px-2 py-1 rounded transition-colors", density === d ? "text-text-primary bg-bg-elevated" : "hover:text-text-primary")}
    >
      {d === "compact" ? "≡" : d === "comfortable" ? "▤" : "▦"}
    </button>
  ))}
</div>
```

Pass `density` to each `SourceCard` as a prop and use it to conditionally apply `py-2` (compact) / `py-3` (comfortable) / `py-4` (spacious) to the card wrapper.

**Step 3: Add keyboard navigation to `ItemsPage.tsx`**

```tsx
const selectedItemId = useAppStore((s) => s.selectedItemId)
const setSelectedItemId = useAppStore((s) => s.setSelectedItemId)
const addToast = useAppStore((s) => s.addToast)
const qc = useQueryClient()

// Track focused item index
const [focusedIdx, setFocusedIdx] = useState(0)

useEffect(() => {
  function onKey(e: KeyboardEvent) {
    // Don't fire if user is typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    const items = data?.items ?? []
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault()
      setFocusedIdx((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault()
      setFocusedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      const item = items[focusedIdx]
      if (item) setSelectedItemId(item.id)
    } else if (e.key === "s" && !e.metaKey && !e.ctrlKey) {
      const item = items[focusedIdx]
      if (item) {
        api.updateItem(item.id, { is_saved: !item.is_saved }).then(() => {
          qc.invalidateQueries({ queryKey: ["browse-items"] })
          addToast(item.is_saved ? "Unsaved" : "Saved")
        })
      }
    } else if (e.key === "e") {
      const item = items[focusedIdx]
      if (item) {
        api.updateItem(item.id, { review_status: "archived" }).then(() => {
          qc.invalidateQueries({ queryKey: ["browse-items"] })
          addToast("Archived")
        })
      }
    }
  }
  document.addEventListener("keydown", onKey)
  return () => document.removeEventListener("keydown", onKey)
}, [focusedIdx, data, setSelectedItemId, qc, addToast])
```

Apply a focused ring to the card at `focusedIdx`:
```tsx
items.map((item, idx) => (
  <div
    key={item.id}
    className={cn(idx === focusedIdx && "ring-1 ring-accent/40 rounded-lg")}
    onClick={() => { setFocusedIdx(idx); setSelectedItemId(item.id) }}
  >
    <SourceCard ... />
  </div>
))
```

**Step 4: Commit**

```bash
cd frontend && npm run build 2>&1 | tail -5 && cd ..
git add frontend/src/features/items/
git commit -m "feat: filter chips, presets, density toggle, keyboard nav in items feed"
```

---

## Task 10: SourceCard polish — source icon, score bar

**Files:**
- Modify: `frontend/src/features/items/SourceCard.tsx`

**Step 1: Add source icon map**

At the top of `SourceCard.tsx`, add:

```tsx
const SOURCE_ICONS: Record<string, string> = {
  reddit: "🟠",
  pubmed: "🔬",
  arxiv: "📄",
  biorxiv: "🧬",
  x: "𝕏",
  twitter: "𝕏",
  lpsg: "💬",
  duckduckgo: "🦆",
  literature: "📚",
  firecrawl: "🔥",
}
```

**Step 2: Replace text source badge with icon + label**

Find where `source_type` is rendered as a `<Badge>` and replace with:

```tsx
<span className="flex items-center gap-1 text-xs text-text-muted font-mono">
  <span>{SOURCE_ICONS[item.source_type] ?? "◆"}</span>
  <span>{item.source_type}</span>
</span>
```

**Step 3: Add score bar to left accent strip**

The left accent strip is likely a `div` with a fixed height and `bg-accent` or similar. Replace it with:

```tsx
<div className="w-0.5 self-stretch bg-bg-elevated relative overflow-hidden rounded-full shrink-0">
  <div
    className="absolute bottom-0 left-0 right-0 bg-accent/70 transition-all"
    style={{ height: `${Math.min(100, (item.score / 10) * 100)}%` }}
  />
</div>
```

**Step 4: Commit**

```bash
cd frontend && npm run build 2>&1 | tail -5 && cd ..
git add frontend/src/features/items/SourceCard.tsx
git commit -m "feat: source icon, score bar polish on SourceCard"
```

---

## Task 11: API client — add screenshot endpoints + types

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Step 1: Add `Screenshot` type and endpoints**

After the existing type definitions, add:

```typescript
export interface Screenshot {
  id: number
  term: string
  source: string
  page_url: string
  local_path: string
  local_url: string | null
  captured_at: string
}

export interface BrowseScreenshotsPayload {
  screenshots: Screenshot[]
  total: number
  offset: number
  limit: number
  has_more: boolean
}
```

In the `api` object, add:

```typescript
browseScreenshots: (params?: Record<string, string | number>) =>
  apiFetch<BrowseScreenshotsPayload>(`/api/screenshots?${new URLSearchParams(Object.entries(params ?? {}).map(([k,v]) => [k, String(v)])).toString()}`),
screenshotStatus: () => apiFetch<{ running: boolean }>("/api/screenshots/status"),
triggerCapture: () => apiFetch<{ status: string }>("/api/screenshots/capture", { method: "POST" }),
```

**Step 2: Commit**

```bash
cd frontend && npm run build 2>&1 | tail -5 && cd ..
git add frontend/src/lib/api.ts
git commit -m "feat: add screenshot types and api methods"
```

---

## Task 12: MediaPage — replace with screenshot gallery

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx`

**Step 1: Rewrite `MediaPage.tsx`**

```tsx
import { useState, useCallback, useRef } from "react"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { api, type Screenshot } from "../../lib/api"
import { Spinner } from "../../components/Spinner"
import { cn } from "@/lib/cn"

const TERMS = ["penis", "cock", "hyperspermia", "ejaculate", "twink", "twunk", "foreskin"]
const SOURCES = ["ddg", "tumblr", "x"]

function ScreenshotCard({ shot, onClick }: { shot: Screenshot; onClick: () => void }) {
  const src = shot.local_url ?? shot.page_url
  const SOURCE_LABEL: Record<string, string> = { ddg: "DDG", tumblr: "Tumblr", x: "𝕏" }

  return (
    <div
      className="relative group cursor-pointer overflow-hidden rounded-lg bg-bg-elevated border border-border hover:border-accent/30 transition-all"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
      aria-label={`Screenshot: ${shot.term} from ${shot.source}`}
    >
      {src ? (
        <img
          src={src}
          alt={`${shot.term} - ${shot.source}`}
          loading="lazy"
          className="w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <div className="w-full h-40 flex items-center justify-center text-text-muted text-xs">No preview</div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-white/90 bg-black/40 rounded px-1.5 py-0.5">{shot.term}</span>
          <span className="text-xs text-white/70">{SOURCE_LABEL[shot.source] ?? shot.source}</span>
        </div>
        <p className="text-[10px] text-white/50 mt-0.5 font-mono">{shot.captured_at.slice(0, 10)}</p>
      </div>
    </div>
  )
}

function Lightbox({ shots, idx, onClose, onPrev, onNext }: {
  shots: Screenshot[]; idx: number; onClose: () => void; onPrev: () => void; onNext: () => void
}) {
  const shot = shots[idx]
  if (!shot) return null
  const src = shot.local_url ?? shot.page_url

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label="Screenshot lightbox"
    >
      <button onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white" aria-label="Close">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
      <button onClick={(e) => { e.stopPropagation(); onPrev() }} className="absolute left-4 text-white/70 hover:text-white p-2" aria-label="Previous">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      {src && (
        <img
          src={src}
          alt={shot.term}
          className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <button onClick={(e) => { e.stopPropagation(); onNext() }} className="absolute right-4 text-white/70 hover:text-white p-2" aria-label="Next">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>
  )
}

export function MediaPage() {
  const [term, setTerm] = useState<string | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const qc = useQueryClient()

  const { data: statusData, refetch: refetchStatus } = useQuery({
    queryKey: ["screenshot-status"],
    queryFn: api.screenshotStatus,
    refetchInterval: 3000,
  })
  const capturing = statusData?.running ?? false

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["screenshots", term, source],
    queryFn: ({ pageParam = 0 }) =>
      api.browseScreenshots({ ...(term ? { term } : {}), ...(source ? { source } : {}), limit: 40, offset: pageParam }),
    getNextPageParam: (last) => last.has_more ? last.offset + last.screenshots.length : undefined,
    initialPageParam: 0,
  })

  const allShots = data?.pages.flatMap((p) => p.screenshots) ?? []

  async function handleCapture() {
    await api.triggerCapture()
    refetchStatus()
  }

  const observerRef = useRef<IntersectionObserver | null>(null)
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) observerRef.current.disconnect()
    if (!node) return
    observerRef.current = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    })
    observerRef.current.observe(node)
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text-primary font-semibold text-lg">Images</h1>
          <p className="text-text-muted text-xs mt-0.5">Screenshot-based capture for specific terms</p>
        </div>
        <button
          onClick={handleCapture}
          disabled={capturing}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border",
            "bg-bg-elevated border-border text-text-secondary",
            "hover:border-accent/40 hover:text-accent transition-colors",
            capturing && "opacity-50 cursor-not-allowed"
          )}
        >
          {capturing ? (
            <><Spinner size={14} /> Capturing…</>
          ) : (
            <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Capture Now</>
          )}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setTerm(null)} className={cn("px-3 py-1.5 rounded-full text-xs border transition-colors", term === null ? "bg-accent text-white border-accent" : "border-border text-text-muted hover:border-accent/40")}>All</button>
        {TERMS.map((t) => (
          <button key={t} onClick={() => setTerm(t === term ? null : t)} className={cn("px-3 py-1.5 rounded-full text-xs border transition-colors font-mono", term === t ? "bg-accent text-white border-accent" : "border-border text-text-muted hover:border-accent/40")}>{t}</button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={() => setSource(null)} className={cn("px-3 py-1.5 rounded-full text-xs border transition-colors", source === null ? "bg-bg-elevated text-text-primary border-accent/30" : "border-border text-text-muted hover:border-accent/40")}>All sources</button>
        {SOURCES.map((s) => (
          <button key={s} onClick={() => setSource(s === source ? null : s)} className={cn("px-3 py-1.5 rounded-full text-xs border transition-colors", source === s ? "bg-bg-elevated text-text-primary border-accent/30" : "border-border text-text-muted hover:border-accent/40")}>{s === "ddg" ? "DDG" : s === "x" ? "𝕏" : "Tumblr"}</button>
        ))}
      </div>

      {/* Gallery */}
      {isLoading && <div className="flex justify-center py-16"><Spinner /></div>}

      {!isLoading && allShots.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-4xl mb-3">📸</div>
          <p className="text-text-secondary font-medium">No screenshots yet</p>
          <p className="text-text-muted text-sm mt-1">Click "Capture Now" to start collecting</p>
        </div>
      )}

      <div style={{ columns: "4 200px", gap: "12px" }}>
        {allShots.map((shot, idx) => (
          <div key={shot.id} style={{ breakInside: "avoid", marginBottom: "12px" }}>
            <ScreenshotCard shot={shot} onClick={() => setLightboxIdx(idx)} />
          </div>
        ))}
      </div>

      <div ref={sentinelRef} className="h-4" />
      {isFetchingNextPage && <div className="flex justify-center py-4"><Spinner /></div>}

      {/* Lightbox */}
      {lightboxIdx != null && (
        <Lightbox
          shots={allShots}
          idx={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onPrev={() => setLightboxIdx((i) => Math.max(0, (i ?? 0) - 1))}
          onNext={() => setLightboxIdx((i) => Math.min(allShots.length - 1, (i ?? 0) + 1))}
        />
      )}
    </div>
  )
}
```

**Step 2: Build and verify**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

**Step 3: Commit**

```bash
cd ..
git add frontend/src/features/images/MediaPage.tsx
git commit -m "feat: replace media page with screenshot gallery (Playwright pipeline)"
```

---

## Task 13: Overview — source donut chart + recent runs panel

**Files:**
- Modify: `frontend/src/features/overview/OverviewPage.tsx`
- Modify: `frontend/src/features/analytics/ThemeTrendChart.tsx`

**Step 1: Add source donut chart to `OverviewPage.tsx`**

Import Recharts components at the top:

```tsx
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts"
```

Add the donut chart component inside `OverviewPage`:

```tsx
const COLORS = ["#3b82f6", "#14b8a6", "#f59e0b", "#a855f7", "#22c55e", "#ef4444", "#6366f1"]

function SourceDonut({ sourceMix }: { sourceMix: { source_type: string; count: number }[] }) {
  if (!sourceMix?.length) return null
  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5">
      <p className="text-sm font-medium text-text-primary mb-4">Items by Source</p>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={sourceMix}
            dataKey="count"
            nameKey="source_type"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={80}
            paddingAngle={2}
          >
            {sourceMix.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: "#0f1520", border: "1px solid #1e2d42", borderRadius: 8, fontSize: 12 }}
            formatter={(v: number, name: string) => [v, name]}
          />
          <Legend
            formatter={(v) => <span style={{ color: "#8da4c0", fontSize: 11 }}>{v}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
```

Render `<SourceDonut sourceMix={stats?.source_mix ?? []} />` in the overview layout alongside the trend chart.

**Step 2: Add Recent Runs panel**

```tsx
function RecentRuns({ runs }: { runs: { id: number; started_at: string; finished_at?: string; status: string; notes?: Record<string, unknown> }[] }) {
  if (!runs?.length) return null
  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5">
      <p className="text-sm font-medium text-text-primary mb-3">Recent Runs</p>
      <div className="space-y-2">
        {runs.slice(0, 5).map((run) => {
          const duration = run.finished_at
            ? Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)
            : null
          const notes = run.notes as Record<string, { items_added?: number }> | undefined
          const totalAdded = notes
            ? Object.values(notes).reduce((sum, v) => sum + (v?.items_added ?? 0), 0)
            : 0
          return (
            <div key={run.id} className="flex items-center gap-3 text-xs">
              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", run.status === "success" ? "bg-green" : "bg-red")} />
              <span className="text-text-muted font-mono w-32 shrink-0">{run.started_at.slice(0, 16).replace("T", " ")}</span>
              <span className="text-text-secondary">{totalAdded} items added</span>
              {duration && <span className="text-text-muted ml-auto">{duration}s</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

Fetch runs in `OverviewPage`:
```tsx
const { data: runs } = useQuery({ queryKey: ["runs"], queryFn: () => api.runs(5), staleTime: 60_000 })
```

Render `<RecentRuns runs={runs ?? []} />` below the donut chart.

**Step 3: Add chart view toggle to `ThemeTrendChart.tsx`**

Add a toggle button above the chart:
```tsx
type ChartView = "theme" | "source"
const [view, setView] = useState<ChartView>("theme")
```

When `view === "source"`, render series from `stats.source_mix` data instead of theme data. The toggle renders:

```tsx
<div className="flex gap-1 text-xs">
  {(["theme", "source"] as ChartView[]).map((v) => (
    <button key={v} onClick={() => setView(v)}
      className={cn("px-2 py-1 rounded transition-colors capitalize", view === v ? "bg-bg-elevated text-text-primary" : "text-text-muted hover:text-text-primary")}
    >{v}</button>
  ))}
</div>
```

**Step 4: Commit**

```bash
cd frontend && npm run build 2>&1 | tail -5 && cd ..
git add frontend/src/features/overview/ frontend/src/features/analytics/ThemeTrendChart.tsx
git commit -m "feat: source donut chart, recent runs panel, chart view toggle on overview"
```

---

## Task 14: View transitions + scroll restoration

**Files:**
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/hooks/useScrollRestoration.ts`

**Step 1: Create `useScrollRestoration.ts`**

```typescript
import { useEffect, useRef } from "react"
import type { ActiveView } from "../store"

const scrollPositions = new Map<ActiveView, number>()

export function useScrollRestoration(view: ActiveView) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // Restore
    const saved = scrollPositions.get(view) ?? 0
    el.scrollTop = saved
    // Save on scroll
    function onScroll() { scrollPositions.set(view, el!.scrollTop) }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [view])

  return containerRef
}
```

**Step 2: Add fade transition to `App.tsx`**

In `App.tsx`, wrap the active view render in a keyed div with CSS opacity transition:

```tsx
// Add to index.css:
// .view-enter { animation: viewFade 150ms ease both; }
// @keyframes viewFade { from { opacity: 0; } to { opacity: 1; } }

// In App.tsx:
<div key={activeView} className="view-enter">
  {/* current view component */}
</div>
```

Add to `index.css`:
```css
.view-enter {
  animation: viewFade 150ms ease both;
}
@keyframes viewFade {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

**Step 3: Commit**

```bash
cd frontend && npm run build 2>&1 | tail -5 && cd ..
git add frontend/src/App.tsx frontend/src/hooks/useScrollRestoration.ts frontend/src/index.css
git commit -m "feat: view fade transitions and scroll restoration"
```

---

## Task 15: Build frontend and deploy

**Step 1: Full production build**

```bash
cd frontend && npm run build
```
Expected: build succeeds, output in `../app/static/dist/`

**Step 2: Smoke test with backend**

```bash
cd ..
uvicorn app.main:app --port 8000
```
Open browser: http://localhost:8000 — verify:
- Sidebar shows grouped sections (Research / Media / AI)
- Sidebar collapse button works
- Crawl footer shows last run time and Run Now button
- Items feed shows filter chips when filters active
- Clicking an item opens the drawer
- J/K keys navigate items
- Images page shows "No screenshots yet" with Capture Now button
- Overview shows source donut and recent runs

**Step 3: Final commit**

```bash
git add app/static/dist/
git commit -m "build: rebuild frontend with all UI/UX and screenshot pipeline features"
```

---

## Summary

| Task | What it does |
|------|-------------|
| 1 | `screenshots` DB table + methods |
| 2 | Playwright screenshot collector (`app/sources/screenshot.py`) |
| 3 | `/api/screenshots` REST endpoints |
| 4 | Wire screenshot job to APScheduler |
| 5 | Store: `selectedItemId`, toasts, `sidebarCollapsed` |
| 6 | Sidebar: grouped sections, collapse, crawl footer |
| 7 | Toast system |
| 8 | `ItemDrawer`: slide-in panel, actions, keyboard close |
| 9 | Filter chips, presets, density toggle, keyboard nav |
| 10 | SourceCard: source icon, score bar |
| 11 | API client: screenshot types + endpoints |
| 12 | MediaPage: full replacement with screenshot gallery |
| 13 | Overview: source donut, recent runs panel, chart toggle |
| 14 | View transitions + scroll restoration |
| 15 | Build + smoke test |
