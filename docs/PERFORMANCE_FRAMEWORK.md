# Immersive performance framework

## Release budgets

| Measure | Target | Hard stop |
|---|---:|---:|
| LCP, mobile p75 | 2.5 s | 3.0 s |
| INP, mobile p75 | 200 ms | 250 ms |
| CLS | 0.10 | 0.15 |
| Initial JavaScript, gzip | 180 KB | 200 KB |
| Initial CSS, gzip | 25 KB | 30 KB |
| Async 3D chunk, gzip | 250 KB | 300 KB |
| First enhanced frame, Fast 4G | 3.5 s | 5 s |
| Sustained mobile scene rate | 45 FPS | 30 FPS |

`npm run build:budget` enforces emitted asset limits. Core Web Vitals should also be tracked by route, device tier, reduced-motion state, and enhancement state.

## Progressive rendering contract

The semantic DOM and static scene always render first. Enhanced motion activates only when the scene is near the viewport, the document is visible, reduced motion is off, Data Saver is off, and the device has adequate capability. It pauses outside the viewport. Failure preserves headings, CTAs, status, and media browsing.

For future WebGL: cap DPR at 1.25 mobile/1.5 desktop, avoid antialiasing and shadows on mobile, use demand rendering, recover from context loss with the poster, and dispose every geometry, material, texture, render target, and listener.

## Model and texture limits

| Resource | Mobile | Desktop |
|---|---:|---:|
| Initial GLB | 1.5 MB | 3 MB |
| Visible triangles | 50k | 150k |
| Draw calls | 75 | 150 |
| Materials | 12 | 24 |
| Texture dimension | 1024² | 2048² |
| Dynamic lights | 1 | 2 |

Use GLB + Meshopt, KTX2/Basis textures, LODs, baked lighting, instancing, and same-origin fingerprinted assets. Reject unused animation tracks, 4K textures, uncompressed normal maps, full-screen bloom, and multiple shadow casters.

## App-level efficiency

- Lazy-load route and immersive modules.
- Use `content-visibility:auto` for below-fold shelves and cards.
- Do not permanently promote cards with `will-change`.
- Keep the media grid 2D; never combine mobile video textures with a full-rate scene.
- Load only the visible hero asset eagerly; everything below the fold stays lazy.
- Prefer opaque gradients over viewport-sized backdrop blur.
- Keep explicit media and personalized API responses out of automatic service-worker caches.

## Delivery pipeline

How a visit is kept fast. Everything below lives in `frontend/src/lib/perf/` unless noted, has unit tests in `frontend/tests/perf-*.test.ts`, and degrades to the plain behaviour when storage, the service worker or the Network Information API is missing.

**Boot script** (`boot.js`, emitted as a fingerprinted `/assets/boot-*.js` by `vite.config.ts`, injected first in `<head>`). The production CSP is `script-src 'self'`, so it is an external file, not inline (the previous inline theme script was blocked there). It applies the saved theme before first paint and, for returning visitors who already passed the 18+ gate (never before), preloads the last hero poster and starts the live-feed request while the bundle is still downloading. `fetchLiveDiscovery` takes over that in-flight request via `takeBootFeed(sig)` only when the request signature matches exactly (`discovery-request.ts` is the single definition; `tests/perf-boot.test.ts` keeps both in lockstep).

**Persisted feed metadata** (`cache.ts`, `persist.ts`). The last feed paints synchronously on a repeat visit and revalidates in the background. Metadata only (titles, thumbnail URLs, creator handles from public sources): never media bytes, history, likes or search text. localStorage, TTL 6 h, versioned (`CACHE_VERSION`: bump it when the payload shape changes), at most two entries, 600 kB cap, key stored as a hash, the radar blanked, creator media trimmed. Settings: call `clearQueryCache()` from `@/lib/perf` (optionally `{ memory: true }`); it also clears the service worker's API cache.

**Service worker** (`public/sw.js`, registered after load + idle, production only, skipped under browser automation, `?nosw=1` unregisters). Caches the app shell, hashed assets (type-checked, bounded), app icons, and two allowlisted API metadata GETs: `/api/live-media` default feed (network-first, 6 s budget, cache only as offline/slow-network fallback) and the first page of `/api/creator-directory` (stale-while-revalidate); entries expire after 6 h. It never caches video/audio, ranges, HLS, anything under `/api/archiver-proxy` (explicit media, thumbnails included), POSTs, other `/api/` routes or `no-store`/`private` responses.

**Prefetch and progressive mount.** After load + idle the scheduler warms the likely next route chunks and the detail sheet one at a time (skipped on Data Saver/2g, capped on cellular, paused while hidden); hover/focus/touch on anything with `data-prefetch="/route"` loads that chunk immediately. Long pages mount in stages (`useStagedMount`): Home paints the hero first and holds the shelves until the hero artwork (the LCP element) has been revealed; the reserved height keeps the footer from jumping.

**Images.** The first hero image is `fetchpriority=high` and preloaded; unfinished thumbnails are cancelled when their page unmounts; on 3g / Data Saver lazy thumbnails wait for one of 3-6 download slots; intersection observers are shared per margin instead of one per image.

**Fonts** are self-hosted (`src/styles/fonts.css`, latin subset, immutable fingerprinted files, Inter and Fraunces preloaded), so there is no third-party stylesheet in the critical path and no swap-induced layout shift.

**Reporting** (`lib/vitals.ts`). One sample per page view for LCP (final candidate), CLS (worst session window), INP (slowest interaction, 1-in-50 outlier rule) plus FCP and TTFB, sent when the page is hidden, with device tier, Data Saver/network tier and lite-graphics flag, route path only (never the query string).

## Budgets enforced in CI

`npm run build:budget` fails the build when any of these is exceeded (gzip bytes): largest chunk 125 kB, all JS 440 kB, all CSS 26 kB, initial JS 200 kB (target 180 kB), initial CSS 24 kB, and a cold landing on any route 225 kB JS / 26 kB CSS (initial plus that route's lazy chunks; computed from the Vite manifest).

## Accessibility and SEO

The experience never relies on motion, depth, color, hover, or canvas input. Reduced motion produces a complete static composition. Focus order, status, reasons, and actions stay in HTML with WCAG AA contrast.

Public pages provide titles, descriptions, canonical metadata, safe social imagery, robots rules, and sitemap entries. Search, private preferences, and personalized results should not be indexed. A future SSR/prerender layer is required for dependable route-level search indexing.

## Compatibility matrix

Test Chromium, Firefox, WebKit, iPhone 13, and a mid-tier Android viewport. Cover reduced motion, low cores, Data Saver, no WebGL, context loss, orientation change, tab visibility, ten route changes, keyboard-only use, streaming byte ranges, and zero console errors.
