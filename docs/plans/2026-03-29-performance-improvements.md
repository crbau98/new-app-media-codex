# Performance Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate janky rendering and reduce initial load time in the media-heavy app.

**Architecture:** Four independent layers of improvement — DB index, React.memo memoization, shared video observer singleton, CSS jank removal, and virtual grid rendering via @tanstack/virtual window virtualizer.

**Tech Stack:** FastAPI/SQLite backend, React 19, Vite 6, TypeScript, TanStack Query v5, @tanstack/virtual

**Critical rule:** Every change to a `.tsx` file MUST also be applied to the sibling `.js` file (same name, same directory). Vite resolves `.js` before `.tsx` in production builds. Skipping the `.js` sibling means changes don't appear in the built app.

---

### Task 1: Add `captured_at` DB index

**Files:**
- Modify: `app/db.py` — find the `init()` method around line 326

**Context:** The primary sort column `captured_at` has no index. Every page load does a full table scan + temp B-tree sort (`EXPLAIN QUERY PLAN` shows `SCAN screenshots` + `USE TEMP B-TREE FOR ORDER BY`). Adding the index makes the sort instant.

**Step 1: Add the index in `init()`**

Open `app/db.py`. In the `init()` method (around line 326), add after the existing index lines:

```python
def init(self) -> None:
    with self.connect() as conn:
        conn.executescript(SCHEMA)
        self._migrate(conn)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_items_review_status ON items(review_status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_items_saved ON items(is_saved)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_hypotheses_review_status ON hypotheses(review_status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_hypotheses_saved ON hypotheses(is_saved)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_captured_at ON screenshots(captured_at DESC)")  # ADD THIS
        conn.commit()
```

**Step 2: Verify it works**

```bash
cd "/Users/chasebauman/Documents/App research codex"
python3 -c "
from app.db import Database
from pathlib import Path
db = Database(Path('data/research.db'))
db.init()
import sqlite3
conn = sqlite3.connect('data/research.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()
cur.execute('EXPLAIN QUERY PLAN SELECT * FROM screenshots ORDER BY captured_at DESC LIMIT 60')
for r in cur.fetchall():
    print(dict(r))
conn.close()
"
```

Expected output should show `SEARCH screenshots USING INDEX idx_screenshots_captured_at` instead of `SCAN screenshots + TEMP B-TREE`.

**Step 3: Commit**

```bash
cd "/Users/chasebauman/Documents/App research codex"
git add app/db.py
git commit -m "perf: add captured_at index on screenshots for fast sort"
```

---

