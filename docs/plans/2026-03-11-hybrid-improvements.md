# Hybrid Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 22 independent improvements spanning power-user workflow, analytics interactivity, UI polish, and backend capabilities.

**Architecture:** FastAPI backend + React/Vite SPA. All tasks are frontend-only except tasks 1, 2, and 20 which touch backend. Tasks 1 and 2 bundle backend+frontend together. No shared state across tasks.

**Tech Stack:** FastAPI, SQLite (`app/db.py`), React 19, TanStack Query v5, Zustand (`frontend/src/store.ts`), Tailwind CSS v4, Recharts, D3 v7, TypeScript.

---

## Task 1: Export endpoint + Export button in ItemsPage

**Files:**
- Create: `app/api/export.py`
- Modify: `app/main.py` (register router)
- Modify: `frontend/src/lib/api.ts` (add `exportItems` fn)
- Modify: `frontend/src/features/items/ItemsPage.tsx` (add export button)

**Context:**
- `app/db.py` has `browse_items(...)` that returns `{"items": [...], "total": ..., "offset": ..., "limit": ...}`
- `browse_items` accepts: `limit`, `offset`, `theme`, `source_type`, `review_status`, `saved_only`, `search`, `sort`, `compound`, `mechanism`
- `app/main.py` registers routers via `app.include_router(...)`
- `frontend/src/features/items/ItemsPage.tsx` has a `FiltersBar` and `BulkBar` already; add export button in the toolbar row

**Step 1: Create `app/api/export.py`**

```python
from __future__ import annotations

import csv
import io
import json

from fastapi import APIRouter, Query
from fastapi.responses import Response

router = APIRouter(prefix="/api/export", tags=["export"])


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
    result = db.browse_items(
        limit=5000, offset=0, theme=theme, source_type=source_type,
        review_status=review_status, saved_only=saved_only,
        search=search, sort=sort, compound=compound, mechanism=mechanism,
    )
    items = result["items"]
    if not items:
        return Response(content="", media_type="text/csv")

    fields = ["id", "title", "url", "author", "published_at", "source_type",
              "theme", "score", "review_status", "is_saved", "compounds",
              "mechanisms", "summary"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    for item in items:
        row = {k: item.get(k, "") for k in fields}
        row["compounds"] = "; ".join(item.get("compounds") or [])
        row["mechanisms"] = "; ".join(item.get("mechanisms") or [])
        w.writerow(row)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=items.csv"},
    )


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
    result = db.browse_items(
        limit=5000, offset=0, theme=theme, source_type=source_type,
        review_status=review_status, saved_only=saved_only,
        search=search, sort=sort, compound=compound, mechanism=mechanism,
    )
    return Response(
        content=json.dumps(result["items"], default=str),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=items.json"},
    )
```

**Step 2: Register router in `app/main.py`**

Find the block where other routers are included (e.g. `from app.api.items import router`) and add:

```python
from app.api.export import router as export_router
# ...
app.include_router(export_router)
```

**Step 3: Add `exportItems` to `frontend/src/lib/api.ts`**

Add at the end of the `api` object:

```typescript
exportItemsUrl: (format: 'csv' | 'json', params?: Record<string, string | number | boolean>) => {
  const qs = new URLSearchParams(
    Object.entries(params ?? {})
      .filter(([, v]) => v !== '' && v !== false && v !== undefined)
      .map(([k, v]) => [k, String(v)])
  ).toString()
  return `/api/export/items.${format}${qs ? `?${qs}` : ''}`
},
```

**Step 4: Add Export button to `frontend/src/features/items/ItemsPage.tsx`**

Find the toolbar row (where density buttons and BulkBar sit). Add an export dropdown next to those controls:

```tsx
// At top of file, add import:
import { api } from '@/lib/api'

// Inside ItemsPage, near density controls, add:
function ExportMenu({ filters }: { filters: import('@/store').Filters }) {
  const [open, setOpen] = useState(false)
  const params = {
    ...(filters.theme && { theme: filters.theme }),
    ...(filters.sourceType && { source_type: filters.sourceType }),
    ...(filters.reviewStatus && { review_status: filters.reviewStatus }),
    ...(filters.savedOnly && { saved_only: true }),
    ...(filters.search && { search: filters.search }),
    ...(filters.sort && { sort: filters.sort }),
    ...(filters.compound && { compound: filters.compound }),
    ...(filters.mechanism && { mechanism: filters.mechanism }),
  }
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-bg-subtle border border-border text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors"
        aria-label="Export items"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[130px] rounded-lg border border-border bg-bg-surface shadow-lg py-1">
          <a
            href={api.exportItemsUrl('csv', params)}
            download
            className="block px-4 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-subtle transition-colors"
            onClick={() => setOpen(false)}
          >
            Export CSV
          </a>
          <a
            href={api.exportItemsUrl('json', params)}
            download
            className="block px-4 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-subtle transition-colors"
            onClick={() => setOpen(false)}
          >
            Export JSON
          </a>
        </div>
      )}
    </div>
  )
}
```

Wire `filters` from `useAppStore((s) => s.filters)` and render `<ExportMenu filters={filters} />` in the toolbar row.

**Step 5: Commit**
```bash
git add app/api/export.py app/main.py frontend/src/lib/api.ts frontend/src/features/items/ItemsPage.tsx
git commit -m "feat: CSV/JSON export endpoint + export button in ItemsPage"
```

---

## Task 2: Hypotheses pagination API + HypothesesPage filter bar

**Files:**
- Modify: `app/api/hypotheses.py` (add browse endpoint with filters)
- Modify: `app/db.py` (add `browse_hypotheses` method)
- Modify: `frontend/src/lib/api.ts` (add `browseHypotheses`)
- Modify: `frontend/src/features/hypotheses/HypothesesPage.tsx` (add filter bar + paginate)

**Context:**
- `app/db.py` has existing `get_recent_hypotheses(limit)` — add `browse_hypotheses` alongside it
- The hypotheses table columns include: `id`, `theme`, `title`, `body`, `rationale`, `evidence`, `review_status`, `is_saved`, `created_at`
- HypothesesPage currently calls `useHypotheses()` which hits `/api/hypotheses?limit=N`
- Add a new hook `useBrowseHypotheses(params)` that uses TanStack Query

**Step 1: Add `browse_hypotheses` to `app/db.py`**

Find the class that contains `get_recent_hypotheses` and add:

