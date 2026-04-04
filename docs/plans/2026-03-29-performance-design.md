# Performance Improvement Design
Date: 2026-03-29

## Problem

The app loads slowly and feels janky, primarily due to:
- 318 kB synchronous main bundle (lucide-react contributing heavily)
- 438 kB recharts chunk loading on first paint (OverviewPage is default view)
- No `React.memo` on `MediaCard`/`MosaicCard` — every state change (favorites, context menu) re-renders all 60–120 grid cards
- Per-card `IntersectionObserver` instances for video autoplay (N observers instead of 1)
- `backdrop-blur-sm` GPU filter on every card hover overlay
- `group-hover:scale-[1.02]` triggering GPU compositing on hover across all cards
- No DB index on `captured_at` — primary sort column does full table scan + temp B-tree

## Design

### 1. DB index

```sql
CREATE INDEX IF NOT EXISTS idx_screenshots_captured_at ON screenshots(captured_at DESC);
```

Applied via `app/db.py` at startup (idempotent `CREATE INDEX IF NOT EXISTS`). Eliminates full-table scan on the most common query.

### 2. Bundle optimization

- Audit `components/index.ts` and `AppShell`/`Sidebar` for lucide imports. Move icon imports into the page-level lazy chunks that actually need them. Target: reduce main bundle by 30–60 kB.
- Verify recharts is not accidentally imported from the main bundle path — confirm it stays inside the `vendor-recharts` lazy chunk.
- Add `@tanstack/virtual` as a dependency for grid virtualization.

### 3. MediaCard memoization + jank removal

- Wrap `MediaCard` and `MosaicCard` with `React.memo` + custom comparator keying on: `shot.id`, `shot.rating`, `shot.local_url`, `favorite`, `selected`, `batchMode`. Prevents full-grid re-render on single-card state changes.
- Replace per-card `useEffect(() => new IntersectionObserver(...))` video autoplay with a shared singleton observer. All video cards register/unregister with one observer instance.
- Remove `backdrop-blur-sm` from card hover overlays → `bg-black/60` solid.
- Replace `group-hover:scale-[1.02]` → `group-hover:brightness-110`.

### 4. Virtual grid

Use `@tanstack/virtual` row virtualization on the grid-mode media view. Grid items are grouped into rows (row size = number of columns from `gridDensity`). Only the ~6–8 visible rows render at a time. Container uses a fixed scrollable height. Total DOM nodes stays ~50–100 regardless of scroll depth.

Scope: grid mode only. Mosaic, list, and timeline views are out of scope for this pass.

## Files changed

| File | Change |
|------|--------|
| `app/db.py` | Add `captured_at` index at startup |
| `frontend/src/components/index.ts` | Audit lucide exports |
| `frontend/src/components/AppShell.tsx` + `.js` | Cherry-pick lucide imports |
| `frontend/src/features/images/MediaPage.tsx` + `.js` | React.memo, shared observer, remove blur/scale, virtual grid |
| `frontend/package.json` | Add `@tanstack/virtual` |

## Success criteria

- Main bundle ≤ 260 kB gzip
- MediaPage initial render: no re-render of unaffected cards on favorite toggle
- Scrolling through 500+ items: smooth 60fps, DOM node count stable
- DB query for default view uses index (EXPLAIN QUERY PLAN shows index scan)
