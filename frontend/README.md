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
public sources (Redgifs, X, Tumblr, DuckDuckGo, SerpApi, Firecrawl) into one
payload: media items, creator directory entries, per-source health, AI suggestions,
and web-discovery leads. The client treats every field beyond `items`/`performers`
as optional and renders source state honestly (connected / not-configured / limited /
error / blocked).

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

## Discovery integrations

All integrations are **optional** and **server-side only** (never prefixed `VITE_`).
Copy `.env.example` to `.env.local` and populate the keys you have.
**Rotate any key immediately if it is ever exposed or committed.**

| Env var | Source | What it enables |
|---|---|---|
| `X_BEARER_TOKEN` | [developer.twitter.com](https://developer.twitter.com) | X/Twitter public-post photos and videos via official API; watchlist queries + bounded open search |
| `TUMBLR_API_KEY` | [tumblr.com/oauth/apps](https://www.tumblr.com/oauth/apps) | Tumblr public tagged-post photos |
| `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_ID` | [programmablesearchengine.google.com](https://programmablesearchengine.google.com) | Google Programmable Search licensed-image profile leads |
| `SERPAPI_API_KEY` | [serpapi.com](https://serpapi.com) | Google Images discovery (source-attributed photo leads) and DuckDuckGo profile/post leads via SerpApi |
| `FIRECRAWL_API_KEY` | [firecrawl.dev](https://www.firecrawl.dev) | OG metadata enrichment (title, preview thumbnail, canonical URL) for public creator profile pages |

### Rights and legal boundaries

- **Public, source-attributed only.** Every item links back to its origin.
- **No subscription mirrors.** Coomer, Kemono, and equivalent paywall-mirror domains are blocked at the query and URL level.
- **No login/paywall bypass.** Firecrawl is called only on public-profile URLs; it is never pointed at paywalled or login-required pages.
- **No media rehosting.** Images from SerpApi are third-party browser-rendered URLs (`referrerpolicy=no-referrer`); they are never proxied or persisted by this server.
- **No robots.txt bypass.** Firecrawl respects robots.txt by default; no override flags are used.
- **No identity inference.** Scope and exclusion signals are content-based (tags, text). No appearance, ethnicity, or sensitive-trait inference is performed.
- **Key rotation.** Treat any accidentally committed or chat-pasted API key as compromised. Rotate it immediately at the respective provider dashboard and update Vercel environment variables.