```python
def browse_hypotheses(
    self,
    limit: int = 24,
    offset: int = 0,
    theme: str | None = None,
    review_status: str | None = None,
    search: str = "",
    saved_only: bool = False,
) -> dict:
    conn = self._conn()
    conditions = []
    params: list = []
    if theme:
        conditions.append("theme = ?")
        params.append(theme)
    if review_status:
        conditions.append("review_status = ?")
        params.append(review_status)
    if search:
        conditions.append("(title LIKE ? OR body LIKE ? OR rationale LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like, like])
    if saved_only:
        conditions.append("is_saved = 1")
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    total = conn.execute(
        f"SELECT COUNT(*) FROM hypotheses {where}", params
    ).fetchone()[0]
    rows = conn.execute(
        f"SELECT * FROM hypotheses {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        params + [limit, offset],
    ).fetchall()
    cols = [d[0] for d in conn.execute("SELECT * FROM hypotheses LIMIT 0").description]
    hypotheses = []
    for row in rows:
        h = dict(zip(cols, row))
        h["is_saved"] = bool(h.get("is_saved"))
        hypotheses.append(h)
    return {"hypotheses": hypotheses, "total": total, "offset": offset, "limit": limit}
```

**Step 2: Add browse endpoint to `app/api/hypotheses.py`**

```python
browse_router = APIRouter(prefix="/api/browse", tags=["hypotheses"])

@browse_router.get("/hypotheses")
def browse_hypotheses(
    theme: str | None = Query(default=None),
    review_status: str | None = Query(default=None),
    search: str = Query(default=""),
    saved_only: bool = Query(default=False),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=24, ge=1, le=100),
) -> JSONResponse:
    from app.main import db
    return JSONResponse(db.browse_hypotheses(
        limit=limit, offset=offset, theme=theme,
        review_status=review_status, search=search, saved_only=saved_only,
    ))
```

Then in `app/main.py`, import and include `browse_router` from `app.api.hypotheses`.

**Step 3: Add types + API fn to `frontend/src/lib/api.ts`**

```typescript
export interface BrowseHypothesesPayload {
  hypotheses: Hypothesis[]
  total: number
  offset: number
  limit: number
}

// inside api object:
browseHypotheses: (params?: Record<string, string | number | boolean>) =>
  apiFetch<BrowseHypothesesPayload>(
    `/api/browse/hypotheses?${new URLSearchParams(
      Object.entries(params ?? {})
        .filter(([, v]) => v !== '' && v !== false && v !== undefined)
        .map(([k, v]) => [k, String(v)])
    )}`
  ),
```

**Step 4: Add `useBrowseHypotheses` hook in `frontend/src/hooks/useHypotheses.ts`**

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useBrowseHypotheses(params: Record<string, string | number | boolean>) {
  return useQuery({
    queryKey: ['browseHypotheses', params],
    queryFn: () => api.browseHypotheses(params),
    staleTime: 30_000,
  })
}
```

Export from `frontend/src/hooks/index.ts`.

**Step 5: Update `HypothesesPage.tsx`**

Add state for `search`, `theme`, `reviewStatus` (local state, not global filters — hypotheses have their own filter space). Replace `useHypotheses()` with `useBrowseHypotheses`. Add a filter bar above the content:

```tsx
// Filter bar component inside HypothesesPage.tsx:
function HypothesesFilters({ search, setSearch, theme, setTheme, reviewStatus, setReviewStatus, themes }: {
  search: string; setSearch: (v: string) => void
  theme: string; setTheme: (v: string) => void
  reviewStatus: string; setReviewStatus: (v: string) => void
  themes: string[]
}) {
  const ctrl = "px-3 py-2 bg-bg-subtle border border-border rounded-lg text-sm text-text-secondary focus:outline-none focus:border-accent/50"
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <input
        type="search"
        placeholder="Search hypotheses…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={`${ctrl} flex-1 min-w-48 text-text-primary placeholder:text-text-muted`}
      />
      <select value={theme} onChange={(e) => setTheme(e.target.value)} className={ctrl} aria-label="Theme filter">
        <option value="">All themes</option>
        {themes.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)} className={ctrl} aria-label="Status filter">
        <option value="">All statuses</option>
        {['new','reviewing','promoted','dismissed'].map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  )
}
```

Wire up pagination with `offset` state and `total` from the response. Show a simple "Load more" button at the bottom (increment offset by 24).

**Step 6: Commit**
```bash
git add app/db.py app/api/hypotheses.py app/main.py frontend/src/lib/api.ts frontend/src/hooks/useHypotheses.ts frontend/src/features/hypotheses/HypothesesPage.tsx
git commit -m "feat: hypotheses browse API with filters + HypothesesPage filter bar + pagination"
```

---

## Task 3: j/k keyboard navigation in ItemsPage

**Files:**
- Modify: `frontend/src/features/items/ItemsPage.tsx`

**Context:**
- ItemsPage renders a list of `<SourceCard>` items. The `selectedItemId` in Zustand store drives the `<ItemDrawer>`.
- `useAppStore((s) => s.setSelectedItemId)` opens the drawer for an item.
- Items are fetched via `useBrowseItems` returning `{ items: ResearchItem[] }`.
- Hook into `keydown` on `document` with a `useEffect`. Only activate when `commandPaletteOpen` is false and no input is focused.

**Step 1: Add keyboard nav to `ItemsPage.tsx`**

```tsx
// Inside ItemsPage component, after items are fetched:
const items = data?.pages.flatMap((p) => p.items) ?? []
const selectedItemId = useAppStore((s) => s.selectedItemId)
const setSelectedItemId = useAppStore((s) => s.setSelectedItemId)
const commandPaletteOpen = useAppStore((s) => s.commandPaletteOpen)

