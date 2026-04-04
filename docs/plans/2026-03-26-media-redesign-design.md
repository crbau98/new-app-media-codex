# Media Section Redesign — Design Document

**Date:** 2026-03-26
**Goal:** Rebuild the media section to feel like Instagram Explore / X — clean grid, inline video playback, minimal chrome.

---

## Decisions

- **Layout:** Multi-column grid feed (Instagram Explore style), no collections/filmstrip modes
- **Video click:** Expand inline in the grid (X-style), not a lightbox modal
- **Image click:** Keep lightbox (full-viewport viewing + nav arrows)
- **Simplification:** Aggressive — kill hero banner, stat cards, view mode toggles, grid size chips, shuffle, separate AI search, telegram section from media page
- **Card style:** Square 1:1 aspect ratio, no overlays by default, tight gaps, flat edges (like Instagram Explore)

---

## Section 1: Page Structure

**Removed:**
- Hero banner ("Browse captured evidence...")
- 3 stat cards (Visible Media, Tracked Terms, Favorites)
- Collections view mode + filmstrip view mode (grid only)
- Grid size chips (compact/normal/large) — were broken, all same CSS
- Shuffle button
- Separate AI Search bar (merged into main search)
- Term scroll arrows
- Telegram section (moves to Settings)

**New layout (top to bottom):**
1. Compact toolbar: search bar + sort dropdown + select button
2. Source/filter tabs: All | DDG (N) | Redgifs (N) | Favorites (N) | Videos | Images
3. Grid of square cards with infinite scroll
4. Term section headers in the grid when browsing "All" — click to filter

---

## Section 2: Inline Video Player

**Behavior:** Click a video card → expands to col-span-full in the grid, pushes cards below down with CSS transition.

- Native `<video controls>` with scrub bar, volume, fullscreen
- Below video: term, source badge, date, action buttons (favorite, source URL, AI describe, delete)
- Escape or click close → collapses back to thumbnail
- Only one expanded video at a time

**Autoplay in grid:**
- IntersectionObserver starts muted playback when video scrolls into viewport
- Pauses when scrolling out
- Hover still works on desktop as secondary trigger

**Images:** Still open lightbox on click (different from videos).

---

## Section 3: Toolbar + Smart Search

**One toolbar row:**
- Search bar (left) — searches term/source/URL locally; auto-hits FTS when 3+ words or no local matches
- Sort dropdown (right) — Newest, Oldest, A-Z
- Select button (right) — batch mode toggle

**Source tabs (below toolbar):**
- Horizontal scrollable row: All (N) | DDG (N) | Redgifs (N) | Favorites (N) | Videos | Images
- Active tab gets underline accent
- Replaces separate source pills + type filter + favorites filter (3 rows → 1)

**Term filtering:**
- Terms appear as section headers in the grid when browsing "All"
- Click a section header → filters to that term
- Click "All" tab → removes filter

---

## Section 4: Card Design

**Default state:**
- Square 1:1 aspect ratio, `object-cover`
- No overlays, clean thumbnail
- Videos: small play triangle bottom-right corner (always visible)
- Favorited items: small filled heart top-right corner (always visible)

**Hover state (desktop):**
- Semi-transparent bottom gradient with term + source + favorite heart
- `scale(1.02)` lift
- Videos start playing muted

**Grid layout:**
- `grid-cols-3` mobile, `grid-cols-4` tablet, `grid-cols-5` desktop
- `gap-1` — tight, edge-to-edge like Instagram Explore
- Videos: `col-span-2 row-span-2` (2x2 square)
- No rounded corners — flat squares

**Selection state:** Blue ring + checkmark (unchanged).

---

## Files Changed

- **Rewrite:** `frontend/src/features/images/MediaPage.tsx` — from 1609 lines to ~600
- **Modify:** `frontend/src/features/images/ScreenshotLightbox.tsx` — images only (no video lightbox)
- **Modify:** `frontend/src/index.css` — add grid styles, remove unused card-glass utilities from media
- **Move:** Telegram UI to settings page or separate component (out of MediaPage)
