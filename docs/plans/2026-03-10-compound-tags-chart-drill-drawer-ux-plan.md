# Compound Tags + Chart Drill-Down + Drawer UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make compound/mechanism tags clickable filters, add trend chart drill-through, add a TopTagsPanel, improve ItemDrawer with prev/next nav + auto-reviewing, and wire scroll restoration.

**Architecture:** All new filter params flow through the existing `Filters` interface → `setFilter` → API params pipeline. The `ThemeTrendChart` gains an optional `onBarClick` prop (backwards-compatible). `TopTagsPanel` reads already-fetched `dashboard.stats` — no new API calls. Prev/next nav passes `itemIds` array down to the drawer.

**Tech Stack:** Python/FastAPI (backend), React 19 + TypeScript/TSX (frontend), Zustand (state), TanStack Query v5 (data fetching), Tailwind CSS v4 (styling). Build: `cd frontend && npm run build` (runs `tsc -b` then `vite build`). Source files are `.tsx`; compiled `.js` counterparts in the same directory are also committed.

---

## Task 1: Backend — compound/mechanism filter params

**Files:**
- Modify: `app/db.py:363-395` (`_build_item_query`)
- Modify: `app/db.py:447-484` (`browse_items`)
- Modify: `app/api/items.py:99-125` (`browse_router.get("/items")`)

### Step 1: Add params to `_build_item_query` in `app/db.py`

Find the function signature at line 363 and extend it:

```python
def _build_item_query(
    self,
    *,
    theme: str | None = None,
    source_type: str | None = None,
    review_status: str | None = None,
    saved_only: bool = False,
    search: str = "",
    compound: str | None = None,
    mechanism: str | None = None,
) -> tuple[str, list[Any]]:
```

After the existing `if search.strip():` block (before the `query, params = self._apply_content_filters(...)` line), add:

```python
        if compound:
            query += " AND LOWER(compounds_json) LIKE ?"
            params.append(f'%"{compound.lower()}"%')
        if mechanism:
            query += " AND LOWER(mechanisms_json) LIKE ?"
            params.append(f'%"{mechanism.lower()}"%')
```

### Step 2: Thread params through `browse_items` in `app/db.py`

Find `browse_items` signature at line 447 and add the two new params:

```python
def browse_items(
    self,
    *,
    limit: int = 40,
    offset: int = 0,
    theme: str | None = None,
    source_type: str | None = None,
    review_status: str | None = None,
    saved_only: bool = False,
    search: str = "",
    sort: str = "newest",
    compound: str | None = None,
    mechanism: str | None = None,
) -> dict[str, Any]:
```

Pass both to `_build_item_query`:

```python
        base_query, params = self._build_item_query(
            theme=theme,
            source_type=source_type,
            review_status=review_status,
            saved_only=saved_only,
            search=search,
            compound=compound,
            mechanism=mechanism,
        )
```

### Step 3: Expose params in FastAPI route in `app/api/items.py`

Find `browse_router.get("/items")` at line 102 and update:

```python
@browse_router.get("/items")
def browse_items(
    theme: str | None = Query(default=None),
    source_type: str | None = Query(default=None),
    review_status: str | None = Query(default=None),
    saved_only: bool = Query(default=False),
    search: str = Query(default=""),
    sort: str = Query(default="newest"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    compound: str | None = Query(default=None),
    mechanism: str | None = Query(default=None),
) -> JSONResponse:
    from app.main import db
    return JSONResponse(
        db.browse_items(
            limit=limit,
            offset=offset,
            theme=theme,
            source_type=source_type,
            review_status=review_status,
            saved_only=saved_only,
            search=search,
            sort=sort,
            compound=compound,
            mechanism=mechanism,
        )
    )
```

### Step 4: Verify manually

Start the backend: `uvicorn app.main:app --reload --port 8000`