useEffect(() => {
  function onKey(e: KeyboardEvent) {
    // Ignore when typing in inputs/textareas or command palette open
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (commandPaletteOpen) return
    if (e.key !== 'j' && e.key !== 'k' && e.key !== 'Escape') return
    e.preventDefault()

    if (e.key === 'Escape') {
      setSelectedItemId(null)
      return
    }
    const currentIndex = items.findIndex((it) => it.id === selectedItemId)
    if (e.key === 'j') {
      const next = currentIndex < items.length - 1 ? items[currentIndex + 1] : items[0]
      setSelectedItemId(next?.id ?? null)
    } else {
      const prev = currentIndex > 0 ? items[currentIndex - 1] : items[items.length - 1]
      setSelectedItemId(prev?.id ?? null)
    }
  }
  document.addEventListener('keydown', onKey)
  return () => document.removeEventListener('keydown', onKey)
}, [items, selectedItemId, setSelectedItemId, commandPaletteOpen])
```

Also add a small hint label near the TopBar or FiltersBar: `<span className="text-xs text-text-muted hidden md:inline">j/k to navigate</span>`.

**Step 2: Auto-scroll selected card into view**

```tsx
// Add a ref to the selected card in SourceCard or use a data attribute in ItemsPage:
useEffect(() => {
  if (selectedItemId == null) return
  const el = document.querySelector(`[data-item-id="${selectedItemId}"]`)
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}, [selectedItemId])
```

In `SourceCard`, add `data-item-id={item.id}` to the root element.

**Step 3: Commit**
```bash
git add frontend/src/features/items/ItemsPage.tsx frontend/src/features/items/SourceCard.tsx
git commit -m "feat: j/k keyboard navigation through items list"
```

---

## Task 4: ItemDrawer — Related Items section

**Files:**
- Modify: `frontend/src/features/items/ItemDrawer.tsx`
- Modify: `frontend/src/lib/api.ts` (add relatedItems fn)

**Context:**
- ItemDrawer shows detail for a `ResearchItem` (fetched via `api.item(id)`).
- "Related" = same theme OR overlapping compounds/mechanisms, excluding the current item.
- Use existing `api.browseItems` with `theme` param and `limit=6`, filter out the current item client-side.
- Render at the bottom of the drawer as a horizontal scroll row of small cards.

**Step 1: Add `relatedItems` helper to `frontend/src/lib/api.ts`**

```typescript
relatedItems: (item: ResearchItem, limit = 6) => {
  const params: Record<string, string | number> = { limit: limit + 1, offset: 0 }
  if (item.theme) params.theme = item.theme
  return apiFetch<BrowseItemsPayload>(
    `/api/browse/items?${new URLSearchParams(Object.entries(params).map(([k,v]) => [k, String(v)]))}`,
  ).then((r) => ({ ...r, items: r.items.filter((i) => i.id !== item.id).slice(0, limit) }))
},
```

**Step 2: Add Related Items section to `ItemDrawer.tsx`**

```tsx
// At bottom of ItemDrawer, after the notes section:
function RelatedItems({ item }: { item: ResearchItem }) {
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId)
  const { data } = useQuery({
    queryKey: ['relatedItems', item.id, item.theme],
    queryFn: () => api.relatedItems(item),
    enabled: !!item.theme,
    staleTime: 60_000,
  })
  const related = data?.items ?? []
  if (!related.length) return null

  return (
    <div className="mt-6">
      <h4 className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-3">Related Items</h4>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
        {related.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelectedItemId(r.id)}
            className="flex-shrink-0 w-56 text-left rounded-lg border border-border bg-bg-subtle p-3 hover:border-accent/40 transition-colors"
          >
            <p className="text-xs font-medium text-text-primary line-clamp-2 mb-1">{r.title}</p>
            <p className="text-[10px] text-text-muted">{r.source_type} · {r.theme}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
```

Add `<RelatedItems item={item} />` at the end of the drawer content, after notes/tags sections.

**Step 3: Commit**
```bash
git add frontend/src/features/items/ItemDrawer.tsx frontend/src/lib/api.ts
git commit -m "feat: related items section in ItemDrawer"
```

---

## Task 5: CommandPalette — Crawl trigger action + recent items section

**Files:**
- Modify: `frontend/src/components/CommandPalette.tsx`

**Context:**
- CommandPalette already has search results from `api.search(q)`. It opens with `⌘K`.
- When query is empty, show "Actions" section with quick actions.
- Add: "Trigger Crawl" action (calls `api.triggerCrawl()`), "Trigger Screenshot Capture" (calls `api.triggerCapture()`).
- Also add: when query is empty, show last 5 items from `useDashboard().data.items` as "Recent Items".
- Style sections with a label row between them.

**Step 1: Modify CommandPalette to add actions when query is empty**

```tsx
// Inside CommandPalette, after existing search results logic:
const { data: dashboard } = useDashboard()
const addToast = useAppStore((s) => s.addToast)
const setCrawlRunning = useAppStore((s) => s.setCrawlRunning)

const recentItems = (dashboard?.items ?? []).slice(0, 5)

async function handleTriggerCrawl() {
  close()
  try {
    await api.triggerCrawl()
    setCrawlRunning(true)
    addToast('Crawl started', 'success')
  } catch {
    addToast('Failed to start crawl', 'error')
  }
}

// In the render, when `query === ''`:
// Show "Actions" section then "Recent Items" section
```

**Step 2: Render structure when query is empty**

```tsx
{query === '' && (
  <>
    <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-muted border-b border-border">
      Actions
    </div>
    <ul>
      {[
        { label: '▶ Trigger Crawl', action: handleTriggerCrawl, icon: '🔄' },
        { label: '📸 Capture Screenshots', action: async () => { close(); await api.triggerCapture(); addToast('Capture started') }, icon: null },
      ].map((a) => (
        <li key={a.label}>
          <button
            onClick={a.action}
            className="w-full text-left px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-subtle hover:text-text-primary transition-colors flex items-center gap-3"
          >
            {a.label}
          </button>
        </li>
      ))}
    </ul>
    {recentItems.length > 0 && (
      <>
        <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-muted border-b border-border">
          Recent Items
        </div>
        <ul>
          {recentItems.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => { close(); setActiveView('items'); setSelectedItemId(item.id) }}
                className="w-full text-left px-4 py-2.5 text-sm text-text-primary hover:bg-bg-subtle transition-colors"
              >
                <span className="truncate block">{item.title}</span>
                <span className="text-[10px] text-text-muted">{item.source_type} · {item.theme}</span>
              </button>
            </li>
          ))}
        </ul>
      </>
    )}
  </>
)}
```

**Step 3: Commit**
```bash
git add frontend/src/components/CommandPalette.tsx
git commit -m "feat: CommandPalette actions (crawl trigger, screenshot) + recent items when empty"
```

---

## Task 6: OverviewPage pie/bar chart click-through to Items

**Files:**
- Modify: `frontend/src/features/overview/OverviewPage.tsx`

**Context:**
- OverviewPage has a PieChart (source mix) and BarCharts (top compounds, top mechanisms).
- `recharts` `Cell` supports `onClick`. `Bar` supports `onClick`.
- On click: call `resetFilters()`, then `setFilter('sourceType', name)` / `setFilter('compound', name)` / `setFilter('mechanism', name)`, then `setActiveView('items')`.

**Step 1: Add click handlers to PieChart Cells**

```tsx
// In SourceMixPie (or wherever the pie is):
const setActiveView = useAppStore((s) => s.setActiveView)
const setFilter = useAppStore((s) => s.setFilter)
const resetFilters = useAppStore((s) => s.resetFilters)