### Task 2: React.memo on MediaCard

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx` lines ~267–462
- Modify: `frontend/src/features/images/MediaPage.js` (same section — keep in sync)

**Context:** `MediaCard` is rendered 60–120+ times in the grid. Currently, any state change in `MediaPage` (toggling a favorite, opening a context menu, a re-render from a query update) causes ALL cards to re-render. With `React.memo` + a custom comparator, only the card whose props actually changed re-renders.

**Step 1: Wrap MediaCard with React.memo in `MediaPage.tsx`**

Find the `function MediaCard({` definition (around line 267). Change it from a plain function declaration to a `memo`-wrapped component. Import `memo` at the top if not already imported (it's in the existing `import { useState, ... } from "react"` line).

First, ensure `memo` is in the React import at line 1:
```typescript
import { useState, useCallback, useRef, useMemo, useEffect, memo } from "react"
```

Then wrap the component. Find the closing `}` of the `MediaCard` function (around line 462, ends with `}`). The pattern is to change:

```typescript
function MediaCard({
  shot,
  ...
}: {
  ...
}) {
  // ... body ...
}
```

to:

```typescript
const MediaCard = memo(function MediaCard({
  shot,
  onClick,
  batchMode,
  selected,
  onSelect,
  favorite,
  onToggleFavorite,
  onDescribe,
  onRate,
  onContextMenu,
  onNavigateToPerformer,
}: {
  shot: Screenshot
  onClick: () => void
  batchMode: boolean
  selected: boolean
  onSelect: () => void
  favorite: boolean
  onToggleFavorite: () => void
  onDescribe: () => void
  onRate: (rating: number) => void
  onContextMenu?: (e: React.MouseEvent) => void
  onNavigateToPerformer?: (performerId: number, username: string) => void
}) {
  // ... existing body unchanged ...
}, (prev, next) =>
  prev.shot.id === next.shot.id &&
  prev.shot.rating === next.shot.rating &&
  prev.shot.local_url === next.shot.local_url &&
  prev.shot.ai_summary === next.shot.ai_summary &&
  prev.favorite === next.favorite &&
  prev.selected === next.selected &&
  prev.batchMode === next.batchMode
)
```

The `memo` second argument is the comparator — returns `true` if props are equal (skip re-render), `false` if changed (re-render).

**Step 2: Apply the same change to `MediaPage.js`**

Open `frontend/src/features/images/MediaPage.js`. Find the `MediaCard` function definition. The JS version uses `_jsx` calls but the function signature at the top is the same pattern. Wrap with `memo`:

```javascript
const MediaCard = /*#__PURE__*/memo(function MediaCard({
  shot, onClick, batchMode, selected, onSelect, favorite,
  onToggleFavorite, onDescribe, onRate, onContextMenu, onNavigateToPerformer,
}) {
  // ... existing body ...
}, (prev, next) =>
  prev.shot.id === next.shot.id &&
  prev.shot.rating === next.shot.rating &&
  prev.shot.local_url === next.shot.local_url &&
  prev.shot.ai_summary === next.shot.ai_summary &&
  prev.favorite === next.favorite &&
  prev.selected === next.selected &&
  prev.batchMode === next.batchMode
)
```

Make sure `memo` is imported from react in the `.js` file — find the react import at the top (something like `import { useState, ... } from "react"`) and add `memo` to it.

**Step 3: Stabilize callbacks in `renderCard`**

The `renderCard` function in `MediaPage.tsx` (around line 1489) passes inline arrow functions as props — these are new function instances on every render, defeating memo. Stabilize the callbacks that change per-shot by wrapping `renderCard`'s callbacks with `useCallback` at the parent level, or by ensuring the comparator only checks stable fields (which the comparator above already handles by not checking function identity).

The comparator above intentionally omits function props (onClick, onRate, etc.) — this is correct because those handlers close over `shot.id` which is stable, and the functions themselves are recreated cheaply. The memo only skips re-renders when the visible output won't change.

**Step 4: Verify in browser**

Open the Media page. Toggle a favorite on one card. In React DevTools Profiler (or by adding a console.log inside MediaCard's render body temporarily), confirm only 1–2 cards re-render instead of all 60+.

**Step 5: Commit**

```bash
cd "/Users/chasebauman/Documents/App research codex"
git add frontend/src/features/images/MediaPage.tsx frontend/src/features/images/MediaPage.js
git commit -m "perf: memoize MediaCard to prevent full-grid re-renders"
```

---

### Task 3: React.memo on MosaicCard

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx` lines ~464–554
- Modify: `frontend/src/features/images/MediaPage.js` (same section)

**Context:** Same issue as MediaCard but for the Mosaic view mode. Simpler since it has fewer props.

**Step 1: Wrap MosaicCard in `MediaPage.tsx`**

Find `function MosaicCard({` (around line 466). Wrap identically:

```typescript
const MosaicCard = memo(function MosaicCard({
  shot,
  onClick,
  favorite,
  onToggleFavorite,
  onContextMenu,
}: {
  shot: Screenshot
  onClick: () => void
  favorite: boolean
  onToggleFavorite: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  // ... existing body ...
}, (prev, next) =>
  prev.shot.id === next.shot.id &&
  prev.shot.local_url === next.shot.local_url &&
  prev.favorite === next.favorite
)
```

**Step 2: Apply same change to `MediaPage.js`**

Find and wrap `MosaicCard` in the JS file the same way.

**Step 3: Commit**

```bash
cd "/Users/chasebauman/Documents/App research codex"
git add frontend/src/features/images/MediaPage.tsx frontend/src/features/images/MediaPage.js
git commit -m "perf: memoize MosaicCard to prevent full-mosaic re-renders"
```

---