Test in browser or curl:
```
curl "http://localhost:8000/api/browse/items?compound=sildenafil&limit=5"
```
Expected: JSON with `items` array filtered to entries whose `compounds_json` contains "sildenafil".

### Step 5: Commit

```bash
git add app/db.py app/api/items.py
git commit -m "feat: add compound/mechanism filter params to browse_items API"
```

---

## Task 2: Store + FiltersBar — compound/mechanism filter state

**Files:**
- Modify: `frontend/src/store.ts`
- Modify: `frontend/src/features/items/ItemsPage.tsx`
- Modify: `frontend/src/features/items/FiltersBar.tsx`

### Step 1: Add fields to `Filters` in `store.ts`

In `store.ts`, find the `Filters` interface and add two new string fields:

```typescript
export interface Filters {
  search: string
  sourceType: string
  reviewStatus: string
  savedOnly: boolean
  sort: string
  theme: string
  imageTheme: string
  compound: string    // ← add
  mechanism: string   // ← add
}
```

Update `DEFAULT_FILTERS` to include them:

```typescript
const DEFAULT_FILTERS: Filters = {
  search: "",
  sourceType: "",
  reviewStatus: "",
  savedOnly: false,
  sort: "newest",
  theme: "",
  imageTheme: "",
  compound: "",    // ← add
  mechanism: "",   // ← add
}
```

### Step 2: Wire compound/mechanism into API call in `ItemsPage.tsx`

In `ItemsPage.tsx`, find the params block (around line 38-47) where params are built before calling `useBrowseItems`. After `if (filters.theme) params.theme = filters.theme`, add:

```typescript
  if (filters.compound) params.compound = filters.compound
  if (filters.mechanism) params.mechanism = filters.mechanism
```

### Step 3: Add compound/mechanism chips to `FiltersBar.tsx`

In `FiltersBar.tsx`, find the `activeFilters` array (around line 46-51). After `if (filters.savedOnly) activeFilters.push(...)`, add:

```typescript
  if (filters.compound) activeFilters.push({ key: 'compound', label: 'compound', value: filters.compound })
  if (filters.mechanism) activeFilters.push({ key: 'mechanism', label: 'mechanism', value: filters.mechanism })
```

The existing chip-rendering loop already handles clearing any filter key by calling `setFilter(f.key, '')` — no further changes needed there since `compound` and `mechanism` are strings (not booleans).

### Step 4: Commit

```bash
git add frontend/src/store.ts frontend/src/features/items/ItemsPage.tsx frontend/src/features/items/FiltersBar.tsx
git commit -m "feat: add compound/mechanism fields to Filters store and FiltersBar chips"
```

---

## Task 3: Clickable compound/mechanism tags in ItemDrawer and SourceCard

**Files:**
- Modify: `frontend/src/features/items/ItemDrawer.tsx`
- Modify: `frontend/src/features/items/SourceCard.tsx`

### Step 1: Make compound/mechanism chips clickable in `ItemDrawer.tsx`

At the top of `ItemDrawer.tsx`, the component currently reads `selectedItemId` and `setSelectedItemId`. Add selectors for `resetFilters`, `setFilter`, and `setActiveView`:

```typescript
export function ItemDrawer() {
  const selectedItemId = useAppStore((s) => s.selectedItemId)
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)
  const setActiveView = useAppStore((s) => s.setActiveView)
  // ...rest unchanged
```

Create a navigation helper inside the component body (above the return statement):

```typescript
  function goFilter(type: 'compound' | 'mechanism', value: string) {
    setSelectedItemId(null)
    resetFilters()
    setFilter(type, value)
    setActiveView('items')
  }
```

In the compounds section (around line 119-128), replace the `<span>` with a `<button>`:

```tsx
{item.compounds.map((c: string) => (
  <button
    key={c}
    onClick={() => goFilter('compound', c)}
    className="font-mono text-xs px-2 py-0.5 rounded bg-bg-elevated border border-border text-teal hover:border-teal/50 hover:bg-teal/10 transition-colors cursor-pointer"
  >
    {c}
  </button>
))}
```

