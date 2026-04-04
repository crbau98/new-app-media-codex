# UI Changelog

## 2026-03-12 — Comprehensive UI Polish Pass

### TopBar (`src/components/TopBar.tsx`)
- **Collapsed from two rows to one slim row.** Previous layout had a tall header with breadcrumb + actions on separate lines; now a single 44px pill-shaped bar.
- Added **inline global quick-search** form (hidden on mobile, `max-w-sm`, navigates to Items view on submit).
- Added **compact stat pills** (item count + hypothesis count) that navigate to their respective views on click.
- Shrunk crawler status indicator to a tight pill with a dot/spinner icon.
- Removed redundant "Shortcuts" label; kept the `?` icon button.
- Reduced `AppShell` main-content top-padding from `pt-24 lg:pt-28` → `pt-[72px] lg:pt-[68px]` to reclaim vertical space.

### FiltersBar (`src/features/items/FiltersBar.tsx`)
- **Replaced `window.prompt()` with `SavePresetInline` component** — an inline text input with Enter-to-commit and Escape-to-cancel, no browser dialog.
- Reorganised into a primary row (search + Saved toggle + Filters toggle + Clear all) with a **collapsible advanced panel** for Source / Status / Date range.
- Added **active filter chips** row — each chip shows `label: value` and can be individually dismissed.
- Added badge counter on the Filters button showing number of active filters.
- Advanced panel uses a `grid-cols-2 sm:grid-cols-4` layout with labeled inputs for better scanability.

### OverviewPage (`src/features/overview/OverviewPage.tsx`)
- Replaced cramped 3-column grid with a **`[1fr_320px]` two-column layout** — main content left, fixed 320px sidebar right.
- Added `SectionHeading` helper with optional action slot.
- `RecentActivityStrip` now shows 8 items; clicking an item opens the detail drawer.
- `ActivityFeed` extended to 20 items with badge + title + timestamp row design.
- `RecentRuns` uses divide-y rows instead of plain `space-y`.
- Cleaner loading skeleton and styled error state.

### HypothesesPage (`src/features/hypotheses/HypothesesPage.tsx`)
- **Widened page container** from `max-w-3xl` → `max-w-4xl` for both the main return and empty state.
- **InsightsBar redesigned** from flat pill badges to a **5-column stat grid** (Total / Reviewing / Promoted / Dismissed / Saved), each with a coloured background token and mono number display.

### ItemsPage (`src/features/items/ItemsPage.tsx`)
- **Density switcher icons replaced** — was `≡ ▤ ▦` Unicode; now uses proper inline SVG icons (compact lines / two rects / two tall rects) grouped inside a bordered pill with active highlight.
- **Visited-item state cleaned up** — removed the floating absolute "Seen" badge overlay. Now handled by passing `visited` prop to `SourceCard`, which applies a left-edge muted border indicator and dims the title to `text-text-secondary`. Wrapper uses `opacity-70` (was `opacity-60`).
- Removed "j/k navigate" inline hint from toolbar (shortcut help lives in the Shortcuts modal).

### SourceCard (`src/features/items/SourceCard.tsx`)
- Accepts new `visited?: boolean` prop.
- **Visited state**: subtle left `w-0.5` border strip + title colour shifts to `text-text-secondary` instead of primary.
- Added `card-hover` utility class for consistent shadow-lift on hover across all cards.
- Swapped `transition-all duration-150` for the `card-hover` CSS class (border, shadow, background transition).
- Title `<a>` now conditionally applies `text-text-secondary` vs `text-text-primary` based on visited state.

### CSS (`src/index.css`)
- **Added missing `@keyframes fade-in`** — SourceCard referenced this animation but it was undefined, so stagger animations were silently broken. Now cards enter with a 6px translateY + opacity fade.
- Added `@keyframes slide-in-right` and `@keyframes scale-in` for future drawer/modal/chip use.
- Added **`.card-hover`** utility: `transition: border-color + box-shadow + background-color 150ms ease` with a `hover` rule adding `0 8px 24px rgba(0,0,0,0.22) + 1px accent ring`.
- Added **`.chip-enter`** utility using `scale-in` for badge/chip entrance.
- Added **`.row-hover`** utility for table/list row hover backgrounds.

### Files touched
- `frontend/src/components/TopBar.tsx`
- `frontend/src/components/AppShell.tsx`
- `frontend/src/features/items/FiltersBar.tsx`
- `frontend/src/features/items/ItemsPage.tsx`
- `frontend/src/features/items/SourceCard.tsx`
- `frontend/src/features/overview/OverviewPage.tsx`
- `frontend/src/features/hypotheses/HypothesesPage.tsx`
- `frontend/src/index.css`

### TypeScript
All files pass `tsc -b --noEmit` with zero errors.
