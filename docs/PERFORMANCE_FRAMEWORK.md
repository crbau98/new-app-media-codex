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

## Accessibility and SEO

The experience never relies on motion, depth, color, hover, or canvas input. Reduced motion produces a complete static composition. Focus order, status, reasons, and actions stay in HTML with WCAG AA contrast.

Public pages provide titles, descriptions, canonical metadata, safe social imagery, robots rules, and sitemap entries. Search, private preferences, and personalized results should not be indexed. A future SSR/prerender layer is required for dependable route-level search indexing.

## Compatibility matrix

Test Chromium, Firefox, WebKit, iPhone 13, and a mid-tier Android viewport. Cover reduced motion, low cores, Data Saver, no WebGL, context loss, orientation change, tab visibility, ten route changes, keyboard-only use, streaming byte ranges, and zero console errors.
