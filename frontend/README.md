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
├── src/               # pages, components, store, and client utilities
└── api/               # Vercel edge functions and source adapters
```

The app is fed by `GET|POST /api/live-media`, which aggregates active public APIs,
feeds, and federated sources into one payload: media items, creator directory entries,
AI suggestions, and web-discovery leads. Additional edge routes handle attributed
feed imports, direct PeerTube/Mastodon search, and same-origin media delivery.

Deploy topology: the static client, public-source aggregation, and same-origin API
gateway deploy together on Vercel. The FastAPI backend on Render owns persistence
and credential-backed integrations. `/api/live-media` merges both tiers, while
`/api/render/*` gives browser code one stable API origin.

## Develop

The edge function lives in `api/`, so the intended dev flow is Vercel's:

```bash
npm ci
npx vercel dev        # serves the app AND /api/live-media locally
```

Plain `npm run dev` (Vite, port 3000) works for UI-only work; use `vercel dev` when
testing edge routes locally.

```bash
npm run build         # tsc -b && vite build
npm run lint          # eslint
npm run test:unit     # source-quality and ranking regression tests
```

## Design

"After-hours cinema archive": warm near-black canvas, off-white ink, one heat-coral
accent, film grain, hairlines, mono metadata. Dark is primary; light derives by
inversion. See `src/index.css` for the token set.