### Task 4: Shared IntersectionObserver singleton for video autoplay

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx` — `MediaCard` component, lines ~298–308
- Modify: `frontend/src/features/images/MediaPage.js` (same section)

**Context:** Every `MediaCard` that displays a video creates its own `IntersectionObserver` instance in a `useEffect`. With 20+ video cards on screen, that's 20+ active observers. A singleton observer handles all registrations through a single observer with a callback map.

**Step 1: Add the singleton above the MediaCard definition in `MediaPage.tsx`**

Insert this block right before the `const MediaCard = memo(...)` line:

```typescript
// ── Shared video autoplay observer ───────────────────────────────────────────
// One IntersectionObserver for all video cards instead of one per card.
const videoObserver = (() => {
  if (typeof window === "undefined") return null
  const callbacks = new Map<Element, (visible: boolean) => void>()
  const obs = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        callbacks.get(entry.target)?.(entry.isIntersecting)
      }
    },
    { threshold: 0.5 }
  )
  return {
    observe(el: Element, cb: (visible: boolean) => void) {
      callbacks.set(el, cb)
      obs.observe(el)
    },
    unobserve(el: Element) {
      callbacks.delete(el)
      obs.unobserve(el)
    },
  }
})()
```

**Step 2: Update the `useEffect` inside `MediaCard` in `MediaPage.tsx`**

Find the existing per-card observer (lines ~298–308):

```typescript
// Autoplay videos when they scroll into view
useEffect(() => {
  if (!vid || !videoRef.current) return
  const v = videoRef.current
  const obs = new IntersectionObserver(([e]) => {
    if (e.isIntersecting) v.play().catch(() => {})
    else { v.pause(); v.currentTime = 0 }
  }, { threshold: 0.5 })
  obs.observe(v)
  return () => obs.disconnect()
}, [vid])
```

Replace with:

```typescript
// Autoplay videos when they scroll into view — uses shared singleton observer
useEffect(() => {
  if (!vid || !videoRef.current || !videoObserver) return
  const v = videoRef.current
  videoObserver.observe(v, (visible) => {
    if (visible) v.play().catch(() => {})
    else { v.pause(); v.currentTime = 0 }
  })
  return () => videoObserver.unobserve(v)
}, [vid])
```

**Step 3: Apply both changes to `MediaPage.js`**

Add the `videoObserver` singleton constant (using plain JS — no TypeScript types) before the `MediaCard` definition in the `.js` file:

```javascript
// ── Shared video autoplay observer ───────────────────────────────────────────
const videoObserver = (() => {
  if (typeof window === "undefined") return null;
  const callbacks = new Map();
  const obs = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const cb = callbacks.get(entry.target);
        if (cb) cb(entry.isIntersecting);
      }
    },
    { threshold: 0.5 }
  );
  return {
    observe(el, cb) { callbacks.set(el, cb); obs.observe(el); },
    unobserve(el) { callbacks.delete(el); obs.unobserve(el); },
  };
})();
```

Replace the per-card `useEffect` with:

```javascript
useEffect(() => {
  if (!vid || !videoRef.current || !videoObserver) return;
  const v = videoRef.current;
  videoObserver.observe(v, (visible) => {
    if (visible) v.play().catch(() => {});
    else { v.pause(); v.currentTime = 0; }
  });
  return () => videoObserver.unobserve(v);
}, [vid]);
```

**Step 4: Commit**

```bash
cd "/Users/chasebauman/Documents/App research codex"
git add frontend/src/features/images/MediaPage.tsx frontend/src/features/images/MediaPage.js
git commit -m "perf: replace per-card IntersectionObserver with shared singleton"
```

---

### Task 5: Remove CSS jank sources

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx` — `MediaCard` and `MosaicCard` render bodies
- Modify: `frontend/src/features/images/MediaPage.js` (same sections)

**Context:** Two specific CSS choices cause GPU compositing cost on every hover across 60+ cards: `backdrop-blur-sm` (creates a GPU filter layer per-card) and `group-hover:scale-[1.02]` (triggers transform compositing). With dozens of cards, these add up to visible frame drops. Replace with paint-only alternatives.

**Step 1: Remove `backdrop-blur-sm` from MediaCard hover buttons in `MediaPage.tsx`**

