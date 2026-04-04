# Design: UI Polish, Power Features & Screenshot Pipeline

**Date:** 2026-03-10
**Status:** Approved
**Approach:** B — Layout Overhaul + Items Power Features + Screenshot-based Media

---

## Overview

Two parallel tracks:
1. **UI/UX upgrade** — polish AppShell, supercharge Items feed, improve Overview
2. **Media overhaul** — replace image scraping with a Playwright screenshot pipeline for specific explicit terms

---

## 1. AppShell & Layout

### Sidebar (220px → 260px)
Grouped nav sections with labeled dividers:

```
RESEARCH
  Overview
  Items          [badge: unread count]
  Graph

MEDIA
  Images

AI
  Hypotheses     [badge: unread count]

────────────────────
  ● Last crawl: 2h ago
  ○ Next: 1h 12m
  [▶ Run Now]
```

- Collapse toggle: icon-only mode at 64px width (persisted in localStorage)
- Section labels styled as uppercase muted text, 11px
- Active item: left border accent + bg highlight
- Footer: last crawl timestamp, countdown to next crawl, manual Run Now button

### Top Bar
- Global search styled as real input with `⌘K` hint
- Crawl status indicator: idle dot → animated progress bar when running
- Settings icon (reserved, no functionality yet)

---

## 2. Items Feed

### Item Detail Drawer
- Triggered by clicking any SourceCard
- 400px panel slides in from right, list compresses (no overlay)
- Content: full summary, all metadata, compounds/mechanisms as clickable badges, inline notes editor, save/archive/shortlist actions
- Keyboard: `Esc` or `←` to close
- Selection synced while scrolling list

### Filter Bar Upgrade
```
[🔍 Search...] [Source ▾] [Theme ▾] [Status ▾] [+ Add filter]
Active chips: source:reddit × theme:libido ×    [clear all] [💾 Save preset]
```
- Active filters render as dismissible chips below search bar
- Save preset: names current filter combination, persisted in localStorage
- Preset pills shown at top of filter bar for one-click recall

### SourceCard Polish
- Source platform icon (small SVG/emoji logo) instead of text badge
- Score as thin colored progress bar on left accent strip
- Density toggle (top-right of page): Compact / Comfortable / Spacious

### Keyboard Navigation
| Key | Action |
|-----|--------|
| `J` / `K` | Move selection down / up |
| `Enter` | Open detail drawer |
| `S` | Toggle save |
| `E` | Archive item |
| `Esc` | Close drawer |

---

## 3. Media — Screenshot Pipeline

### What Changes
- All research-theme image scraping removed from Media page
- New Playwright-based screenshot capture for specific terms only

### Terms
`penis`, `cock`, `hyperspermia`, `ejaculate`, `twink`, `twunk`, `foreskin`

### Sources
- DuckDuckGo Images
- Tumblr
- X (Twitter)

### Backend Pipeline (`app/sources/screenshot.py`)
1. For each term × source combination:
   - Search the term on the platform
   - Iterate individual results (not the grid)
   - Open each result URL in headless Playwright browser
   - Screenshot at 1280×800 → save as PNG to `data/screenshots/`
   - Store in new `screenshots` DB table: `term`, `source`, `page_url`, `local_path`, `captured_at`
2. Runs as separate APScheduler job (configurable interval, default 12h)
3. Deduplication by `page_url`

### New DB Table: `screenshots`
```sql
CREATE TABLE screenshots (
  id INTEGER PRIMARY KEY,
  term TEXT NOT NULL,
  source TEXT NOT NULL,        -- 'ddg' | 'tumblr' | 'x'
  page_url TEXT NOT NULL UNIQUE,
  local_path TEXT NOT NULL,
  captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### API
- `GET /api/screenshots` — paginated, filter by term + source
- `POST /api/screenshots/capture` — trigger capture job manually

### Media Page UI
- Term filter pills: All | penis | cock | twink | twunk | foreskin | hyperspermia | ejaculate
- Source filter: All | DDG | Tumblr | X
- Capture Now button with progress indicator: `Capturing 4/18 for "twink" from Tumblr... ████░░ 44%`
- Gallery: existing masonry layout, cards show term badge + source icon + date
- Lightbox: full-size screenshot

---

## 4. Overview Page

- **Theme Trend Chart**: add toggle between "by theme" and "by source" views
- **Source donut chart**: items split by source (reddit, pubmed, arxiv, x, etc.)
- **Recent Runs panel**: last 5 crawl runs — timestamp, items added, duration, status
- **Stats bar**: animated count-up on load

---

## 5. General Polish

| Item | Detail |
|------|--------|
| View transitions | 150ms fade between views |
| Toast notifications | Bottom-right toasts for save/archive/bulk actions |
| Empty states | Illustrated empty states with action CTAs |
| Loading skeletons | Consistent shimmer across Items, Images, Graph |
| Scroll restoration | Remember scroll position per view |

---

## Architecture Notes

- Playwright added as new backend dependency (`playwright`, `playwright install chromium`)
- Screenshot job isolated from main crawl pipeline — separate scheduler entry
- Frontend MediaPage refactored: new `useScreenshots()` infinite query hook replacing `useImages()`
- Filter presets + sidebar collapse state stored in localStorage (not Zustand — no need to persist to server)
- Drawer state in Zustand: `selectedItemId: number | null`
- Keyboard nav: global `keydown` listener in ItemsPage, only active when drawer-capable view is focused

---

## Out of Scope

- Settings page (icon reserved)
- Graph view changes
- Hypotheses workflow changes
- Mobile/responsive layout