// In <Cell> props:
onClick={() => {
  resetFilters()
  setFilter('sourceType', entry.name)
  setActiveView('items')
}}
style={{ cursor: 'pointer' }}
```

**Step 2: Add click handlers to Bar charts**

```tsx
// In TopCompoundsBar and TopMechanismsBar:
<Bar
  dataKey="count"
  onClick={(data: { name: string }) => {
    resetFilters()
    setFilter(isCompound ? 'compound' : 'mechanism', data.name)
    setActiveView('items')
  }}
  style={{ cursor: 'pointer' }}
/>
```

**Step 3: Add a cursor tooltip hint**

On each chart container, add `title="Click to filter items"` or a small `ℹ️` label.

**Step 4: Commit**
```bash
git add frontend/src/features/overview/OverviewPage.tsx
git commit -m "feat: OverviewPage chart click-through to Items with filter pre-filled"
```

---

## Task 7: OverviewPage — live SSE activity feed

**Files:**
- Modify: `frontend/src/features/overview/OverviewPage.tsx`

**Context:**
- There is `/api/activity` endpoint that returns `ActivityEvent[]` (recent items/hypotheses/screenshots).
- Currently fetched via `useQuery`. Replace with an EventSource that polls `/api/activity` via SSE — OR keep the polling query but reduce staleTime and add a "live" indicator.
- Simplest approach: keep `useQuery` but use `refetchInterval: 15_000` when `dashboard?.is_running` is true, and 60_000 otherwise.
- Add a pulsing green dot "LIVE" badge when crawl is running.

**Step 1: Update activity query to auto-refetch**

```tsx
// In OverviewPage or a useActivity hook:
const { data: dashboard } = useDashboard()
const isRunning = dashboard?.is_running ?? false

const { data: activity } = useQuery({
  queryKey: ['activity'],
  queryFn: () => api.activity(),
  staleTime: isRunning ? 10_000 : 60_000,
  refetchInterval: isRunning ? 15_000 : false,
})
```

**Step 2: Add "LIVE" badge**

```tsx
{isRunning && (
  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-green-400 bg-green-400/10 border border-green-400/30 px-2 py-0.5 rounded-full">
    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
    Live
  </span>
)}
```

Place this next to the "Recent Activity" section heading.

**Step 3: Commit**
```bash
git add frontend/src/features/overview/OverviewPage.tsx
git commit -m "feat: live activity feed badge + auto-refresh when crawl running"
```

---

## Task 8: Dashboard auto-refresh while crawl running

**Files:**
- Modify: `frontend/src/hooks/useDashboard.ts`

**Context:**
- `useDashboard` wraps a `useQuery` on `/api/dashboard`.
- When `data?.is_running` is true, we want to refetch frequently (every 10s) so stats update.
- After crawl finishes, `is_running` becomes false and we back off.

**Step 1: Update `useDashboard.ts`**

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useDashboard() {
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard,
    staleTime: 30_000,
    refetchInterval: (data) => {
      // data here is the query data
      const d = data?.state?.data as Awaited<ReturnType<typeof api.dashboard>> | undefined
      return d?.is_running ? 10_000 : 60_000
    },
  })
  return query
}
```

Note: TanStack Query v5 `refetchInterval` can be a function receiving `{ state }`. Check the signature — in v5 it's `refetchInterval: (query) => number | false`. Use:

```typescript
refetchInterval: (query) => (query.state.data?.is_running ? 10_000 : 60_000),
```

**Step 2: Commit**
```bash
git add frontend/src/hooks/useDashboard.ts
git commit -m "feat: dashboard auto-refetch every 10s while crawl running"
```

---

## Task 9: Sidebar nav item/hypothesis counts

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`

**Context:**
- Sidebar renders nav items from `RESEARCH_ITEMS`, `MEDIA_ITEMS`, `AI_ITEMS`, `SETTINGS_ITEMS`.
- `useDashboard()` already imported in Sidebar. Stats are in `dashboard?.stats.totals`.
- Show small count pill next to "Items" label and "Hypotheses" label when not collapsed.
- Counts: `totals.item_count` for Items, `totals.hypothesis_count` for Hypotheses.

**Step 1: Add count badges to nav labels in `Sidebar.tsx`**

```tsx
// In NavGroup or individual nav item render, pass counts:
const COUNT_MAP: Partial<Record<ActiveView, number>> = {
  items: dashboard?.stats?.totals?.item_count,
  hypotheses: dashboard?.stats?.totals?.hypothesis_count,
  images: dashboard?.stats?.totals?.image_count,
}