In the mechanisms section (around line 130-139), replace the `<span>` with a `<button>`:

```tsx
{item.mechanisms.map((m: string) => (
  <button
    key={m}
    onClick={() => goFilter('mechanism', m)}
    className="font-mono text-xs px-2 py-0.5 rounded bg-bg-elevated border border-border text-purple hover:border-purple/50 hover:bg-purple/10 transition-colors cursor-pointer"
  >
    {m}
  </button>
))}
```

### Step 2: Make compound/mechanism badges clickable in `SourceCard.tsx`

At the top of `SourceCard.tsx` the component does not yet read from the store. Add store hooks inside the component function:

```typescript
export function SourceCard({ item, selected, onSelect, density = 'comfortable' }: SourceCardProps) {
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const update = useUpdateItem()
  // ...rest unchanged
```

Note: `useAppStore` is already imported by checking imports — if not already there, add `import { useAppStore } from '@/store'` to the top of the file.

Create a navigation helper inside the function body:

```typescript
  function goTag(type: 'compound' | 'mechanism', value: string) {
    resetFilters()
    setFilter(type, value)
    setActiveView('items')
  }
```

Find the compounds/mechanisms rendering block (around line 27 in the tsx file — it renders `Badge` components inside a flex div). Replace:

```tsx
{item.compounds.map((c) => (
  <button
    key={c}
    onClick={(e) => { e.stopPropagation(); goTag('compound', c) }}
    className="font-mono text-[11px] px-1.5 py-0.5 rounded border bg-bg-elevated border-teal/30 text-teal hover:border-teal/60 hover:bg-teal/10 transition-colors"
  >
    {c}
  </button>
))}
{item.mechanisms.map((m) => (
  <button
    key={m}
    onClick={(e) => { e.stopPropagation(); goTag('mechanism', m) }}
    className="font-mono text-[11px] px-1.5 py-0.5 rounded border bg-bg-elevated border-purple/30 text-purple hover:border-purple/60 hover:bg-purple/10 transition-colors"
  >
    {m}
  </button>
))}
```

### Step 3: Commit

```bash
git add frontend/src/features/items/ItemDrawer.tsx frontend/src/features/items/SourceCard.tsx
git commit -m "feat: make compound/mechanism tags clickable filters in drawer and cards"
```

---

## Task 4: Trend chart click-through

**Files:**
- Modify: `frontend/src/features/analytics/ThemeTrendChart.tsx`
- Modify: `frontend/src/features/overview/OverviewPage.tsx`

### Step 1: Add `onBarClick` prop to `ThemeTrendChart.tsx`

At the top of the file, update the component signature. Currently it takes no props — add an optional callback:

```typescript
type ChartView = "theme" | "source"

interface ThemeTrendChartProps {
  onBarClick?: (value: string, view: ChartView) => void
}

export function ThemeTrendChart({ onBarClick }: ThemeTrendChartProps = {}) {
```

In the `AreaChart` element (around line 57), add an `onClick` handler and a `cursor-pointer` class on the container div:

```tsx
<AreaChart
  data={chartData}
  margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
  onClick={(chartState) => {
    if (!onBarClick) return
    const payload = chartState?.activePayload?.[0]?.payload
    if (!payload) return
    const value = payload[dataKey]
    if (value) onBarClick(String(value), view)
  }}
  className={onBarClick ? "cursor-pointer" : undefined}
>
```

Also add a subtle tooltip hint in the chart header when `onBarClick` is provided (in the title row, after the `<p>Trend</p>`):

```tsx
{onBarClick && (
  <span className="text-[10px] text-text-muted font-mono">click to filter</span>
)}
```

### Step 2: Wire `onBarClick` in `OverviewPage.tsx`

In `OverviewPage.tsx`, the component already reads `setActiveView`, `resetFilters`, `setFilter` from the store (lines 47-49). Add `onBarClick` handler and pass it to `<ThemeTrendChart>`:

