# Full Redesign — Design Document

**Date:** 2026-03-22
**Scope:** Approach C — Full redesign + new features
**Primary workflow:** Media gallery browsing

---

## 1. Navigation & Routing

- **Hash-based URL routing** — sync Zustand `activeView` to `#/media`, `#/items`, `#/hypotheses`, etc. Browser back/forward, bookmarkable pages, shareable links. No React Router migration needed.
- **Deep links for media** — `#/media?term=ejaculate&source=redgifs` preserves filter state in URL.
- **Mobile bottom tab bar** — 5 icons (Dashboard, Items, Media, Hypotheses, Graph) pinned to bottom on `<768px`. Replaces hamburger sidebar.
- **Desktop sidebar polish** — collapse to 48px icon-only rail with tooltips, spring animation on expand.

## 2. PWA & Installability

- **Web App Manifest** — `manifest.json` with app name, icons (192px + 512px), theme color, `display: standalone`.
- **Service Worker** — cache app shell for instant load. Stale-while-revalidate for API responses. Offline mode with stale data.
- **Install prompt** — subtle banner on first visit with dismiss.
- **Push notifications** — browser notification when crawl/capture finishes (user opt-in, Web Push API).
- **Offline media** — favorited images/videos cached in service worker for offline viewing.

## 3. Visual Redesign

- **Glassmorphism** — frosted glass cards (`backdrop-filter: blur(16px)`), semi-transparent backgrounds, subtle border glow on hover.
- **Gradient accents** — accent color picker generates gradient pairs (blue→cyan, purple→pink).
- **Micro-animations** — card hover scale (1.02), page crossfade transitions, filter chip animate in/out, skeleton gradient sweep, toast slide+fade, lightbox zoom-from-thumbnail.
- **Typography** — Inter for UI, JetBrains Mono for data/stats. Gradient text on page titles.
- **Ambient glow** — active sidebar item emits colored glow. High-score cards get accent border pulse. Media cards get color-extracted ambient shadow.
- **4-tier depth system** — base (darkest bg) → surface (cards) → elevated (modals) → floating (tooltips). Each tier lighter with more blur.
- **Loading states** — branded skeleton screens matching layout shape. Shimmer uses accent gradient.

## 4. Media Gallery Redesign (Hero Experience)

- **Smart Collections** — auto-group by term. Collection cards with item count, date, 4-image mosaic preview.
- **View modes** — masonry grid, filmstrip (horizontal scroll), fullscreen slideshow.
- **Immersive lightbox** — near-black background, image/video fills viewport, swipe nav on mobile, pinch-to-zoom, info panel slides up from bottom, floating glass pill buttons.
- **Video-first** — videos get 2x-width cards, hover shows 3s silent preview, lightbox has full playback controls (scrub, volume, fullscreen, speed).
- **Quick actions** — long-press/right-click context menu: Favorite, Open source, AI Describe, Delete, Copy.
- **Virtual rendering** — only render visible cards + buffer. Handles thousands without jank. Scroll position preserved.
- **Batch mode** — "Select" enters multi-select, tap to toggle, bottom action bar: Delete N, Favorite N, AI Describe N. Swipe-to-select on mobile.
- **Filter bar** — sticky with glass effect. Source pills with count badges. Term autocomplete. Sort with visual icons.
- **Capture progress overlay** — glass bar showing current term, percentage, items found, cancel button.

## 5. AI Features (Uncensored NSFW)

- **AI Describe** — "Describe" button in lightbox. Typing animation while generating. Summary persists and shows in info panel.
- **Batch AI Describe** — multi-select + "AI Describe N". Sequential calls with progress indicator.
- **AI Search** — natural language queries ("muscular guy outdoors"). SQLite FTS on `ai_summary` column. Fallback to term search.
- **Smart recommendations** — "More like this" in lightbox. Keyword overlap scoring on AI summaries.
- **Hypothesis generation trigger** — explicit "Generate Hypotheses" button with theme selection and progress.
- **AI content scan** — enhanced scan report with counts and undo (soft-delete, 24h recovery).
- **Uncensored model support** — settings page has Vision AI section: base URL, model, API key, presets for Ollama/Together/OpenRouter.
- **NSFW prompts** — describe sexual content in clinical/descriptive detail. No censorship in descriptions.
- **Auto-tagging** — extract structured tags from descriptions: body type, act type, anatomy, solo/duo/group. Stored as JSON. Powers search + recommendations.
- **Refusal detection** — backend detects model refusals, returns `"refused": true`. UI shows "try an uncensored model" with link to settings.

## 6. Feature Completions

- **Command Palette (⌘K)** — navigate views, search items/media/hypotheses, trigger crawl/capture, toggle settings. Fuzzy search, keyboard nav, recent commands.
- **Settings persistence** — `/api/settings` endpoint. `settings` SQLite table. Frontend syncs on load, writes on change. localStorage as fast cache.
- **Dynamic theme list** — fetch from API, not hardcoded. New themes appear everywhere immediately.
- **Code splitting** — `React.lazy()` for GraphPage (D3) and OverviewPage (Recharts). ~400KB savings on initial load.
- **Capture progress** — backend tracks `current_term`, `terms_done`, `terms_total`, `items_found` in `app.state`. Frontend polls every 2s.
- **Export upgrades** — media favorites as ZIP, items as Markdown, hypotheses as document.
- **Keyboard shortcuts** — `f` favorite, `d` describe, arrows navigate, `Escape` close, `Space` play/pause, `m` batch mode.

## 7. Mobile Experience

- **Bottom tab bar** — 5 tabs with gradient accent indicator. Settings via gear icon in top-right.
- **Touch gestures** — swipe left/right navigate lightbox, swipe down dismiss, pinch-to-zoom, double-tap 2x zoom. 48px minimum touch targets.
- **Mobile grid** — 2 columns phone, 3 tablet. Long-press replaces hover. Tap-to-preview.
- **Pull-to-refresh** — rubber-band animation, triggers query invalidation.
- **Chart reflow** — single column, simplified axes, swipeable carousel.
- **Adaptive density** — auto compact layout on small screens. Bottom-sheet modals instead of side drawers.
- **Safe areas** — `env(safe-area-inset-*)` for iOS notch/home indicator.

---

## Implementation Priority

1. Navigation + URL routing (foundation for everything)
2. Visual redesign (glassmorphism, depth system, typography)
3. Media gallery redesign (hero experience, primary workflow)
4. Mobile experience (bottom tabs, touch gestures)
5. PWA (manifest, service worker, install prompt)
6. AI features (describe, search, auto-tag, uncensored)
7. Feature completions (command palette, settings, code splitting)
8. Push notifications + offline media (final polish)