In `MediaCard`'s render body, find all occurrences of `backdrop-blur-sm` (there are ~3, on the quick-action buttons in the bottom-right hover overlay around lines 418–452). Remove `backdrop-blur-sm` from each:

```typescript
// BEFORE:
className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm text-white/80 hover:text-red-400 transition-colors"

// AFTER:
className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 hover:text-red-400 transition-colors"
```

**Step 2: Replace scale with brightness in `MediaCard` in `MediaPage.tsx`**

Find `group-hover:scale-[1.02]` on the `<img>` and `<video>` elements inside `MediaCard` (around lines 336, 344). Replace:

```typescript
// BEFORE (on img):
className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"

// AFTER:
className="h-full w-full object-cover transition-[filter] duration-200 group-hover:brightness-110"
```

```typescript
// BEFORE (on video):
className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"

// AFTER:
className="h-full w-full object-cover transition-[filter] duration-200 group-hover:brightness-110"
```

**Step 3: Apply the same changes to `MosaicCard` in `MediaPage.tsx`**

`MosaicCard` has the same `group-hover:scale-[1.02]` on its `<img>` and `<video>` (around lines 505–517). Replace with `group-hover:brightness-110` as above. Also remove `backdrop-blur-sm` from the favorite button (around line 547).

**Step 4: Apply all changes to `MediaPage.js`**

Find the same className strings in the `.js` file and apply the same replacements. Search for `backdrop-blur-sm` and `scale-\[1.02\]` — replace all occurrences inside MediaCard and MosaicCard.

**Step 5: Commit**

```bash
cd "/Users/chasebauman/Documents/App research codex"
git add frontend/src/features/images/MediaPage.tsx frontend/src/features/images/MediaPage.js
git commit -m "perf: remove backdrop-blur and scale transforms from media cards"
```

---

### Task 6: Install @tanstack/virtual

**Files:**
- Modify: `frontend/package.json`

**Step 1: Install the package**

```bash
cd "/Users/chasebauman/Documents/App research codex/frontend"
npm install @tanstack/virtual@^3
```

**Step 2: Verify install**

```bash
node -e "require('@tanstack/virtual'); console.log('ok')"
```

Expected: `ok`

**Step 3: Commit**

```bash
cd "/Users/chasebauman/Documents/App research codex"
git add frontend/package.json frontend/package-lock.json
git commit -m "deps: add @tanstack/virtual for grid virtualization"
```

---

