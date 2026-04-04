# Design: Compound Tags + Chart Drill-Down + Drawer UX
_2026-03-10_

## Problem Statement

Six concrete gaps in the current UI reduce research throughput:

1. Compound/mechanism tags are decorative — clicking `sildenafil` does nothing
2. The ThemeTrendChart has no click-through — you see counts but can't explore them
3. The top_compounds / top_mechanisms arrays are fetched on every dashboard load but never rendered
4. ItemDrawer has no prev/next navigation — you must close and reopen for each item
5. Items never auto-advance from `new` → `reviewing`, so the review status is always stale
6. Scroll position resets on every view switch — jarring when returning to a long items list

## Feature Set

### A. Clickable compound/mechanism tags (backend + frontend)

**Backend:** Add `compound` and `mechanism` optional string params to `_build_item_query` and `browse_items` in `app/db.py`. Filter using `LOWER(compounds_json) LIKE '%"<term>"%'` for compounds, same for `mechanisms_json`. Expose both params in the `/api/browse/items` FastAPI route.

**Frontend store:** Add `compound: string` and `mechanism: string` to the `Filters` interface and `DEFAULT_FILTERS`. Wire both to the `browseItems` API call in `ItemsPage`.

**ItemDrawer:** Convert compound and mechanism `<span>` chips to `<button>` elements. On click: close drawer (`setSelectedItemId(null)`) → `resetFilters()` → `setFilter('compound'|'mechanism', name)` → `setActiveView('items')`.

**SourceCard:** Same treatment — compound/mechanism `<Badge>` become buttons with `e.stopPropagation()` and the same navigation flow.

**FiltersBar:** Add two new `<select>` or text displays for active compound/mechanism filters as chips (same chip-row pattern that already exists for theme/source).

### B. Trend chart click-through

**ThemeTrendChart:** Add optional `onBarClick?: (value: string, view: 'theme' | 'source') => void` prop. Wire Recharts `AreaChart onClick` callback: `data.activePayload?.[0]?.payload?.[dataKey]` → call `onBarClick(value, currentView)`. Add `cursor-pointer` class and a tooltip hint "Click to filter".

**OverviewPage:** Pass `onBarClick` handler that does `resetFilters() → setFilter('theme'|'sourceType', value) → setActiveView('items')`.

### C. Top compounds/mechanisms panel on Overview

**New component `TopTagsPanel`** in `OverviewPage.tsx`. Reads `dashboard.stats.top_compounds` and `dashboard.stats.top_mechanisms`. Renders two rows of pills:
- Teal pills for compounds
- Purple pills for mechanisms

Click → `resetFilters() → setFilter('compound'|'mechanism', name) → setActiveView('items')`.

Shown below `ThemePills`, full-width, collapsible after 2 rows (show/hide toggle).

### D. Prev/Next navigation in ItemDrawer

**ItemDrawer** receives two new optional props: `itemIds: number[]` and `currentIndex: number`.

Header area gains two chevron buttons `‹` / `›` (disabled at boundaries). Click calls `setSelectedItemId(itemIds[currentIndex ± 1])`. Keyboard: `ArrowLeft` / `ArrowRight` when drawer is open.

**ItemsPage** passes `itemIds={items.map(i => i.id)}` and `currentIndex={items.findIndex(i => i.id === selectedItemId)}` to `<ItemDrawer />`.

### E. Auto-reviewing + image preview in ItemDrawer

**Auto-reviewing:** `useEffect([item?.id])` — when `item` loads and `item.review_status === 'new'`, fire `api.updateItem(item.id, { review_status: 'reviewing' })` + invalidate `['browse-items']`. No toast (silent, background action).

**Image preview:** After the title block, if `item.image_url` is truthy, render `<img src={item.image_url} className="w-full rounded-lg object-cover max-h-44 bg-bg-elevated" loading="lazy" />`.

### F. Scroll restoration

**AppShell:** Import `useScrollRestoration`. Read `activeView` from store. Attach `mainRef = useScrollRestoration(activeView)` to the `<main>` scroll container. This preserves per-view scroll positions across view switches automatically.

## Architecture Notes

- All new filter params (`compound`, `mechanism`) go through the existing `Filters` type → `setFilter` → API params pipeline. No new state shape required beyond adding two string fields.
- The `onBarClick` prop on `ThemeTrendChart` is optional to keep it backwards-compatible (no change to existing callers if prop is omitted).
- `TopTagsPanel` depends only on `useDashboard()` — no new API calls.
- Auto-reviewing fires a side-effect mutation; the invalidation ensures SourceCard badges update without user action.

## Out of Scope

- Related items tab in drawer (requires a new API endpoint)
- Export to CSV (non-trivial pagination)
- Full-text content expand in drawer (may need a scrollable sub-panel)
