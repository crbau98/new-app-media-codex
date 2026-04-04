# Desire Research Radar — Full-Stack Redesign

**Date:** 2026-03-09
**Status:** Approved

---

## Context

The app is a FastAPI research monitor that scrapes biomedical literature, web anecdotes, Reddit, X/Twitter, and LPSG forum threads across 5 male sexual-function research themes. The current frontend is a single 2,712-line Jinja2 HTML template with plain CSS and vanilla JS. The backend is a single `sources.py` monolith (984 lines) with a threading.Lock crawl scheduler.

The redesign replaces both frontend and backend with a modern, maintainable architecture.

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Frontend framework | React 19 + Vite + TypeScript | User preference; large ecosystem |
| Styling | Tailwind CSS v4 | Utility-first, dark theme tokens, no CSS monolith |
| Data fetching | TanStack Query v5 | Cache, background refresh, pagination |
| Global state | Zustand | Filters, workspace mode, command palette |
| Charts | Recharts | React-native, dark theme support |
| Graph | D3 v7 force layout | Compound/mechanism relationship network |
| Real-time | WebSocket (crawl progress) + SSE (hypothesis streaming) | Native FastAPI support |
| Task queue | ARQ (fakeredis fallback for local dev) | Replaces threading.Lock hack |
| Backend | FastAPI (unchanged runtime) | No reason to change |
| Database | SQLite + raw SQL (unchanged) | Sufficient at this scale |

---

## Architecture

### Repository layout

```
App research codex/
├── frontend/
│   ├── src/
│   │   ├── components/         # Shared UI primitives
│   │   ├── features/
│   │   │   ├── items/          # Source cards, filters, bulk actions
│   │   │   ├── hypotheses/     # Hypothesis triage + SSE streaming
│   │   │   ├── images/         # Masonry gallery + lightbox
│   │   │   ├── topics/         # Topic explorer + boards
│   │   │   ├── graphs/         # D3 compound/mechanism graph
│   │   │   └── analytics/      # Recharts trend charts
│   │   ├── hooks/              # TanStack Query hooks per API domain
│   │   ├── store/              # Zustand slices
│   │   └── lib/                # API client, utils, constants
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── package.json
│
└── app/
    ├── api/
    │   ├── items.py
    │   ├── hypotheses.py
    │   ├── images.py
    │   ├── runs.py
    │   └── crawl.py            # POST /api/run, WebSocket /ws/crawl
    ├── sources/
    │   ├── base.py             # Shared fetch/extract helpers
    │   ├── pubmed.py           # NEW: NCBI E-utilities API
    │   ├── biorxiv.py          # NEW: bioRxiv REST API
    │   ├── arxiv.py            # NEW: arXiv Atom API
    │   ├── pubchem.py          # NEW: PubChem compound lookup + cache
    │   ├── gwern.py            # NEW: Gwern.net targeted scrape
    │   ├── duckduckgo.py       # existing (extracted)
    │   ├── reddit.py           # existing (extracted + enhanced)
    │   ├── x.py                # existing (extracted + enhanced)
    │   └── lpsg.py             # existing (extracted)
    ├── tasks/
    │   └── crawl.py            # ARQ async task (replaces threading.Lock)
    ├── db/
    │   ├── repository.py       # All SQL queries
    │   └── models.py
    ├── ai/
    │   └── hypotheses.py       # SSE streaming generation
    ├── config.py               # Extended with new source settings
    └── main.py                 # Mounts /api routers, serves frontend/dist
```

---

## Visual Design

### Color system

```
Background:
  --bg-base:       #0a0e13   (page background)
  --bg-surface:    #0f1520   (panels, cards)
  --bg-elevated:   #161e2e   (modals, dropdowns)
  --bg-subtle:     #1a2235   (inputs, table rows)

Borders:
  --border:        #1e2d42
  --border-muted:  #162034

Text:
  --text-primary:  #e2ecf7
  --text-secondary:#8da4c0
  --text-muted:    #4e6582

Accents:
  --accent:        #3b82f6   (blue — primary actions)
  --teal:          #14b8a6   (compounds)
  --amber:         #f59e0b   (warnings, flags)
  --green:         #22c55e   (saved, promoted)
  --red:           #ef4444   (archived, dismissed)
  --purple:        #a855f7   (mechanisms)
```

### Typography
- **Headings/UI:** Inter or Geist
- **Body:** Inter
- **Monospace:** JetBrains Mono — compound names, IDs, timestamps, hypothesis body text

### App shell

