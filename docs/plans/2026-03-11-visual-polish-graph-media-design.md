# Design Doc: Visual Polish + Graph & Media Improvements

**Date:** 2026-03-11
**Approach:** Polish-first (Approach A) — upgrade existing design language without changing layout model.
**Goal:** Make the app look like a professional graphic designer built it, with targeted functional improvements to the Graph and Media pages.

---

## Workstream 1 — Design System & Global Polish

### Icon Unification
Replace all emoji source icons with Lucide React icons. Current state uses `🟠 🔬 📄 🦆 🧬 💬 🔥` inline in `SOURCE_ICONS` maps across SourceCard, FiltersBar, and other components. Lucide provides a consistent, crisp, SVG-based icon set already used in parts of the app.

- Install `lucide-react` if not present (check package.json)
- Map each source type to a Lucide icon: Reddit→`MessageSquare`, PubMed→`Microscope`, arXiv/bioRxiv→`FileText`, X/Twitter→`Twitter`, LPSG→`MessageCircle`, DDG→`Search`, Web→`Globe`, Firecrawl→`Flame`, Visual Capture→`Camera`
- Create a shared `SourceIcon` component in `components/SourceIcon.tsx`

### Background Texture
Add a subtle dot-grid pattern to `bg-base` via CSS (SVG data URI background-image). Common in polished dark UIs — adds depth without visual noise.

```css
/* In index.css, on body or #root */
background-image: radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px);
background-size: 24px 24px;
```

### Unified TagChip Component
Create `components/TagChip.tsx` — a single component for compound/mechanism tags used everywhere. Props: `variant: 'compound' | 'mechanism'`, `label: string`, `onClick?: () => void`, `size?: 'sm' | 'md'`. Replaces ad-hoc styled `<button>` and `<span>` tags in SourceCard, ItemDrawer, and OverviewPage.

### Typography Refinements
- Page/section titles: `font-semibold` → `font-bold` (700), bump to `text-base` where currently `text-sm`
- Mono labels (domain, score, date): tighten `letter-spacing` to `-0.01em`
- Better visual hierarchy: reduce overuse of `text-text-muted` — use `text-text-secondary` more for mid-priority content

### Recharts Theme Extraction
Replace hardcoded hex strings in chart `contentStyle`/`labelStyle`/`itemStyle` with CSS variable references. Create a shared `CHART_TOOLTIP_STYLE` constant in `lib/chartTheme.ts`.

---

## Workstream 2 — SourceCard & ItemsPage

### Card Visual Hierarchy
- Title: `text-sm font-medium` → `text-[15px] font-semibold`, `line-clamp-2` stays
- Replace left accent score bar with a **score pill** in the metadata row: `◆ 7.4` using `text-accent font-mono text-xs`
- Remove the left bar entirely (it's too subtle to be useful)
- Metadata row: source icon (Lucide) + source type + theme badge + status badge + score pill — all on one line, `gap-1.5 flex-wrap`

### Action Buttons
- Replace `★ ☆ ▶ ✕` text labels with Lucide icons: `Bookmark`/`BookmarkCheck`, `ChevronRight`, `Archive`
- Add `title` tooltips (already exist), ensure `aria-label` is set
- Button hover state: `hover:bg-accent/10` for save, `hover:bg-green/10` for shortlist, `hover:bg-red/10` for archive — color-coded affordance

### Empty States
- "No items found" with active filters → show which filters are active, add "Clear filters" CTA
- "No items found" with no data → show "Run a crawl to collect research items" with crawl button

---

## Workstream 3 — Overview Page

### StatsBar
- Increase number font size: `text-3xl font-bold` for primary counts
- Add subtle animated count-up on mount (CSS counter or simple JS interval, 400ms)
- Visual separation: cards use `border` + `bg-bg-surface` with hover `bg-bg-elevated`

### TopTagsPanel
- Two-column grid layout: compounds (teal) on left, mechanisms (purple) on right
- Section labels: "Compounds" and "Mechanisms" in small caps above each column
- Count badge: `bg-teal/20 text-teal` pill next to each compound name

### Chart Tooltip
- Extract to `lib/chartTheme.ts`: `CHART_TOOLTIP_STYLE`, `CHART_LABEL_STYLE`, `CHART_ITEM_STYLE`
- All Recharts tooltips across Overview import from this file

---

## Workstream 4 — Graph Page

### D3 Zoom & Pan
- Add `d3.zoom()` behavior to the SVG element
- On zoom: scale the `<g>` container via `transform`
- Scroll = zoom, drag = pan (standard D3 zoom behavior)
- Add corner controls: `+` / `−` / `⌂` (reset) buttons, positioned `absolute bottom-4 right-4`

### Label Collision Avoidance
- Move node labels from static SVG `<text>` to a separate force: add `d3.forceCollide` with radius = `node.radius + labelWidth/2`
- Labels offset from node center by `node.radius + 4px` on X axis
- For small nodes (radius < 8), hide label when zoomed out (show on hover only)

### Node Type Visibility Toggles
- The existing compound/mechanism/theme badge buttons in the header become real toggles
- State: `hiddenTypes: Set<'compound' | 'mechanism' | 'theme'>` in component state
- Nodes of hidden type: `opacity: 0` + `pointer-events: none` + remove from simulation forces
- Links connecting hidden nodes also hidden

---

## Workstream 5 — Media Page

### Dynamic Term List
- Fetch distinct terms from a new/existing API endpoint: `GET /api/browse/screenshots?distinct_terms=true` or re-use the existing `/api/browse/screenshots` response which includes term metadata
- Replace hardcoded `SEARCH_TERMS` array in MediaPage with API-driven list
- Terms sorted by count descending, show count badge on each term pill (same pattern as TopTagsPanel)

### Masonry Grid Upgrade
- Replace CSS `columns` with **span-based CSS grid masonry**:
  ```css
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  grid-auto-rows: 10px;
  ```
  Each image card sets `grid-row-end: span N` where N = `Math.ceil(imageHeight / 10 + gap)`
- Eliminates layout reflow on image load; images placed correctly immediately
- JavaScript: `ResizeObserver` on each card to update span on image load

### Image Card Hover
- Info overlay: `translate-y-full` → `translate-y-0` on hover, `transition-transform duration-200`
- Overlay: semi-transparent `bg-gradient-to-t from-black/80 to-transparent`, contains term + source + date + external link icon
- Remove abrupt `opacity` toggle, replace with smooth slide-up

---

## Implementation Notes

- **Source files are `.tsx`**, compiled to `.js` via `tsc -b` + `vite build`. Both `.tsx` source and `.js` output are committed.
- **Lucide React**: check if already in `package.json` before installing
- **No layout changes to AppShell, Sidebar, or TopBar** — structure stays the same, only visual layer upgrades
- **Each workstream is independent** — agents can work in parallel without merge conflicts (different files)

---

## File Ownership Per Workstream

| Workstream | Primary Files |
|---|---|
| 1 — Design System | `components/SourceIcon.tsx`, `index.css`, `components/TagChip.tsx`, `lib/chartTheme.ts` |
| 2 — SourceCard & Items | `features/items/SourceCard.tsx`, `features/items/ItemsPage.tsx`, `features/items/ItemDrawer.tsx` |
| 3 — Overview | `features/overview/OverviewPage.tsx`, `features/analytics/StatsBar.tsx`, `features/analytics/ThemeTrendChart.tsx` |
| 4 — Graph | `features/graphs/GraphPage.tsx` (or equivalent graph component) |
| 5 — Media | `features/images/MediaPage.tsx`, `features/images/ImageCard.tsx` |
