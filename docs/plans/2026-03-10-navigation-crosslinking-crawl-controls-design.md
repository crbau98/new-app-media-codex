# Navigation Cross-Linking & Crawl Controls Design

**Date:** 2026-03-10
**Status:** Approved

## Problem

The five views (Overview, Items, Images, Hypotheses, Graph) are isolated — there is no way to drill from a stat card into filtered Items, no way to trigger a screenshot capture from the UI, and the FiltersBar does not expose visual_capture/ddg/redgifs sources that already exist in the DB.

## Goals

1. Every stat and chart on Overview navigates to a relevant filtered view on click.
2. Crawl and Capture can be triggered from the sidebar — always one click away.
3. FiltersBar exposes all source types including visual_capture, ddg, redgifs.
4. Hypothesis cards link back to Items so users can trace AI reasoning.

## Non-Goals

- Per-source crawl selection
- Crawl scheduling
- Backend changes (all changes are frontend-only except one store action)

---

## Section 1: Sidebar — Capture Button

**File:** `frontend/src/components/Sidebar.tsx` (`CrawlFooter`)

The existing `CrawlFooter` has a "Run Now" crawl button. Add a second "Capture" button alongside it.

- Poll `/api/screenshots/status` every 3 s (idle) / 1 s (running) for `screenshotRunning` state
- Add `screenshotRunning` + `setScreenshotRunning` to Zustand store (`store.ts`)
- Capture button calls `api.triggerCapture()` (POST `/api/screenshots/trigger`) — already exists
- Both buttons show their own pulsing status dot (green = idle, orange-pulse = running)
- **Collapsed sidebar:** two icon buttons stacked (play ▶ for crawl, camera 📷 for capture)
- **Expanded sidebar:** two full-width buttons side by side with status dots + labels

---

## Section 2: Clickable StatsBar + Overview Cross-Linking

### StatsBar (`frontend/src/features/analytics/StatsBar.tsx`)

Each stat card becomes a `<button>` with `onClick` → `setActiveView` + `setFilter`:

| Card | Action |
|------|--------|
| Total items | `setActiveView('items')`, no extra filter |
| Saved | `setActiveView('items')` + `setFilter('savedOnly', true)` |
| Hypotheses | `setActiveView('hypotheses')` |
| Images | `setActiveView('images')` |
| Last run | No action (info only) |

Cards gain `hover:border-accent/40 cursor-pointer` styling. A subtle `→` arrow appears on hover.

### Themes Quick-Nav Row (`frontend/src/features/overview/OverviewPage.tsx`)

Below the StatsBar, add a horizontal scrollable row of 8 theme pills (one per `settings.themes` fetched from `/api/dashboard`). Each pill shows the theme label. Clicking → `setActiveView('items')` + `setFilter('theme', slug)`.

### Source Donut — Clickable Slices

Recharts `<Pie>` already supports `onClick`. Add `onClick={(entry) => { setActiveView('items'); setFilter('sourceType', entry.name) }}` to the Pie component.

### Theme Trend Chart — Clickable Legend

Recharts `<Legend>` supports `onClick`. Add handler: `setActiveView('items')` + `setFilter('theme', legendItem.value)`.

---

## Section 3: FiltersBar — Visual Capture Sources

**File:** `frontend/src/features/items/FiltersBar.tsx`

Add three entries to the `SOURCES` array:

```ts
const SOURCES = [
  'pubmed', 'biorxiv', 'arxiv', 'reddit', 'x', 'lpsg', 'web',
  'visual_capture', 'ddg', 'redgifs',   // ← new
]
```

Display labels in the `<select>`: map each value to a human label:
- `visual_capture` → "Visual Capture"
- `ddg` → "DDG Images"
- `redgifs` → "Redgifs"

Use a `SOURCE_LABELS` map for rendering so existing sources also get cleaner labels (e.g. `pubmed` → "PubMed", `biorxiv` → "bioRxiv").

---

## Section 4: Hypothesis → Items Link

**File:** `frontend/src/features/hypotheses/HypothesisCard.tsx`

Add a small "View source items →" text link at the bottom of each card's action row.

On click: `setActiveView('items')` + `setFilter('sort', 'score')` — navigates to Items sorted by top score, which surfaces the highest-quality items the AI likely used to generate the hypothesis.

No backend changes required.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/store.ts` | Add `screenshotRunning`, `setScreenshotRunning` |
| `frontend/src/components/Sidebar.tsx` | Capture button in `CrawlFooter`, screenshot status polling |
| `frontend/src/features/analytics/StatsBar.tsx` | Clickable cards with navigation |
| `frontend/src/features/overview/OverviewPage.tsx` | Themes quick-nav row, donut + trend chart click handlers |
| `frontend/src/features/items/FiltersBar.tsx` | 3 new source options + SOURCE_LABELS map |
| `frontend/src/features/hypotheses/HypothesisCard.tsx` | "View source items →" link |

## Implementation Order

Tasks should be executed sequentially (each builds on shared store changes):

1. `store.ts` — add `screenshotRunning` state
2. `Sidebar.tsx` — Capture button + polling
3. `StatsBar.tsx` — clickable navigation cards
4. `OverviewPage.tsx` — themes row + chart click handlers
5. `FiltersBar.tsx` — new source options
6. `HypothesisCard.tsx` — source items link
7. Rebuild frontend + smoke test all navigation flows