```
┌──────────────────────────────────────────────────────┐
│  ⬡ RADAR    [search ⌘K]           ● crawl running…  │  ← top bar
├─────────┬────────────────────────────────────────────┤
│         │                                            │
│  NAV    │           MAIN CONTENT AREA               │
│         │                                            │
│ Overview│  Stats bar (sparklines)                   │
│ Items   │                                            │
│ Media   │  Primary panel                            │
│ Graph   │                                            │
│ Hypo    │                                            │
│ Topics  │                                            │
│ ─────── │                                            │
│ Themes  │                                            │
│  libido │                                            │
│  pssd   │                                            │
│  erect  │                                            │
│  ejac   │                                            │
│  orgasm │                                            │
│ ─────── │                                            │
│ Settings│                                            │
└─────────┴────────────────────────────────────────────┘
```

### Key component designs

**Source cards:** Dark surface, left accent bar colored by source type (blue=PubMed, teal=bioRxiv, amber=Reddit, orange=X, gray=LPSG), compound/mechanism chips in JetBrains Mono, score ring, inline triage actions.

**Hypothesis cards:** Monospace body text for terminal feel, token-by-token SSE streaming with blinking cursor, citation chips linked to source items, review status badge.

**Compound/mechanism graph:** D3 force-directed on dark canvas, nodes colored by type (blue=compound, purple=mechanism, green=theme), edges weighted by co-occurrence, hover tooltip, click pivots topic explorer.

**Trend charts:** Recharts area charts per theme over time, sparklines in stats bar.

**Image gallery:** CSS columns masonry, lazy load, hover shows source + theme chip, fullscreen lightbox with swipe.

**Command palette:** ⌘K, fuzzy search across items/hypotheses/topics/actions, frosted glass overlay.

---

## New Features

### New scraping sources

| Source | API/Method | Adds |
|---|---|---|
| PubMed/NCBI | E-utilities REST | Gold-standard literature, MeSH terms, DOIs |
| bioRxiv | `api.biorxiv.org` | Pre-prints ahead of PubMed |
| arXiv | Atom API | Computational neuro, psych |
| PubChem | REST API | Compound metadata, pharmacology summaries, bioassay links |
| Gwern.net | trafilatura scrape | Long-form synthesis articles |

### Real-time crawl progress
WebSocket at `/ws/crawl` emits structured events:
```json
{"type": "source_start", "source": "pubmed", "theme": "libido"}
{"type": "item_found", "count": 3, "source": "pubmed"}
{"type": "source_done", "source": "pubmed", "elapsed_ms": 1240}
{"type": "error", "source": "reddit", "message": "timeout"}
{"type": "run_complete", "total_items": 47, "total_images": 12}
```

### SSE hypothesis streaming
`GET /api/hypotheses/stream` streams AI tokens to the hypothesis card. Falls back to deterministic generator if no API key.

### PubChem compound detail
`GET /api/compounds/{name}` — on-demand lookup fetching CID, IUPAC name, MW, pharmacology summary, linked PubMed citations. Results cached in SQLite.

### Enhanced image pipeline
- Perceptual hash deduplication (imagehash)
- Thumbnail generation at ingest (Pillow)
- Alt-text extraction from surrounding HTML
- Source type tag stored per image

### New config (`.env`)
```
PUBMED_API_KEY=
ARXIV_RESULTS=4
BIORXIV_RESULTS=4
GWERN_RESULTS=2
PUBCHEM_CACHE=true
REDIS_URL=redis://localhost:6379
```

---

## Parallel Agent Execution Plan

Implementation runs as 7 parallel agents in two waves:

### Wave 1 (fully independent — run simultaneously)
- **Agent 1: Design system** — Tailwind config, color tokens, base components (Button, Badge, Card, Spinner, Dialog, Tooltip)
- **Agent 7: Backend restructure** — API routers, new sources (PubMed, bioRxiv, arXiv, PubChem, Gwern), WebSocket, ARQ task queue, enhanced image pipeline

### Wave 2 (depend on Agent 1's design system — run simultaneously after Wave 1)
- **Agent 2: App shell + routing** — Sidebar nav, top bar, command palette, React Router, Zustand store
- **Agent 3: Items feature** — Source cards, filters, search, pagination, bulk actions, triage
- **Agent 4: Hypothesis + AI** — Hypothesis cards, SSE streaming, triage, analyst notes
- **Agent 5: Visualization** — D3 compound/mechanism graph, Recharts trend charts, stats bar sparklines
- **Agent 6: Media gallery** — Masonry layout, lightbox, lazy load, image filters