```typescript
  function handleChartClick(value: string, chartView: 'theme' | 'source') {
    resetFilters()
    if (chartView === 'theme') {
      setFilter('theme', value)
    } else {
      setFilter('sourceType', value)
    }
    setActiveView('items')
  }
```

Then update the `ThemeTrendChart` usage from:

```tsx
_jsx(ThemeTrendChart, {})
```

to (in TSX):

```tsx
<ThemeTrendChart onBarClick={handleChartClick} />
```

### Step 3: Commit

```bash
git add frontend/src/features/analytics/ThemeTrendChart.tsx frontend/src/features/overview/OverviewPage.tsx
git commit -m "feat: add click-through drill-down to ThemeTrendChart"
```

---

## Task 5: TopTagsPanel on OverviewPage

**Files:**
- Modify: `frontend/src/features/overview/OverviewPage.tsx`

### Step 1: Add `TopTagsPanel` component

In `OverviewPage.tsx`, add the following component before `OverviewPage` (around line 44 where `OverviewPage` is defined):

```typescript
function TopTagsPanel() {
  const { data: dashboard } = useDashboard()
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)
  const setActiveView = useAppStore((s) => s.setActiveView)

  const compounds = dashboard?.stats.top_compounds ?? []
  const mechanisms = dashboard?.stats.top_mechanisms ?? []

  if (compounds.length === 0 && mechanisms.length === 0) return null

  function goTag(type: 'compound' | 'mechanism', value: string) {
    resetFilters()
    setFilter(type, value)
    setActiveView('items')
  }

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
      <p className="text-sm font-medium text-text-primary">Top Signals</p>
      {compounds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {compounds.slice(0, 10).map(({ name, count }) => (
            <button
              key={name}
              onClick={() => goTag('compound', name)}
              title={`${count} items`}
              className="flex items-center gap-1 font-mono text-xs px-2 py-0.5 rounded border bg-bg-elevated border-teal/30 text-teal hover:border-teal/60 hover:bg-teal/10 transition-colors"
            >
              {name}
              <span className="text-teal/60 text-[10px]">{count}</span>
            </button>
          ))}
        </div>
      )}
      {mechanisms.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {mechanisms.slice(0, 10).map(({ name, count }) => (
            <button
              key={name}
              onClick={() => goTag('mechanism', name)}
              title={`${count} items`}
              className="flex items-center gap-1 font-mono text-xs px-2 py-0.5 rounded border bg-bg-elevated border-purple/30 text-purple hover:border-purple/60 hover:bg-purple/10 transition-colors"
            >
              {name}
              <span className="text-purple/60 text-[10px]">{count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

### Step 2: Add `TopTagsPanel` to the `OverviewPage` layout

In `OverviewPage`, after `<ThemePills />` and before the grid section, add:

```tsx
<TopTagsPanel />
```

The final layout order should be:
1. `<StatsBar />`
2. `<ThemePills />`
3. `<TopTagsPanel />`
4. The `grid grid-cols-3` div (ThemeTrendChart + SourceDonut + RecentRuns)

### Step 3: Commit

```bash
git add frontend/src/features/overview/OverviewPage.tsx
git commit -m "feat: add TopTagsPanel showing top compounds and mechanisms on overview"
```

---

## Task 6: ItemDrawer UX — prev/next nav, auto-reviewing, image preview + scroll restoration

**Files:**
- Modify: `frontend/src/features/items/ItemDrawer.tsx`
- Modify: `frontend/src/features/items/ItemsPage.tsx`
- Modify: `frontend/src/components/AppShell.tsx`

### Step 1: Update `ItemDrawer` props for prev/next navigation

In `ItemDrawer.tsx`, add a props interface at the top:

```typescript
interface ItemDrawerProps {
  itemIds?: number[]
  currentIndex?: number
}
```

Update the function signature:

```typescript
export function ItemDrawer({ itemIds = [], currentIndex = -1 }: ItemDrawerProps) {
```

### Step 2: Add prev/next keyboard + button navigation to `ItemDrawer.tsx`

The existing `useEffect` for Escape key is at line 52. Extend it to also handle ArrowLeft/ArrowRight when the drawer is open:

```typescript
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedItemId(null)
      } else if (e.key === "ArrowLeft" && isOpen && currentIndex > 0) {
        setSelectedItemId(itemIds[currentIndex - 1])
      } else if (e.key === "ArrowRight" && isOpen && currentIndex >= 0 && currentIndex < itemIds.length - 1) {
        setSelectedItemId(itemIds[currentIndex + 1])
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [setSelectedItemId, isOpen, currentIndex, itemIds])
```

In the header div (around line 85-94), add the prev/next buttons between the "Detail" label and close button:

```tsx
<div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
  <span className="text-xs font-mono text-text-muted uppercase tracking-wider">Detail</span>
  <div className="flex items-center gap-2">
    {itemIds.length > 1 && (
      <>
        <button
          onClick={() => currentIndex > 0 && setSelectedItemId(itemIds[currentIndex - 1])}
          disabled={currentIndex <= 0}
          className="text-text-muted hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed px-1"
          aria-label="Previous item"
        >
          ‹
        </button>
        <span className="text-[10px] text-text-muted font-mono tabular-nums">
          {currentIndex + 1}/{itemIds.length}
        </span>
        <button
          onClick={() => currentIndex < itemIds.length - 1 && setSelectedItemId(itemIds[currentIndex + 1])}
          disabled={currentIndex >= itemIds.length - 1}
          className="text-text-muted hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed px-1"
          aria-label="Next item"
        >
          ›
        </button>
      </>
    )}
    <button
      onClick={() => setSelectedItemId(null)}
      className="text-text-muted hover:text-text-primary transition-colors"
      aria-label="Close detail panel"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
  </div>
