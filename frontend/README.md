# Media Codex — web client

An after-hours cinema archive: an 18+ media discovery app that indexes **public,
source-attributed** content and links back to the origin for every item. It hosts no
media. All personalization (follows, likes, tag/creator preferences) is computed and
stored **on the device** — nothing leaves the browser.

## Stack

- React 19 + TypeScript + Vite 7
- Tailwind CSS 3.4 (semantic tokens via CSS variables — one `data-theme` theming system)
- TanStack Query (live data, `retry: 1`, `staleTime: 5 min`, no focus refetch; Home polls every 120s)
- Zustand (persisted local preferences)
- framer-motion (restrained motion, honors reduced-motion), lucide icons
- Fonts: Inter + JetBrains Mono (Google Fonts, `display=swap`)

## Architecture

```
frontend/
├── src/               # this app (pages, components, store, lib)
└── api/               # Vercel edge function: /api/live-media (separate scope)
```

The app is fed by a single edge function, `POST /api/live-media`, which aggregates
public sources (Redgifs, X, Tumblr, DuckDuckGo) into one payload: media items,
creator directory entries, per-source health, AI suggestions, and web-discovery
leads. The client treats every field beyond `items`/`performers` as optional and
renders source state honestly (connected / not-configured / limited / error / blocked).

Deploy topology: the static client and the edge function deploy together on Vercel.
The older FastAPI backend on Render is only used as a stream-recovery fallback for
cached items.

## Develop

The edge function lives in `api/`, so the intended dev flow is Vercel's:

```bash
npm ci
npx vercel dev        # serves the app AND /api/live-media locally
```

Plain `npm run dev` (vite, port 3000) works for UI work, but `/api/live-media` will
404 unless you proxy it to a deployed preview.

```bash
npm run build         # tsc -b && vite build
npm run lint          # eslint
```

## Design

"After-hours cinema archive": warm near-black canvas, off-white ink, one heat-coral
accent, film grain, hairlines, mono metadata. Dark is primary; light derives by
inversion. See `src/index.css` for the token set.