// In the NavItem render, after the label text:
{!collapsed && COUNT_MAP[item.id] != null && COUNT_MAP[item.id]! > 0 && (
  <span className="ml-auto text-[10px] font-mono bg-bg-subtle text-text-muted rounded-full px-1.5 min-w-[20px] text-center">
    {COUNT_MAP[item.id]! >= 1000 ? `${Math.floor(COUNT_MAP[item.id]! / 1000)}k` : COUNT_MAP[item.id]}
  </span>
)}
```

**Step 2: Commit**
```bash
git add frontend/src/components/Sidebar.tsx
git commit -m "feat: sidebar shows item/hypothesis/image counts"
```

---

## Task 10: GraphPage node click → filter Items view

**Files:**
- Modify: `frontend/src/features/graphs/CompoundGraph.tsx`

**Context:**
- CompoundGraph renders a D3 force simulation. Nodes have `type: 'compound' | 'mechanism' | 'theme'` and `label: string`.
- Currently clicking a node does nothing (or shows a tooltip).
- On click: navigate to Items view with `compound` or `mechanism` filter pre-filled.
- Use `useAppStore.getState()` inside the D3 click handler (event handler context, not render).

**Step 1: Add click handler to D3 node in `CompoundGraph.tsx`**

Find the D3 node selection (likely `.on('click', ...)` or inside a `useEffect`). Add:

```typescript
// Inside the D3 useEffect, on the node <g> selection:
nodeSelection.on('click', (_event: MouseEvent, d: SimNode) => {
  const { resetFilters, setFilter, setActiveView } = useAppStore.getState()
  resetFilters()
  if (d.type === 'compound') setFilter('compound', d.label)
  else if (d.type === 'mechanism') setFilter('mechanism', d.label)
  else if (d.type === 'theme') setFilter('theme', d.label)
  setActiveView('items')
})
```

Also change cursor to `pointer` on nodes: `nodeSelection.style('cursor', 'pointer')`.

**Step 2: Add a tooltip hint**

In the legend/info area of GraphPage, add: `<p className="text-xs text-text-muted">Click a node to filter items</p>`.

**Step 3: Commit**
```bash
git add frontend/src/features/graphs/CompoundGraph.tsx frontend/src/features/graphs/GraphPage.tsx
git commit -m "feat: click graph node to filter Items view by compound/mechanism/theme"
```

---

## Task 11: ThemeTrendChart click → date-filter items

**Files:**
- Modify: `frontend/src/features/analytics/ThemeTrendChart.tsx`
- Modify: `frontend/src/store.ts` (add `dateFrom`/`dateTo` filters)
- Modify: `frontend/src/lib/api.ts` (pass date params to browseItems)
- Modify: `app/api/items.py` (accept `date_from`/`date_to` query params)
- Modify: `app/db.py` (filter by date in `browse_items`)

**Context:**
- ThemeTrendChart shows a line chart of items per theme over time.
- Clicking a data point should set a date filter (± 3 days around that date) and navigate to Items.
- `dates` in `TrendsPayload` are ISO date strings like `"2026-02-10"`.

**Step 1: Add `dateFrom`/`dateTo` to Zustand filters**

In `frontend/src/store.ts`:
```typescript
// In Filters interface:
dateFrom: string
dateTo: string

// In DEFAULT_FILTERS:
dateFrom: '',
dateTo: '',
```

**Step 2: Pass date params in `browseItems` API call**

In `frontend/src/lib/api.ts`, `browseItems` already passes all params. Since it uses `Object.entries(params ?? {})`, just pass `date_from`/`date_to` in the params object from the hook.

**Step 3: Add date filter to `app/db.py` `browse_items`**

```python
def browse_items(self, ..., date_from: str | None = None, date_to: str | None = None, ...) -> dict:
    # In conditions:
    if date_from:
        conditions.append("(published_at >= ? OR created_at >= ?)")
        params.extend([date_from, date_from])
    if date_to:
        conditions.append("(published_at <= ? OR created_at <= ?)")
        params.extend([date_to, date_to])
```

**Step 4: Add `date_from`/`date_to` to `app/api/items.py` browse endpoint**

```python
date_from: str | None = Query(default=None),
date_to: str | None = Query(default=None),
```

Pass to `db.browse_items(...)`.

**Step 5: Add click handler to ThemeTrendChart**

```tsx
// In ThemeTrendChart, on the <LineChart> or individual points:
// Use recharts CustomDot or onClick on <Line>
// recharts supports onClick on the chart itself via the <LineChart onClick={...}> prop
// which receives the chart event with activePayload and activeLabel (the date string).

<LineChart
  onClick={(chartData) => {
    if (!chartData?.activeLabel) return
    const date = chartData.activeLabel as string
    // Set ±3 day window
    const from = new Date(date)
    from.setDate(from.getDate() - 3)
    const to = new Date(date)
    to.setDate(to.getDate() + 3)
    const { resetFilters, setFilter, setActiveView } = useAppStore.getState()
    // Note: call from event handler so getState() is fine
    resetFilters()
    setFilter('dateFrom', from.toISOString().slice(0, 10))
    setFilter('dateTo', to.toISOString().slice(0, 10))
    setActiveView('items')
  }}
  style={{ cursor: 'crosshair' }}