</div>
```

### Step 3: Add auto-reviewing effect to `ItemDrawer.tsx`

After the existing `useEffect` for keyboard handlers, add a new effect. It uses `useQueryClient` (already imported):

```typescript
  const qc = useQueryClient()

  // Auto-advance status: new → reviewing
  useEffect(() => {
    if (item && item.review_status === 'new') {
      api.updateItem(item.id, { review_status: 'reviewing' }).then(() => {
        qc.invalidateQueries({ queryKey: ['browse-items'] })
        qc.invalidateQueries({ queryKey: ['item', item.id] })
      })
    }
  }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps
```

Note: `useQueryClient` is already imported at line 3 in the original file. But check — in `ItemDrawer.tsx` the original imports do NOT include `useQueryClient`. Only `ActionBar` uses it. You need to add `useQueryClient` to the import at line 3:

```typescript
import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
```

Also note `api` is already imported (line 6). No changes needed there.

### Step 4: Add image preview to `ItemDrawer.tsx`

After the `<h2>` title block (around line 101) and before the badges div, add:

```tsx
{item.image_url && (
  <img
    src={item.image_url}
    alt=""
    className="w-full rounded-lg object-cover max-h-44 bg-bg-elevated"
    loading="lazy"
  />
)}
```

### Step 5: Pass `itemIds` and `currentIndex` from `ItemsPage.tsx`

In `ItemsPage.tsx`, `selectedItemId` is already in scope from `useAppStore`. Add the two derived values just before the return:

```typescript
  const selectedItemId = useAppStore((s) => s.selectedItemId)
  // ...existing code...
  const itemIds = items.map((i) => i.id)
  const currentIndex = items.findIndex((i) => i.id === selectedItemId)
```

Update the `<ItemDrawer />` usage at the bottom of the return:

```tsx
<ItemDrawer itemIds={itemIds} currentIndex={currentIndex} />
```

### Step 6: Wire scroll restoration in `AppShell.tsx`

In `AppShell.tsx`, add two imports at the top:

```typescript
import { useScrollRestoration } from "../hooks/useScrollRestoration"
```

(`useAppStore` is already imported; `activeView` needs to be read from it.)

Inside the component, read `activeView` and create the ref:

```typescript
export function AppShell({ children }: AppShellProps) {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const activeView = useAppStore((s) => s.activeView)
  const mainRef = useScrollRestoration(activeView)
  const sidebarW = collapsed ? "ml-[64px]" : "ml-[260px]"
```

Attach the ref to `<main>`:

```tsx
<main ref={mainRef} className="flex-1 overflow-y-auto p-6 mt-12">
  {children}
</main>
```

Note: `useScrollRestoration` is a JS file (not TypeScript). Since `skipLibCheck: true` is set and the module has no type declaration, TypeScript may warn. If so, add a `// @ts-ignore` comment on the import line, or create a declaration file:

```typescript
// frontend/src/hooks/useScrollRestoration.d.ts
import { RefObject } from "react"
export function useScrollRestoration(view: string): RefObject<HTMLElement>
```

Create this file if the build fails with a type error.

### Step 7: Commit

```bash
git add frontend/src/features/items/ItemDrawer.tsx frontend/src/features/items/ItemsPage.tsx frontend/src/components/AppShell.tsx
git commit -m "feat: add prev/next nav, auto-reviewing, image preview to ItemDrawer; wire scroll restoration"
```

---

## Task 7: Rebuild + smoke test

### Step 1: Build frontend

```bash
cd frontend && npm run build
```

Expected output ends with: `✓ built in X.XXs` and no TypeScript errors.

If there are TypeScript errors:
- `noUnusedLocals` / `noUnusedParameters` will fire on any unused variable — fix by removing unused vars
- Type errors on `useScrollRestoration` return value — create the `.d.ts` declaration file described in Task 6 Step 6
- Type error on `onBarClick` being `undefined` in OverviewPage — verify the prop was made optional (`?`)

### Step 2: Start both servers

Backend:
```bash
uvicorn app.main:app --reload --port 8000
```

Frontend (dev mode for rapid verification):
```bash
cd frontend && npm run dev
```

Open `http://localhost:5173`

### Step 3: Smoke test all 7 flows

Verify each flow works in the browser:

1. **Compound filter from SourceCard**: Find a card with a compound tag (teal pill). Click it. Should navigate to Items with a `compound:` chip in FiltersBar showing that compound name. Items should be filtered.

2. **Compound filter from ItemDrawer**: Open an item drawer. Click a compound chip (now a button). Drawer should close and Items view should show with compound filter active.

3. **Mechanism filter**: Same as #1 and #2 but for mechanism (purple) tags.

4. **Trend chart drill**: On Overview, click a bar in the Trend chart. Should navigate to Items filtered by that theme (or source type in source view).

5. **TopTagsPanel**: On Overview, verify the "Top Signals" panel appears below ThemePills. Click a compound or mechanism pill. Should navigate to filtered Items.

6. **Prev/next in ItemDrawer**: Open any item. Verify `‹ 1/N ›` counter in drawer header. Click `›` to advance. Click `‹` to go back. Verify first item has disabled `‹` and last item has disabled `›`. Press ArrowRight/ArrowLeft keyboard — should also navigate.

7. **Auto-reviewing**: Find an item with `new` status. Click to open in drawer. After a moment (background request), its status badge should update to `reviewing` (amber). The item in the card list should reflect this.

8. **Image preview**: Find an item with an image URL. Open in drawer. Verify the image renders below the title.

9. **Scroll restoration**: Scroll down in Items view. Switch to Overview. Switch back to Items. Verify scroll position was preserved.

### Step 4: Commit rebuilt artifacts

```bash
git add frontend/src
git commit -m "build: rebuild after compound/mechanism filter + drawer UX improvements"
```