### Task 7: Virtual grid for the flat grid view

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx`
- Modify: `frontend/src/features/images/MediaPage.js`

**Context:** The flat grid view (`viewMode === "grid" && !showGrouped`) renders all accumulated `visibleShots` directly. With infinite scroll, after several pages this can be 300–600 DOM nodes. The virtualizer renders only visible rows.

The approach: group `visibleShots` into rows based on the column count from `gridDensity`. Pass those rows to `useWindowVirtualizer` which uses the window as scroll container. Each virtual row renders its N cards normally.

**Step 1: Add column count helper and row grouping to `MediaPage.tsx`**

Add near the `GRID_CLASSES` constant (around line 124):

```typescript
const GRID_COLS: Record<GridDensity, number> = {
  compact: 7,   // matches lg:grid-cols-7 (use lg breakpoint as default)
  normal: 5,    // matches lg:grid-cols-5
  spacious: 4,  // matches lg:grid-cols-4
}
```

**Step 2: Add the virtual flat grid in `MediaPage.tsx`**

Add this import at the top of the file with the other imports:

```typescript
import { useWindowVirtualizer } from "@tanstack/virtual"
```

Inside the `MediaPage` function body, add a new derived value after `visibleShots` is computed (around line 1193):

```typescript
// Group visibleShots into rows for the virtual flat grid
const colCount = GRID_COLS[gridDensity]
const flatGridRows = useMemo(() => {
  if (viewMode !== "grid" || showGrouped) return []
  const rows: Screenshot[][] = []
  for (let i = 0; i < visibleShots.length; i += colCount) {
    rows.push(visibleShots.slice(i, i + colCount))
  }
  return rows
}, [visibleShots, viewMode, showGrouped, colCount])
```

Add the virtualizer hook right after:

```typescript
const flatGridVirtualizer = useWindowVirtualizer({
  count: flatGridRows.length,
  estimateSize: () => 160, // approximate row height in px — cards are aspect-square, ~160px per row at normal density
  overscan: 3,
})
```

**Step 3: Replace the flat grid render section in `MediaPage.tsx`**

Find the "Grid view: flat" section (around line 2139–2144):

```tsx
{/* ── Grid view: flat ──────────────────────────────────────────────── */}
{tab !== "creators" && !isLoading && visibleShots.length > 0 && viewMode === "grid" && !showGrouped && (
  <div className={cn("grid py-2", gridClass)}>
    {renderGrid(visibleShots)}
  </div>
)}
```

Replace with:

```tsx
{/* ── Grid view: flat (virtualized) ───────────────────────────────── */}
{tab !== "creators" && !isLoading && visibleShots.length > 0 && viewMode === "grid" && !showGrouped && (
  <div
    style={{
      height: `${flatGridVirtualizer.getTotalSize()}px`,
      position: "relative",
    }}
    className="py-2"
  >
    {flatGridVirtualizer.getVirtualItems().map((virtualRow) => {
      const rowShots = flatGridRows[virtualRow.index]
      if (!rowShots) return null
      return (
        <div
          key={virtualRow.key}
          data-index={virtualRow.index}
          ref={flatGridVirtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${virtualRow.start}px)`,
          }}
          className={cn("grid", gridClass)}
        >
          {renderGrid(rowShots)}
        </div>
      )
    })}
  </div>
)}
```

**Step 4: Apply to `MediaPage.js`**

In `MediaPage.js`:

1. Add import at the top:
```javascript
import { useWindowVirtualizer } from "@tanstack/virtual";
```

2. Add `GRID_COLS` constant near `GRID_CLASSES`:
```javascript
const GRID_COLS = { compact: 7, normal: 5, spacious: 4 };
```

3. Inside the `MediaPage` function, add `flatGridRows` and `flatGridVirtualizer` (plain JS, no TypeScript types):
```javascript
const colCount = GRID_COLS[gridDensity];
const flatGridRows = useMemo(() => {
  if (viewMode !== "grid" || showGrouped) return [];
  const rows = [];
  for (let i = 0; i < visibleShots.length; i += colCount) {
    rows.push(visibleShots.slice(i, i + colCount));
  }
  return rows;
}, [visibleShots, viewMode, showGrouped, colCount]);

const flatGridVirtualizer = useWindowVirtualizer({
  count: flatGridRows.length,
  estimateSize: () => 160,
  overscan: 3,
});
```

4. Find and replace the flat grid JSX in the `.js` file to match the `.tsx` version above (using `_jsx`/`_jsxs` calls if the file uses them, or direct JSX if the file uses JSX syntax).

**Step 5: Verify**

Open the app, go to the Media page. Scroll down — DOM inspector should show that only ~10–15 rows are present in the DOM at any time, not all rows. As you scroll, rows recycle. The infinite scroll sentinel at the bottom should still trigger loading more pages.

**Step 6: Commit**

```bash
cd "/Users/chasebauman/Documents/App research codex"
git add frontend/src/features/images/MediaPage.tsx frontend/src/features/images/MediaPage.js
git commit -m "perf: virtualize flat media grid with @tanstack/virtual window virtualizer"
```

---

### Task 8: Production build and bundle check

**Files:** None modified

**Step 1: Build**

```bash
cd "/Users/chasebauman/Documents/App research codex/frontend"
npm run build 2>&1 | tail -30
```

**Step 2: Check bundle sizes**

Expected after changes:
- `MediaPage-*.js` should be similar size (we added a small dep)
- `vendor-*` chunks unchanged
- No new large chunks added

If build fails, check for TypeScript errors around the new `useWindowVirtualizer` import or the `GRID_COLS` constant.

**Step 3: Smoke test**

```bash
# Restart backend if needed
# Open http://localhost:5173
# Navigate to Media page
# Check: grid renders, scroll works, infinite scroll loads more pages
# Check: toggling a favorite re-renders only that card (not all cards)
```

**Step 4: Final commit (if any fixups needed)**

```bash
cd "/Users/chasebauman/Documents/App research codex"
git add -A
git commit -m "perf: build verification and fixups"
```