>
```

**Step 6: Show active date filters in FiltersBar**

In `frontend/src/features/items/FiltersBar.tsx`, add chips for `dateFrom`/`dateTo` if set, and date range inputs optionally:

```tsx
{filters.dateFrom && (
  <span className="...chip...">
    From: {filters.dateFrom}
    <button onClick={() => setFilter('dateFrom', '')}>×</button>
  </span>
)}
```

**Step 7: Commit**
```bash
git add frontend/src/store.ts frontend/src/lib/api.ts frontend/src/features/analytics/ThemeTrendChart.tsx frontend/src/features/items/FiltersBar.tsx app/api/items.py app/db.py
git commit -m "feat: ThemeTrendChart click sets date filter + Items date range filtering"
```

---

## Task 12: Search term highlighting in SourceCard

**Files:**
- Modify: `frontend/src/features/items/SourceCard.tsx`

**Context:**
- SourceCard renders `item.title` and `item.summary`. When `filters.search` is non-empty, highlight matching substrings.
- Use a simple `highlightText(text, query)` function that returns an array of `{ text, highlight }` segments.
- Render as `<span>` with `className="bg-accent/20 text-accent rounded"` on highlighted parts.

**Step 1: Add `highlightText` utility in SourceCard.tsx**

```tsx
function highlightText(text: string, query: string): Array<{ text: string; highlight: boolean }> {
  if (!query.trim()) return [{ text, highlight: false }]
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(regex)
  return parts.map((part) => ({
    text: part,
    highlight: regex.test(part),
  }))
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const parts = highlightText(text, query)
  return (
    <>
      {parts.map((part, i) =>
        part.highlight ? (
          <mark key={i} className="bg-accent/20 text-accent rounded-sm not-italic">{part.text}</mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  )
}
```

**Step 2: Use `Highlighted` in SourceCard for title and summary**

SourceCard receives the item but not the search query. Add `searchQuery?: string` to SourceCard props, or read it from the store:

```tsx
const searchQuery = useAppStore((s) => s.filters.search)

// Replace static title render:
<h3 className="...">{item.title}</h3>
// With:
<h3 className="..."><Highlighted text={item.title} query={searchQuery} /></h3>

// Same for summary snippet:
<p className="..."><Highlighted text={item.summary?.slice(0, 200) ?? ''} query={searchQuery} /></p>
```

**Step 3: Commit**
```bash
git add frontend/src/features/items/SourceCard.tsx
git commit -m "feat: highlight search terms in SourceCard title and summary"
```

---

## Task 13: HypothesisCard expand/collapse animation

**Files:**
- Modify: `frontend/src/features/hypotheses/HypothesisCard.tsx`

**Context:**
- HypothesisCard renders a card with `title`, `rationale`, and `body` (markdown). Currently body is always visible.
- Add a collapsible body section: show first ~3 lines by default, expand on click with smooth CSS transition.
- Use `max-height` transition with `overflow: hidden`.

**Step 1: Add expand state and CSS transition**

```tsx
// In HypothesisCard component:
const [expanded, setExpanded] = useState(false)

// Wrap body/evidence in collapsible container:
<div
  className={cn(
    "overflow-hidden transition-all duration-300 ease-in-out",
    expanded ? "max-h-[2000px]" : "max-h-24"
  )}
>
  {/* markdown body render */}
</div>

// Below the collapsed section:
<button
  onClick={() => setExpanded((e) => !e)}
  className="mt-1 text-xs text-accent hover:text-accent/80 transition-colors"
  aria-expanded={expanded}
>
  {expanded ? '▲ Show less' : '▼ Show more'}
</button>
```

**Step 2: Only show toggle when body is long**

```tsx
const bodyIsLong = (hypothesis.body?.length ?? 0) > 300
// Only render the toggle button when bodyIsLong
```

**Step 3: Commit**
```bash
git add frontend/src/features/hypotheses/HypothesisCard.tsx
git commit -m "feat: HypothesisCard expand/collapse body with smooth animation"
```

---

## Task 14: MediaPage download button on images

**Files:**
- Modify: `frontend/src/features/images/ImageCard.tsx`
- Modify: `frontend/src/features/images/Lightbox.tsx`

**Context:**
- ImageCard renders a thumbnail in the masonry grid. `image.local_url` or `image.image_url` is the full-res URL.
- Add a download button that appears on hover (absolute positioned top-right corner).
- Also add to the Lightbox toolbar.

**Step 1: Add hover download button to `ImageCard.tsx`**

```tsx
// Wrap the image in a group div (add `group` class to outer container):
<div className="relative group">
  <img src={...} />
  <a
    href={image.local_url || image.image_url}
    download
    onClick={(e) => e.stopPropagation()}
    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white"
    aria-label="Download image"
    target="_blank"
    rel="noreferrer"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
  </a>
</div>
```

**Step 2: Add download button to `Lightbox.tsx` toolbar**

In the top-right toolbar (where close button is), add:

```tsx
<a
  href={current.local_url || current.image_url}
  download
  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
  aria-label="Download image"
  target="_blank"
  rel="noreferrer"
>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
</a>
```

**Step 3: Commit**
```bash
git add frontend/src/features/images/ImageCard.tsx frontend/src/features/images/Lightbox.tsx
git commit -m "feat: download button on image cards and lightbox"
```

---

## Task 15: TopBar keyboard shortcut reference overlay (? key)

**Files:**
- Modify: `frontend/src/components/TopBar.tsx`
- Create: `frontend/src/components/ShortcutModal.tsx`

**Context:**
- TopBar is the top bar rendered by AppShell.
- Add a `?` button in the top-right that opens a modal listing all keyboard shortcuts.
- Also bind `?` key globally (when not in an input).
- Shortcuts to document: `⌘K` (command palette), `j/k` (navigate items), `Escape` (close drawer/deselect), `?` (this help).

**Step 1: Create `frontend/src/components/ShortcutModal.tsx`**

```tsx
const SHORTCUTS = [
  { key: '⌘K', description: 'Open command palette' },
  { key: 'j / k', description: 'Next / previous item (Items view)' },
  { key: 'Escape', description: 'Close drawer / deselect' },
  { key: '?', description: 'Show keyboard shortcuts' },
  { key: '1–6', description: 'Switch views (future)' },
]

export function ShortcutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-bg-surface border border-border rounded-xl shadow-2xl p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-text-primary">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors" aria-label="Close">✕</button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.key} className="border-b border-border last:border-0">
                <td className="py-2 pr-4">
                  <kbd className="font-mono text-xs bg-bg-subtle border border-border rounded px-2 py-0.5 text-text-secondary">{s.key}</kbd>
                </td>
                <td className="py-2 text-text-secondary">{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

**Step 2: Add `?` button and global key binding in `TopBar.tsx`**

```tsx
const [shortcutsOpen, setShortcutsOpen] = useState(false)

useEffect(() => {
  function onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (e.key === '?') setShortcutsOpen((o) => !o)
  }
  document.addEventListener('keydown', onKey)
  return () => document.removeEventListener('keydown', onKey)
}, [])

// In JSX near the right side of TopBar:
<button
  onClick={() => setShortcutsOpen(true)}
  className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-subtle transition-colors"
  aria-label="Keyboard shortcuts"
  title="Keyboard shortcuts (?)"
>
  <kbd className="font-mono text-xs">?</kbd>
</button>
<ShortcutModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
```

**Step 3: Export from `frontend/src/components/index.ts`**

**Step 4: Commit**
```bash
git add frontend/src/components/ShortcutModal.tsx frontend/src/components/TopBar.tsx frontend/src/components/index.ts
git commit -m "feat: keyboard shortcut reference modal (? key)"
```

---

## Task 16: Toast queue cap at 3, dedup by message

**Files:**
- Modify: `frontend/src/store.ts`

**Context:**
- `addToast` currently appends unlimited toasts. Cap at 3 visible + deduplicate by message.

**Step 1: Update `addToast` in `frontend/src/store.ts`**

```typescript
addToast: (message, type = "success") => set((s) => {
  // Dedup: don't add if same message already in queue
  if (s.toasts.some((t) => t.message === message)) return {}
  const newToast = { id: `${Date.now()}-${Math.random()}`, message, type }
  // Cap at 3: drop oldest if needed
  const next = [...s.toasts, newToast]
  return { toasts: next.length > 3 ? next.slice(next.length - 3) : next }
}),
```

**Step 2: Commit**
```bash
git add frontend/src/store.ts
git commit -m "fix: toast queue capped at 3, dedup by message"
```

---

## Task 17: Empty states with CTAs on all views

**Files:**
- Modify: `frontend/src/features/items/ItemsPage.tsx`
- Modify: `frontend/src/features/hypotheses/HypothesesPage.tsx`
- Modify: `frontend/src/features/images/MediaPage.tsx`
- Modify: `frontend/src/features/graphs/GraphPage.tsx`

**Context:**
- When a view has no data (no items, no hypotheses, no images), show a centered empty state with a message and CTA button.
- ItemsPage CTA: "Run a crawl" (triggers `api.triggerCrawl()`). HypothesesPage CTA: "Generate Hypothesis". Images: "Capture Screenshots". Graph: "Run a crawl".

**Step 1: Create reusable `EmptyState` component inline or in `frontend/src/components/`**

```tsx
// frontend/src/components/EmptyState.tsx
export function EmptyState({ icon, title, description, action }: {
  icon: string
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-8">
      <div className="text-5xl mb-4 opacity-30">{icon}</div>
      <h3 className="text-base font-semibold text-text-primary mb-2">{title}</h3>
      <p className="text-sm text-text-muted max-w-xs mb-6">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
```

**Step 2: Use `EmptyState` in each page**

- ItemsPage: when `items.length === 0` and not loading: `<EmptyState icon="📄" title="No items yet" description="Run a crawl to start gathering research." action={{ label: 'Run Crawl', onClick: () => api.triggerCrawl() }} />`
- HypothesesPage: when `hypotheses.length === 0` and not loading: `<EmptyState icon="💡" title="No hypotheses yet" description="Generate a hypothesis from your collected items." />`
- MediaPage: when `images.length === 0`: `<EmptyState icon="🖼️" title="No images yet" description="Capture screenshots to build your image library." action={{ label: 'Capture', onClick: () => api.triggerCapture() }} />`
- GraphPage: when no nodes: `<EmptyState icon="🕸️" title="No graph data" description="Items with tagged compounds or mechanisms will appear here." />`

**Step 3: Commit**
```bash
git add frontend/src/components/EmptyState.tsx frontend/src/features/items/ItemsPage.tsx frontend/src/features/hypotheses/HypothesesPage.tsx frontend/src/features/images/MediaPage.tsx frontend/src/features/graphs/GraphPage.tsx frontend/src/components/index.ts
git commit -m "feat: empty states with CTAs on all main views"
```

---

## Task 18: Skeleton loaders on heavy queries

**Files:**
- Modify: `frontend/src/features/items/ItemsPage.tsx`
- Modify: `frontend/src/features/hypotheses/HypothesesPage.tsx`
- Modify: `frontend/src/features/overview/OverviewPage.tsx`
- Reference: `frontend/src/components/Skeleton.tsx` (already exists)

**Context:**
- `Skeleton.tsx` already exists. Check its API (likely `<Skeleton className="..." />`).
- Items page: show 6 skeleton cards while loading.
- Hypotheses page: show 4 skeleton cards.
- Overview: show skeleton stat bars and chart placeholders.

**Step 1: Check `Skeleton.tsx` API**

Read the file to see how it's used, then apply consistently.

**Step 2: Add skeleton to ItemsPage**

```tsx
// Replace the loading spinner with skeleton cards:
if (isLoading) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-bg-surface p-4 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <div className="flex gap-2 mt-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}
```

**Step 3: Add skeleton to HypothesesPage and OverviewPage similarly**

For OverviewPage stat bar:
```tsx
if (isLoading) {
  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex-1 rounded-xl border border-border bg-bg-surface p-4 space-y-2">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  )
}
```

**Step 4: Commit**
```bash
git add frontend/src/features/items/ItemsPage.tsx frontend/src/features/hypotheses/HypothesesPage.tsx frontend/src/features/overview/OverviewPage.tsx
git commit -m "feat: skeleton loading states on Items, Hypotheses, and Overview pages"
```

---

## Task 19: Backend score histogram + OverviewPage score distribution chart

**Files:**
- Create: `app/api/stats.py` or modify existing `app/api/stats.py`
- Modify: `app/main.py`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/features/overview/OverviewPage.tsx`

**Context:**
- `app/api/stats.py` likely already exists (check). If so, add a new endpoint to it.
- Score histogram: bucket items by score into 10 buckets (0-10, 10-20, ... 90-100) and return counts.
- Render as a small BarChart in OverviewPage below the existing charts.

**Step 1: Check `app/api/stats.py` and add histogram endpoint**

```python
@router.get("/histogram")
def score_histogram() -> JSONResponse:
    from app.main import db
    conn = db._conn()
    buckets = []
    for i in range(10):
        low = i * 10
        high = low + 10
        count = conn.execute(
            "SELECT COUNT(*) FROM items WHERE score >= ? AND score < ?", (low, high)
        ).fetchone()[0]
        buckets.append({"range": f"{low}–{high}", "count": count})
    return JSONResponse({"buckets": buckets})
```

The route should be at `/api/stats/histogram`.

**Step 2: Add to `frontend/src/lib/api.ts`**

```typescript
export interface ScoreHistogram { buckets: { range: string; count: number }[] }

// in api object:
scoreHistogram: () => apiFetch<ScoreHistogram>('/api/stats/histogram'),
```

**Step 3: Add histogram chart to OverviewPage**

```tsx
function ScoreHistogramChart() {
  const { data } = useQuery({
    queryKey: ['scoreHistogram'],
    queryFn: api.scoreHistogram,
    staleTime: 120_000,
  })
  if (!data?.buckets?.length) return null
  return (
    <div className="rounded-xl border border-border bg-bg-surface p-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-3">Score Distribution</h3>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data.buckets} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
          <XAxis dataKey="range" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
          <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Bar dataKey="count" fill="var(--color-accent)" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
```

Add `<ScoreHistogramChart />` to the OverviewPage grid.

**Step 4: Commit**
```bash
git add app/api/stats.py frontend/src/lib/api.ts frontend/src/features/overview/OverviewPage.tsx
git commit -m "feat: score histogram endpoint + chart in OverviewPage"
```

---

## Task 20: Settings — custom theme management (add/delete)

**Files:**
- Modify: `app/api/` (add themes CRUD endpoint — check `app/db.py` for themes table)
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/features/settings/SettingsPage.tsx`

**Context:**
- The dashboard returns `themes: { slug: string; label: string }[]` — these come from the DB.
- Check `app/db.py` for a `themes` table. If it exists, add CRUD routes. If themes are just derived from items, this will need a separate `themes` table.
- Check the DB schema first by reading `app/db.py`. Look for a `themes` table and how `dashboard` fetches themes.
- Add ability to create a new theme (slug + label) and delete existing ones.
- In SettingsPage, add a "Manage Themes" section.

**Step 1: Read `app/db.py` to understand themes**

Look for `get_themes`, `themes` table, or how dashboard themes are populated. Adapt accordingly.

**Step 2: Create `app/api/themes.py`**

```python
from __future__ import annotations
from fastapi import APIRouter, HTTPException
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

@router.post("")
def create_theme(payload: ThemeCreate) -> JSONResponse:
    from app.main import db
    theme = db.create_theme(payload.slug, payload.label)
    return JSONResponse(theme)

@router.delete("/{slug}")
def delete_theme(slug: str) -> JSONResponse:
    from app.main import db
    ok = db.delete_theme(slug)
    if not ok:
        raise HTTPException(status_code=404, detail="Theme not found")
    return JSONResponse({"ok": True})
```

**Step 3: Add theme management to `frontend/src/features/settings/SettingsPage.tsx`**

```tsx
function ThemeManager() {
  const { data: dashboard, refetch } = useDashboard()
  const themes = dashboard?.themes ?? []
  const [newSlug, setNewSlug] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const addToast = useAppStore((s) => s.addToast)

  async function handleAdd() {
    if (!newSlug || !newLabel) return
    try {
      await api.createTheme(newSlug, newLabel)
      await refetch()
      setNewSlug(''); setNewLabel('')
      addToast('Theme added')
    } catch { addToast('Failed to add theme', 'error') }
  }

  async function handleDelete(slug: string) {
    try {
      await api.deleteTheme(slug)
      await refetch()
      addToast('Theme deleted')
    } catch { addToast('Failed to delete theme', 'error') }
  }

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold text-text-primary">Manage Themes</h3>
      <ul className="space-y-2">
        {themes.map((t) => (
          <li key={t.slug} className="flex items-center justify-between px-3 py-2 rounded-lg bg-bg-subtle border border-border">
            <div>
              <span className="text-sm text-text-primary font-medium">{t.label}</span>
              <span className="ml-2 font-mono text-xs text-text-muted">{t.slug}</span>
            </div>
            <button onClick={() => handleDelete(t.slug)} className="text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1">Delete</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="slug" className="px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg text-text-primary flex-1 focus:outline-none focus:border-accent/50" />
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label" className="px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg text-text-primary flex-1 focus:outline-none focus:border-accent/50" />
        <button onClick={handleAdd} className="px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors">Add</button>
      </div>
    </section>
  )
}
```

Add API methods to `frontend/src/lib/api.ts`:
```typescript
createTheme: (slug: string, label: string) => apiFetch('/api/themes', { method: 'POST', body: JSON.stringify({ slug, label }) }),
deleteTheme: (slug: string) => apiFetch(`/api/themes/${slug}`, { method: 'DELETE' }),
```

**Step 4: Commit**
```bash
git add app/api/themes.py app/main.py app/db.py frontend/src/lib/api.ts frontend/src/features/settings/SettingsPage.tsx
git commit -m "feat: theme management (add/delete) in Settings + API"
```

---

## Task 21: CompoundGraph — click node to filter items + cursor

**Files:**
- Modify: `frontend/src/features/graphs/CompoundGraph.tsx`

**Context:**
- This is a separate but related task to Task 10 (GraphPage node click). This one is specifically for the `CompoundGraph` component (the D3 graph inside GraphPage).
- Same approach: `.on('click', ...)` on D3 node selections.
- Also add `style="cursor: pointer"` to nodes on hover.
- Add a visual ring/highlight on the clicked node.

**Step 1: Add click + hover cursor to D3 nodes in `CompoundGraph.tsx`**

Find the `useEffect` that sets up D3 simulation. On the node `<g>` elements:

```typescript
nodeG
  .style('cursor', 'pointer')
  .on('click', (_event: MouseEvent, d: SimNode) => {
    const { resetFilters, setFilter, setActiveView } = useAppStore.getState()
    resetFilters()
    if (d.type === 'compound') setFilter('compound', d.label)
    else if (d.type === 'mechanism') setFilter('mechanism', d.label)
    else if (d.type === 'theme') setFilter('theme', d.label)
    setActiveView('items')
  })
  .on('mouseenter', function (_event: MouseEvent, d: SimNode) {
    d3.select(this).select('circle').attr('stroke-width', 3).attr('stroke', 'var(--color-accent)')
  })
  .on('mouseleave', function (_event: MouseEvent, d: SimNode) {
    d3.select(this).select('circle').attr('stroke-width', 1.5).attr('stroke', 'var(--color-border)')
  })
```

**Step 2: Commit**
```bash
git add frontend/src/features/graphs/CompoundGraph.tsx
git commit -m "feat: CompoundGraph node click filters items, pointer cursor, hover highlight"
```

---

## Task 22: Items view — date-range filter controls in FiltersBar

**Files:**
- Modify: `frontend/src/features/items/FiltersBar.tsx`
- (Depends on Task 11's `dateFrom`/`dateTo` additions to store and DB — but if Task 11 hasn't landed yet, add the store fields here instead)

**Context:**
- Add two `<input type="date">` controls to FiltersBar for `dateFrom` and `dateTo`.
- These feed into the browse API (if Task 11 is done) or just set store state for later.
- Show a "Date range" section that collapses when both are empty.

**Step 1: Add date inputs to `FiltersBar.tsx`**

```tsx
// After existing filter controls:
<div className="flex items-center gap-2">
  <label className="text-xs text-text-muted whitespace-nowrap">From</label>
  <input
    type="date"
    value={filters.dateFrom ?? ''}
    onChange={(e) => setFilter('dateFrom', e.target.value)}
    className={`${controlClass} text-text-primary`}
    aria-label="Date from"
  />
  <label className="text-xs text-text-muted whitespace-nowrap">To</label>
  <input
    type="date"
    value={filters.dateTo ?? ''}
    onChange={(e) => setFilter('dateTo', e.target.value)}
    className={`${controlClass} text-text-primary`}
    aria-label="Date to"
  />
</div>
```

Also add `dateFrom`/`dateTo` chips to the active filter display, and pass them in the `browseItems` API call params.

**Step 2: Make sure store has `dateFrom`/`dateTo`**

If Task 11 hasn't added them, add to `frontend/src/store.ts`:
```typescript
// In Filters interface:
dateFrom: string
dateTo: string
// In DEFAULT_FILTERS:
dateFrom: '',
dateTo: '',
```

**Step 3: Pass to API call in `useItems` hook**

In `frontend/src/hooks/useItems.ts`, ensure `date_from: filters.dateFrom` and `date_to: filters.dateTo` are passed in the query params (skip when empty string).

**Step 4: Commit**
```bash
git add frontend/src/features/items/FiltersBar.tsx frontend/src/store.ts frontend/src/hooks/useItems.ts
git commit -m "feat: date range filter controls in FiltersBar"
```
