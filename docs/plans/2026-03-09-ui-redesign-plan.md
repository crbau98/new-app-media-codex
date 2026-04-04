# Full-Stack Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-file Jinja2 frontend and monolithic sources.py with a React+Vite+TypeScript SPA and a clean layered Python backend with new scraping sources, real-time crawl progress, and a dark terminal UI.

**Architecture:** FastAPI serves a compiled Vite/React SPA from `/` and restructured API routers under `/api`. The frontend uses TanStack Query for data fetching, Zustand for UI state, Recharts for trend charts, and D3 for the compound/mechanism graph.

**Tech Stack:** React 19, Vite 6, TypeScript, Tailwind CSS v4, TanStack Query v5, Zustand, Recharts, D3 v7, FastAPI, SQLite, ARQ (async task queue), imagehash, Pillow

---

## Execution order

**Wave 1 — run in parallel (no dependencies):**
- Tasks 1–9: Frontend scaffold + design system
- Tasks 10–22: Backend restructure + new sources

**Wave 2 — run in parallel after Wave 1 completes:**
- Tasks 23–28: App shell + routing
- Tasks 29–35: Items feature
- Tasks 36–41: Hypotheses feature
- Tasks 42–46: Visualization (charts + graph)
- Tasks 47–51: Media gallery

**Wave 3:**
- Task 52: Integration wiring + smoke test

---

## WAVE 1A — Frontend scaffold + design system

### Task 1: Scaffold Vite + React + TypeScript project

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`

**Step 1: Create frontend/package.json**

```json
{
  "name": "radar-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.1.0",
    "@tanstack/react-query": "^5.62.0",
    "zustand": "^5.0.2",
    "recharts": "^2.14.1",
    "d3": "^7.9.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/d3": "^7.4.3",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "~5.7.2",
    "vite": "^6.0.5",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0"
  }
}
```

**Step 2: Create frontend/vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/cached-images': 'http://localhost:8000',
    },
  },
  build: {
    outDir: '../app/static/dist',
    emptyOutDir: true,
  },
})
```

**Step 3: Create frontend/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
```

**Step 4: Create frontend/index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Desire Research Radar</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 5: Create frontend/src/main.tsx**

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>
)
```

**Step 6: Create frontend/src/App.tsx (shell — detail in Task 23)**

```typescript
export default function App() {
  return <div className="min-h-screen bg-bg-base text-text-primary">Loading…</div>
}
```

**Step 7: Install dependencies and verify dev server starts**

```bash
cd frontend
npm install
npm run dev
```

Expected: Vite dev server at http://localhost:5173 showing "Loading…"

**Step 8: Commit**

```bash
git add frontend/
git commit -m "feat: scaffold Vite + React + TypeScript frontend"
```

---

### Task 2: Tailwind CSS v4 design tokens

**Files:**
- Create: `frontend/src/index.css`

**Step 1: Create frontend/src/index.css with full token system**

```css
@import "tailwindcss";

@theme {
  /* Background layers */
  --color-bg-base: #0a0e13;
  --color-bg-surface: #0f1520;
  --color-bg-elevated: #161e2e;
  --color-bg-subtle: #1a2235;

  /* Borders */
  --color-border: #1e2d42;
  --color-border-muted: #162034;

  /* Text */
  --color-text-primary: #e2ecf7;
  --color-text-secondary: #8da4c0;
  --color-text-muted: #4e6582;

  /* Accent palette */
  --color-accent: #3b82f6;
  --color-accent-hover: #60a5fa;
  --color-teal: #14b8a6;
  --color-amber: #f59e0b;
  --color-green: #22c55e;
  --color-red: #ef4444;
  --color-purple: #a855f7;

  /* Glow helpers */
  --color-accent-glow: rgba(59,130,246,0.15);
  --color-teal-glow: rgba(20,184,166,0.12);

  /* Typography */
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* Radii */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 22px;
}

* { box-sizing: border-box; }

html { -webkit-font-smoothing: antialiased; }

body {
  margin: 0;
  background-color: var(--color-bg-base);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.6;
}

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--color-text-muted); }
```

**Step 2: Verify Tailwind classes resolve in App.tsx**

Change `App.tsx` background to `bg-bg-base` — confirm it renders as `#0a0e13` in browser devtools.

**Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: add Tailwind v4 design token system"
```

---

### Task 3: Base components — Button, Badge, Spinner

**Files:**
- Create: `frontend/src/components/Button.tsx`
- Create: `frontend/src/components/Badge.tsx`
- Create: `frontend/src/components/Spinner.tsx`
- Create: `frontend/src/lib/cn.ts`

**Step 1: Create frontend/src/lib/cn.ts**

```typescript
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

**Step 2: Create frontend/src/components/Button.tsx**

```typescript
import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-[0_0_12px_var(--color-accent-glow)]',
  secondary: 'bg-bg-elevated border border-border text-text-primary hover:border-accent hover:text-accent',
  ghost: 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
  danger: 'bg-red/10 border border-red/30 text-red hover:bg-red/20',
}

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1 text-xs rounded-md',
  md: 'px-4 py-2 text-sm rounded-lg',
  lg: 'px-5 py-2.5 text-sm rounded-lg',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center gap-2 font-medium transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {loading && <Spinner size={12} />}
      {children}
    </button>
  )
)
Button.displayName = 'Button'

import { Spinner } from './Spinner'
```

**Step 3: Create frontend/src/components/Spinner.tsx**

```typescript
import { cn } from '@/lib/cn'

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={cn('animate-spin text-text-muted', className)}
      width={size} height={size}
      viewBox="0 0 24 24" fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
```

**Step 4: Create frontend/src/components/Badge.tsx**

```typescript
import { cn } from '@/lib/cn'

type BadgeVariant = 'default' | 'accent' | 'teal' | 'amber' | 'green' | 'red' | 'purple' | 'muted'

const colors: Record<BadgeVariant, string> = {
  default: 'bg-bg-elevated border-border text-text-secondary',
  accent: 'bg-accent/10 border-accent/30 text-accent',
  teal: 'bg-teal/10 border-teal/30 text-teal',
  amber: 'bg-amber/10 border-amber/30 text-amber',
  green: 'bg-green/10 border-green/30 text-green',
  red: 'bg-red/10 border-red/30 text-red',
  purple: 'bg-purple/10 border-purple/30 text-purple',
  muted: 'bg-bg-subtle border-border-muted text-text-muted',
}

export function Badge({
  children, variant = 'default', mono = false, className
}: {
  children: React.ReactNode
  variant?: BadgeVariant
  mono?: boolean
  className?: string
}) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 text-xs border rounded-md',
      mono && 'font-mono',
      colors[variant],
      className
    )}>
      {children}
    </span>
  )
}
```

**Step 5: Commit**

```bash
git add frontend/src/components/ frontend/src/lib/
git commit -m "feat: add Button, Badge, Spinner base components"
```

---

### Task 4: Base components — Card, Dialog, Tooltip

**Files:**
- Create: `frontend/src/components/Card.tsx`
- Create: `frontend/src/components/Dialog.tsx`
- Create: `frontend/src/components/Tooltip.tsx`

**Step 1: Create frontend/src/components/Card.tsx**

```typescript
import { cn } from '@/lib/cn'

export function Card({ children, className, onClick }: {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-bg-surface border border-border rounded-xl p-4 transition-all duration-150',
        onClick && 'cursor-pointer hover:border-accent/40 hover:bg-bg-elevated',
        className
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex items-start justify-between gap-3 mb-3', className)}>{children}</div>
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('text-sm text-text-secondary', className)}>{children}</div>
}
```

**Step 2: Create frontend/src/components/Dialog.tsx**

```typescript
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'

export function Dialog({ open, onClose, children, className }: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
}) {
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === backdropRef.current) onClose() }}
    >
      <div className={cn(
        'bg-bg-elevated border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto',
        className
      )}>
        {children}
      </div>
    </div>
  )
}

export function DialogHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between p-5 border-b border-border">
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none">×</button>
    </div>
  )
}
```

**Step 3: Create frontend/src/components/Tooltip.tsx**

```typescript
import { useState } from 'react'
import { cn } from '@/lib/cn'

export function Tooltip({ children, content, className }: {
  children: React.ReactNode
  content: string
  className?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 px-2 py-1 text-xs text-text-primary bg-bg-elevated border border-border rounded-md whitespace-nowrap pointer-events-none">
          {content}
        </span>
      )}
    </span>
  )
}
```

**Step 4: Create frontend/src/components/index.ts (barrel)**

```typescript
export { Button } from './Button'
export { Badge } from './Badge'
export { Spinner } from './Spinner'
export { Card, CardHeader, CardBody } from './Card'
export { Dialog, DialogHeader } from './Dialog'
export { Tooltip } from './Tooltip'
```

**Step 5: Commit**

```bash
git add frontend/src/components/
git commit -m "feat: add Card, Dialog, Tooltip components"
```

---

### Task 5: FastAPI serve compiled frontend

**Files:**
- Modify: `app/main.py`

**Step 1: Update app/main.py to serve frontend dist**

After the existing static mount line, add:

```python
from fastapi.responses import FileResponse
import os

FRONTEND_DIST = BASE_DIR / "static" / "dist"

# Mount compiled frontend assets (js/css chunks)
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

# Catch-all: serve index.html for any non-API, non-static route
@app.get("/{full_path:path}", response_class=HTMLResponse)
def spa_fallback(full_path: str) -> HTMLResponse:
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return HTMLResponse(index.read_text())
    # Fallback to old Jinja template during transition
    from fastapi import Request
    ...
```

Note: The catch-all must be added AFTER all other routes. Place it at the end of main.py.

**Step 2: Build frontend and verify FastAPI serves it**

```bash
cd frontend && npm run build
cd .. && uvicorn app.main:app --reload
# Visit http://localhost:8000 — should see React app
```

**Step 3: Commit**

```bash
git add app/main.py
git commit -m "feat: FastAPI serves compiled React SPA from /static/dist"
```

---

## WAVE 1B — Backend restructure + new sources

### Task 6: Extract sources into sources/ package

**Files:**
- Create: `app/sources/__init__.py`
- Create: `app/sources/base.py`
- Create: `app/sources/duckduckgo.py`
- Create: `app/sources/reddit.py`
- Create: `app/sources/x.py`
- Create: `app/sources/lpsg.py`
- Delete: `app/sources.py` (after extracting all content)

**Step 1: Create app/sources/__init__.py**

```python
from app.sources.base import build_session, cache_image
from app.sources.duckduckgo import collect_anecdotes, collect_images
from app.sources.reddit import collect_reddit
from app.sources.x import collect_x
from app.sources.lpsg import collect_lpsg

__all__ = [
    "build_session", "cache_image",
    "collect_anecdotes", "collect_images",
    "collect_reddit", "collect_x", "collect_lpsg",
]
```

**Step 2: Create app/sources/base.py**

Move `build_session`, `cache_image`, `IMAGE_EXCLUDE_MARKERS`, `MECHANISM_TERMS`, `COMPOUND_TERMS`, and shared helpers from `app/sources.py` into this file. Keep exact logic unchanged.

**Step 3: Create app/sources/duckduckgo.py**

Move `collect_literature` and `collect_anecdotes` and `collect_images` from `app/sources.py`. Keep exact logic unchanged.

**Step 4: Create app/sources/reddit.py, x.py, lpsg.py**

Move respective `collect_*` functions. Keep exact logic unchanged.

**Step 5: Delete app/sources.py once all imports resolve**

```bash
python -c "from app.sources import collect_reddit; print('OK')"
```

**Step 6: Commit**

```bash
git add app/sources/ && git rm app/sources.py
git commit -m "refactor: split sources.py into sources/ package"
```

---

### Task 7: Add PubMed source

**Files:**
- Create: `app/sources/pubmed.py`
- Modify: `app/sources/__init__.py`
- Modify: `app/config.py`

**Step 1: Create app/sources/pubmed.py**

```python
from __future__ import annotations
import time
from typing import Any
import requests
from app.config import Settings, Theme
from app.models import ResearchItem
from app.sources.base import MECHANISM_TERMS, COMPOUND_TERMS, extract_signals

ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
EFETCH  = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
ESUM    = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"

def collect_pubmed(
    session: requests.Session,
    settings: Settings,
    theme: Theme,
) -> list[ResearchItem]:
    items: list[ResearchItem] = []
    api_key = settings.pubmed_api_key
    for query in theme.queries:
        params: dict[str, Any] = {
            "db": "pubmed", "term": query, "retmax": settings.pubmed_results,
            "retmode": "json", "sort": "relevance",
        }
        if api_key:
            params["api_key"] = api_key
        try:
            r = session.get(ESEARCH, params=params, timeout=settings.request_timeout_seconds)
            r.raise_for_status()
            ids = r.json().get("esearchresult", {}).get("idlist", [])
        except Exception:
            continue
        if not ids:
            continue
        # Fetch summaries
        sum_params: dict[str, Any] = {
            "db": "pubmed", "id": ",".join(ids), "retmode": "json",
        }
        if api_key:
            sum_params["api_key"] = api_key
        try:
            sr = session.get(ESUM, params=sum_params, timeout=settings.request_timeout_seconds)
            sr.raise_for_status()
            uids = sr.json().get("result", {}).get("uids", [])
            result_map = sr.json().get("result", {})
        except Exception:
            continue
        for uid in uids:
            art = result_map.get(uid, {})
            title = art.get("title", "").strip() or "(no title)"
            authors = art.get("authors", [])
            author = authors[0].get("name", "") if authors else ""
            pub_date = art.get("pubdate", "")
            doi_list = [i.get("value","") for i in art.get("articleids",[]) if i.get("idtype")=="doi"]
            doi = doi_list[0] if doi_list else ""
            url = f"https://pubmed.ncbi.nlm.nih.gov/{uid}/" if not doi else f"https://doi.org/{doi}"
            abstract = art.get("sorttitle", title)  # summary fallback
            compounds, mechanisms = extract_signals(title + " " + abstract)
            items.append(ResearchItem(
                source_type="pubmed", theme=theme.slug, query=query,
                title=title, url=url, summary=abstract[:400],
                content=abstract, author=author, published_at=pub_date,
                domain="pubmed.ncbi.nlm.nih.gov", image_url="",
                score=float(len(compounds) + len(mechanisms)),
                compounds=compounds, mechanisms=mechanisms, metadata={"pmid": uid, "doi": doi},
            ))
        time.sleep(0.11)  # NCBI rate limit: ~10 req/s with key, 3/s without
    return items
```

**Step 2: Add `pubmed_results` and `pubmed_api_key` to app/config.py**

```python
pubmed_api_key: str = field(default_factory=lambda: os.getenv("PUBMED_API_KEY", "").strip())
pubmed_results: int = field(default_factory=lambda: _int_env("PUBMED_RESULTS", 6))
```

**Step 3: Add to app/sources/__init__.py exports**

```python
from app.sources.pubmed import collect_pubmed
```

**Step 4: Add `extract_signals` helper to app/sources/base.py**

```python
def extract_signals(text: str) -> tuple[list[str], list[str]]:
    lower = text.lower()
    compounds = sorted({v for k, v in COMPOUND_TERMS.items() if k in lower})
    mechanisms = sorted({v for k, v in MECHANISM_TERMS.items() if k in lower})
    return compounds, mechanisms
```

**Step 5: Commit**

```bash
git add app/sources/pubmed.py app/config.py
git commit -m "feat: add PubMed/NCBI scraper source"
```

---

### Task 8: Add bioRxiv and arXiv sources

**Files:**
- Create: `app/sources/biorxiv.py`
- Create: `app/sources/arxiv.py`
- Modify: `app/config.py`
- Modify: `app/sources/__init__.py`

**Step 1: Create app/sources/biorxiv.py**

```python
from __future__ import annotations
from typing import Any
import requests
from app.config import Settings, Theme
from app.models import ResearchItem
from app.sources.base import extract_signals

BIORXIV_API = "https://api.biorxiv.org/details/biorxiv"

def collect_biorxiv(session: requests.Session, settings: Settings, theme: Theme) -> list[ResearchItem]:
    items: list[ResearchItem] = []
    for query in theme.queries[:1]:  # one query per theme to avoid overload
        url = f"{BIORXIV_API}/2024-01-01/2099-01-01/0/json"
        try:
            r = session.get(url, timeout=settings.request_timeout_seconds)
            r.raise_for_status()
            collection = r.json().get("collection", [])
        except Exception:
            continue
        # Filter by query keyword match in title/abstract
        keyword = query.lower().split()[0]
        for art in collection:
            title = art.get("title", "")
            abstract = art.get("abstract", "")
            if keyword not in (title + abstract).lower():
                continue
            doi = art.get("doi", "")
            compounds, mechanisms = extract_signals(title + " " + abstract)
            items.append(ResearchItem(
                source_type="biorxiv", theme=theme.slug, query=query,
                title=title, url=f"https://doi.org/{doi}" if doi else "",
                summary=abstract[:400], content=abstract,
                author=art.get("authors", ""), published_at=art.get("date", ""),
                domain="biorxiv.org", image_url="",
                score=float(len(compounds) + len(mechanisms)),
                compounds=compounds, mechanisms=mechanisms, metadata={"doi": doi},
            ))
            if len(items) >= settings.biorxiv_results:
                break
    return items
```

**Step 2: Create app/sources/arxiv.py**

```python
from __future__ import annotations
import xml.etree.ElementTree as ET
import requests
from app.config import Settings, Theme
from app.models import ResearchItem
from app.sources.base import extract_signals

ARXIV_API = "https://export.arxiv.org/api/query"
NS = "http://www.w3.org/2005/Atom"

def collect_arxiv(session: requests.Session, settings: Settings, theme: Theme) -> list[ResearchItem]:
    items: list[ResearchItem] = []
    for query in theme.queries[:1]:
        params = {"search_query": f"all:{query}", "max_results": settings.arxiv_results, "sortBy": "relevance"}
        try:
            r = session.get(ARXIV_API, params=params, timeout=settings.request_timeout_seconds)
            r.raise_for_status()
            root = ET.fromstring(r.text)
        except Exception:
            continue
        for entry in root.findall(f"{{{NS}}}entry"):
            title = (entry.findtext(f"{{{NS}}}title") or "").strip()
            abstract = (entry.findtext(f"{{{NS}}}summary") or "").strip()
            url = (entry.findtext(f"{{{NS}}}id") or "").strip()
            authors = [a.findtext(f"{{{NS}}}name") or "" for a in entry.findall(f"{{{NS}}}author")]
            published = (entry.findtext(f"{{{NS}}}published") or "")[:10]
            compounds, mechanisms = extract_signals(title + " " + abstract)
            items.append(ResearchItem(
                source_type="arxiv", theme=theme.slug, query=query,
                title=title, url=url, summary=abstract[:400], content=abstract,
                author=", ".join(authors[:2]), published_at=published,
                domain="arxiv.org", image_url="",
                score=float(len(compounds) + len(mechanisms)),
                compounds=compounds, mechanisms=mechanisms, metadata={},
            ))
    return items
```

**Step 3: Add to config.py**

```python
biorxiv_results: int = field(default_factory=lambda: _int_env("BIORXIV_RESULTS", 4))
arxiv_results: int   = field(default_factory=lambda: _int_env("ARXIV_RESULTS", 4))
```

**Step 4: Commit**

```bash
git add app/sources/biorxiv.py app/sources/arxiv.py app/config.py
git commit -m "feat: add bioRxiv and arXiv scraper sources"
```

---

### Task 9: Add PubChem compound lookup + caching

**Files:**
- Create: `app/sources/pubchem.py`
- Modify: `app/db/repository.py` (add compound cache table)
- Create: `app/api/compounds.py`

**Step 1: Add compound_cache table to SCHEMA in app/db.py**

```python
CREATE TABLE IF NOT EXISTS compound_cache (
    name TEXT PRIMARY KEY,
    cid TEXT,
    iupac TEXT,
    molecular_weight REAL,
    pharmacology TEXT,
    pubmed_cids TEXT,
    fetched_at TEXT NOT NULL
);
```

**Step 2: Create app/sources/pubchem.py**

```python
from __future__ import annotations
import requests

PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"

def lookup_compound(session: requests.Session, name: str, timeout: int = 15) -> dict:
    """Fetch compound metadata from PubChem by name."""
    try:
        # Get CID
        r = session.get(f"{PUBCHEM_BASE}/compound/name/{name}/cids/JSON", timeout=timeout)
        r.raise_for_status()
        cid = str(r.json()["IdentifierList"]["CID"][0])
    except Exception:
        return {}
    try:
        # Get properties
        props = "IUPACName,MolecularWeight,PharmacologyAndBiochemistry"
        pr = session.get(f"{PUBCHEM_BASE}/compound/cid/{cid}/property/{props}/JSON", timeout=timeout)
        pr.raise_for_status()
        prop_data = pr.json()["PropertyTable"]["Properties"][0]
    except Exception:
        prop_data = {}
    return {
        "cid": cid,
        "iupac": prop_data.get("IUPACName", ""),
        "molecular_weight": prop_data.get("MolecularWeight"),
        "pharmacology": prop_data.get("PharmacologyAndBiochemistry", "")[:1000],
    }
```

**Step 3: Create app/api/compounds.py**

```python
from __future__ import annotations
from fastapi import APIRouter
from fastapi.responses import JSONResponse
import requests
from app.db import Database
from app.sources.pubchem import lookup_compound

router = APIRouter(prefix="/api/compounds", tags=["compounds"])

def get_or_fetch(db: Database, name: str) -> dict:
    cached = db.get_compound_cache(name)
    if cached:
        return cached
    session = requests.Session()
    data = lookup_compound(session, name)
    if data:
        db.set_compound_cache(name, data)
    return data

@router.get("/{name}")
def compound_detail(name: str) -> JSONResponse:
    from app.main import db
    return JSONResponse(get_or_fetch(db, name))
```

**Step 4: Add DB methods to app/db.py**

```python
def get_compound_cache(self, name: str) -> dict | None:
    with self.connect() as conn:
        row = conn.execute("SELECT * FROM compound_cache WHERE name=?", (name.lower(),)).fetchone()
        return dict(row) if row else None

def set_compound_cache(self, name: str, data: dict) -> None:
    with self.connect() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO compound_cache
            (name, cid, iupac, molecular_weight, pharmacology, pubmed_cids, fetched_at)
            VALUES (?,?,?,?,?,?,?)
        """, (name.lower(), data.get("cid",""), data.get("iupac",""),
              data.get("molecular_weight"), data.get("pharmacology",""), "", utcnow()))
        conn.commit()
```

**Step 5: Register router in app/main.py**

```python
from app.api.compounds import router as compounds_router
app.include_router(compounds_router)
```

**Step 6: Commit**

```bash
git add app/sources/pubchem.py app/api/compounds.py app/db.py
git commit -m "feat: PubChem compound lookup with SQLite cache"
```

---

### Task 10: WebSocket crawl progress

**Files:**
- Create: `app/api/crawl.py`
- Modify: `app/service.py`
- Modify: `app/main.py`

**Step 1: Add event callback support to ResearchService in app/service.py**

```python
from typing import Callable, Any

class ResearchService:
    def __init__(self, settings, db):
        ...
        self._progress_callbacks: list[Callable[[dict], None]] = []

    def add_progress_callback(self, cb: Callable[[dict], None]) -> None:
        self._progress_callbacks.append(cb)

    def remove_progress_callback(self, cb: Callable[[dict], None]) -> None:
        self._progress_callbacks.discard(cb)

    def _emit(self, event: dict[str, Any]) -> None:
        for cb in list(self._progress_callbacks):
            try:
                cb(event)
            except Exception:
                pass
```

Call `self._emit({"type": "source_start", "source": name, "theme": theme.slug})` etc. at appropriate points in `run_crawl`.

**Step 2: Create app/api/crawl.py**

```python
from __future__ import annotations
import asyncio
import json
from fastapi import APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from app.config import settings

router = APIRouter(tags=["crawl"])

@router.post("/api/run")
async def run_now(background_tasks, x_admin_token: str | None = Header(default=None)):
    from app.main import service
    if settings.admin_token and x_admin_token != settings.admin_token:
        raise HTTPException(status_code=401, detail="Missing or invalid admin token")
    if service.lock.locked():
        return JSONResponse({"status": "busy"})
    background_tasks.add_task(service.run_crawl)
    return JSONResponse({"status": "queued"})

@router.websocket("/ws/crawl")
async def crawl_ws(websocket: WebSocket):
    await websocket.accept()
    from app.main import service
    queue: asyncio.Queue[dict] = asyncio.Queue()

    def on_event(event: dict) -> None:
        asyncio.get_event_loop().call_soon_threadsafe(queue.put_nowait, event)

    service.add_progress_callback(on_event)
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30)
                await websocket.send_text(json.dumps(event))
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"type": "ping"}))
    except WebSocketDisconnect:
        pass
    finally:
        service.remove_progress_callback(on_event)
```

**Step 3: Register in app/main.py**

```python
from app.api.crawl import router as crawl_router
app.include_router(crawl_router)
```

**Step 4: Commit**

```bash
git add app/api/crawl.py app/service.py
git commit -m "feat: WebSocket /ws/crawl streams real-time crawl progress"
```

---

### Task 11: SSE hypothesis streaming

**Files:**
- Create: `app/api/hypotheses_stream.py`
- Modify: `app/ai.py`

**Step 1: Add streaming generator to app/ai.py**

```python
from typing import Iterator

def stream_hypothesis(settings, items: list[dict]) -> Iterator[str]:
    """Yields text chunks for a single hypothesis via SSE."""
    if not settings.openai_api_key:
        yield from _deterministic_stream(items)
        return
    import openai
    client = openai.OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
    prompt = _build_prompt(items)
    with client.chat.completions.stream(
        model=settings.openai_model,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                yield delta

def _deterministic_stream(items: list[dict]) -> Iterator[str]:
    text = _build_deterministic_hypothesis(items)
    for word in text.split():
        yield word + " "
```

**Step 2: Create app/api/hypotheses_stream.py**

```python
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from app.config import settings
from app.ai import stream_hypothesis
from app.db import Database

router = APIRouter(prefix="/api/hypotheses", tags=["hypotheses"])

@router.get("/stream")
def hypothesis_stream(theme: str | None = None):
    from app.main import db
    items = db.get_recent_items(limit=20, theme=theme)

    def event_stream():
        for chunk in stream_hypothesis(settings, items):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```

**Step 3: Register router in app/main.py**

```python
from app.api.hypotheses_stream import router as hyp_stream_router
app.include_router(hyp_stream_router)
```

**Step 4: Commit**

```bash
git add app/api/hypotheses_stream.py app/ai.py
git commit -m "feat: SSE endpoint streams hypothesis generation token-by-token"
```

---

### Task 12: Split remaining routes into api/ routers

**Files:**
- Create: `app/api/items.py`
- Create: `app/api/hypotheses.py`
- Create: `app/api/images.py`
- Create: `app/api/runs.py`
- Modify: `app/main.py`

**Step 1:** Move each group of routes from `app/main.py` into their respective router file using `APIRouter`. All existing endpoint logic stays identical — just move into `router.get(...)` / `router.patch(...)` etc.

Example `app/api/items.py`:

```python
from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse
from app.config import settings

router = APIRouter(prefix="/api", tags=["items"])

@router.get("/items")
def items(theme=Query(None), source_type=Query(None), ...):
    from app.main import db
    return JSONResponse(db.get_recent_items(...))
```

**Step 2: Update app/main.py to only include_router and serve SPA**

```python
from app.api import items, hypotheses, images, runs, crawl, compounds
for r in [items.router, hypotheses.router, images.router, runs.router,
          crawl.router, compounds.router]:
    app.include_router(r)
```

**Step 3: Test all existing API endpoints still work**

```bash
curl http://localhost:8000/api/dashboard | python -m json.tool | head -20
curl http://localhost:8000/api/items | python -m json.tool | head -5
```

**Step 4: Commit**

```bash
git add app/api/ app/main.py
git commit -m "refactor: split main.py routes into app/api/ routers"
```

---

### Task 13: Enhanced image pipeline

**Files:**
- Modify: `app/sources/base.py`
- Modify: `requirements.txt`

**Step 1: Add imagehash and Pillow to requirements.txt**

```
imagehash==4.3.2
Pillow==11.1.0
```

**Step 2: Install**

```bash
pip install imagehash Pillow
```

**Step 3: Add phash dedup + thumbnail generation to cache_image in base.py**

```python
import imagehash
from PIL import Image
import io

def _phash(img_bytes: bytes) -> str:
    try:
        img = Image.open(io.BytesIO(img_bytes))
        return str(imagehash.phash(img))
    except Exception:
        return ""

def cache_image(session, settings, url: str) -> str:
    """Download, dedup via phash, generate thumbnail, return local path."""
    from app.db import Database
    db = Database(settings.database_path)
    try:
        r = session.get(url, timeout=settings.request_timeout_seconds)
        r.raise_for_status()
        img_bytes = r.content
    except Exception:
        return ""

    phash_val = _phash(img_bytes)
    if phash_val and db.image_phash_exists(phash_val):
        return ""  # duplicate

    # Save original
    ext = url.rsplit(".", 1)[-1].split("?")[0][:4] or "jpg"
    import hashlib
    fname = hashlib.md5(url.encode()).hexdigest() + "." + ext
    dest = settings.image_dir / fname
    dest.write_bytes(img_bytes)

    # Save thumbnail
    try:
        img = Image.open(io.BytesIO(img_bytes))
        img.thumbnail((400, 400))
        thumb_fname = "thumb_" + fname
        img.save(settings.image_dir / thumb_fname)
    except Exception:
        thumb_fname = fname

    if phash_val:
        db.set_image_phash(phash_val, fname)

    return fname
```

**Step 4: Add phash table to SCHEMA in app/db.py**

```sql
CREATE TABLE IF NOT EXISTS image_phashes (
    phash TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

**Step 5: Commit**

```bash
git add app/sources/base.py app/db.py requirements.txt
git commit -m "feat: perceptual hash dedup and thumbnail generation for images"
```

---

## WAVE 2A — App shell + routing

### Task 14: TanStack Query API client + Zustand store

**Files:**
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/store/index.ts`
- Create: `frontend/src/hooks/useItems.ts`
- Create: `frontend/src/hooks/useHypotheses.ts`
- Create: `frontend/src/hooks/useImages.ts`
- Create: `frontend/src/hooks/useDashboard.ts`

**Step 1: Create frontend/src/lib/api.ts**

```typescript
const BASE = '/api'

async function get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    })
  }
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

async function patch<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Admin-Token': token } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export const api = { get, patch }
```

**Step 2: Create frontend/src/store/index.ts**

```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface FilterState {
  theme: string
  sourceType: string
  reviewStatus: string
  savedOnly: boolean
  search: string
  sort: string
  imageTheme: string
}

interface UIState {
  workspaceMode: 'overview' | 'items' | 'media' | 'graph' | 'hypotheses' | 'topics'
  commandPaletteOpen: boolean
  adminToken: string
  density: 'comfortable' | 'compact'
  filters: FilterState
  setWorkspaceMode: (mode: UIState['workspaceMode']) => void
  setCommandPalette: (open: boolean) => void
  setAdminToken: (token: string) => void
  setFilter: (key: keyof FilterState, value: string | boolean) => void
  resetFilters: () => void
}

const defaultFilters: FilterState = {
  theme: '', sourceType: '', reviewStatus: '',
  savedOnly: false, search: '', sort: 'newest', imageTheme: '',
}

export const useStore = create<UIState>()(
  persist(
    (set) => ({
      workspaceMode: 'overview',
      commandPaletteOpen: false,
      adminToken: '',
      density: 'comfortable',
      filters: defaultFilters,
      setWorkspaceMode: (mode) => set({ workspaceMode: mode }),
      setCommandPalette: (open) => set({ commandPaletteOpen: open }),
      setAdminToken: (adminToken) => set({ adminToken }),
      setFilter: (key, value) => set(s => ({ filters: { ...s.filters, [key]: value } })),
      resetFilters: () => set({ filters: defaultFilters }),
    }),
    { name: 'radar-ui', partialize: (s) => ({ adminToken: s.adminToken, density: s.density }) }
  )
)
```

**Step 3: Create frontend/src/hooks/useDashboard.ts**

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardPayload>('/dashboard'),
    refetchInterval: 60_000,
  })
}
```

**Step 4: Create frontend/src/hooks/useItems.ts**

```typescript
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useStore } from '@/store'

export function useItems() {
  const { theme, sourceType, reviewStatus, savedOnly, search, sort } = useStore(s => s.filters)
  return useInfiniteQuery({
    queryKey: ['items', theme, sourceType, reviewStatus, savedOnly, search, sort],
    queryFn: ({ pageParam = 0 }) =>
      api.get<ItemsPage>('/browse/items', { theme, source_type: sourceType, review_status: reviewStatus,
        saved_only: savedOnly, search, sort, offset: pageParam, limit: 50 }),
    getNextPageParam: (last, pages) =>
      last.has_more ? pages.reduce((acc, p) => acc + p.items.length, 0) : undefined,
    initialPageParam: 0,
  })
}

export function useUpdateItem() {
  const qc = useQueryClient()
  const adminToken = useStore(s => s.adminToken)
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; review_status?: string; is_saved?: boolean; user_note?: string }) =>
      api.patch(`/items/${id}`, body, adminToken),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  })
}
```

**Step 5: Commit**

```bash
git add frontend/src/lib/ frontend/src/store/ frontend/src/hooks/
git commit -m "feat: API client, Zustand store, TanStack Query hooks"
```

---

### Task 15: Sidebar navigation + top bar

**Files:**
- Create: `frontend/src/features/layout/Sidebar.tsx`
- Create: `frontend/src/features/layout/TopBar.tsx`
- Create: `frontend/src/features/layout/AppShell.tsx`
- Modify: `frontend/src/App.tsx`

**Step 1: Create frontend/src/features/layout/Sidebar.tsx**

```typescript
import { NavLink } from 'react-router-dom'
import { useStore } from '@/store'
import { cn } from '@/lib/cn'

const NAV = [
  { to: '/', label: 'Overview', icon: '◈' },
  { to: '/items', label: 'Sources', icon: '◉' },
  { to: '/media', label: 'Media', icon: '▣' },
  { to: '/graph', label: 'Graph', icon: '◎' },
  { to: '/hypotheses', label: 'Hypotheses', icon: '◆' },
  { to: '/topics', label: 'Topics', icon: '◇' },
]

export function Sidebar() {
  const themes = ['libido', 'pssd', 'erections', 'ejaculation_latency', 'orgasm']
  const setFilter = useStore(s => s.setFilter)

  return (
    <aside className="w-52 shrink-0 bg-bg-surface border-r border-border flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <span className="text-accent font-mono font-semibold text-sm tracking-wider">⬡ RADAR</span>
      </div>
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV.map(({ to, label, icon }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) => cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all',
              isActive
                ? 'bg-accent/10 text-accent font-medium'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
            )}>
            <span className="text-xs opacity-70">{icon}</span>
            {label}
          </NavLink>
        ))}
        <div className="pt-4 pb-1 px-3">
          <p className="text-xs text-text-muted uppercase tracking-widest font-mono">Themes</p>
        </div>
        {themes.map(t => (
          <button key={t} onClick={() => setFilter('theme', t)}
            className="w-full text-left flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-all font-mono">
            {t}
          </button>
        ))}
      </nav>
    </aside>
  )
}
```

**Step 2: Create frontend/src/features/layout/TopBar.tsx**

```typescript
import { useStore } from '@/store'
import { useCrawlStatus } from '@/hooks/useCrawlStatus'
import { Button } from '@/components'

export function TopBar() {
  const setCommandPalette = useStore(s => s.setCommandPalette)
  const { isRunning, startCrawl } = useCrawlStatus()

  return (
    <header className="h-12 bg-bg-surface border-b border-border flex items-center px-4 gap-4 shrink-0">
      <button
        onClick={() => setCommandPalette(true)}
        className="flex-1 max-w-sm flex items-center gap-2 px-3 py-1.5 bg-bg-subtle border border-border rounded-lg text-sm text-text-muted hover:border-accent/50 transition-all"
      >
        <span>Search…</span>
        <kbd className="ml-auto text-xs font-mono bg-bg-elevated px-1.5 py-0.5 rounded border border-border">⌘K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-3">
        {isRunning && (
          <span className="flex items-center gap-1.5 text-xs text-amber font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse" />
            crawl running…
          </span>
        )}
        <Button size="sm" variant="secondary" onClick={startCrawl} disabled={isRunning}>
          Run crawl
        </Button>
      </div>
    </header>
  )
}
```

**Step 3: Create frontend/src/features/layout/AppShell.tsx**

```typescript
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { CommandPalette } from '@/features/command/CommandPalette'
import { useStore } from '@/store'
import { useEffect } from 'react'

export function AppShell() {
  const setCommandPalette = useStore(s => s.setCommandPalette)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPalette(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setCommandPalette])

  return (
    <div className="flex h-screen overflow-hidden bg-bg-base">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  )
}
```

**Step 4: Update frontend/src/App.tsx with routes**

```typescript
import { Routes, Route } from 'react-router-dom'
import { AppShell } from '@/features/layout/AppShell'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { ItemsPage } from '@/features/items/ItemsPage'
import { MediaPage } from '@/features/images/MediaPage'
import { GraphPage } from '@/features/graphs/GraphPage'
import { HypothesesPage } from '@/features/hypotheses/HypothesesPage'
import { TopicsPage } from '@/features/topics/TopicsPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="media" element={<MediaPage />} />
        <Route path="graph" element={<GraphPage />} />
        <Route path="hypotheses" element={<HypothesesPage />} />
        <Route path="topics" element={<TopicsPage />} />
      </Route>
    </Routes>
  )
}
```

Create stub page components for each route (just `export function XPage() { return <div>X</div> }`) so the app compiles.

**Step 5: Commit**

```bash
git add frontend/src/features/layout/ frontend/src/App.tsx
git commit -m "feat: app shell with sidebar nav, top bar, React Router"
```

---

### Task 16: Command palette

**Files:**
- Create: `frontend/src/features/command/CommandPalette.tsx`

**Step 1: Create frontend/src/features/command/CommandPalette.tsx**

```typescript
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { Dialog } from '@/components'
import { cn } from '@/lib/cn'

const ACTIONS = [
  { id: 'nav-overview', label: 'Go to Overview', group: 'Navigate', action: (nav: Function) => nav('/') },
  { id: 'nav-items', label: 'Go to Sources', group: 'Navigate', action: (nav: Function) => nav('/items') },
  { id: 'nav-media', label: 'Go to Media', group: 'Navigate', action: (nav: Function) => nav('/media') },
  { id: 'nav-graph', label: 'Go to Graph', group: 'Navigate', action: (nav: Function) => nav('/graph') },
  { id: 'nav-hypotheses', label: 'Go to Hypotheses', group: 'Navigate', action: (nav: Function) => nav('/hypotheses') },
  { id: 'filter-saved', label: 'Show saved items only', group: 'Filter', action: (_: any, store: any) => store.setFilter('savedOnly', true) },
  { id: 'filter-clear', label: 'Clear all filters', group: 'Filter', action: (_: any, store: any) => store.resetFilters() },
]

export function CommandPalette() {
  const open = useStore(s => s.commandPaletteOpen)
  const setOpen = useStore(s => s.setCommandPalette)
  const store = useStore()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) { setQuery(''); setCursor(0); setTimeout(() => inputRef.current?.focus(), 50) } }, [open])

  const filtered = ACTIONS.filter(a => a.label.toLowerCase().includes(query.toLowerCase()))

  const run = (a: typeof ACTIONS[0]) => {
    a.action(navigate, store)
    setOpen(false)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    if (e.key === 'Enter' && filtered[cursor]) run(filtered[cursor])
  }

  return (
    <Dialog open={open} onClose={() => setOpen(false)} className="max-w-lg">
      <div className="p-3 border-b border-border">
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setCursor(0) }}
          onKeyDown={handleKey}
          placeholder="Search actions…"
          className="w-full bg-transparent text-text-primary placeholder-text-muted outline-none text-sm"
        />
      </div>
      <div className="max-h-72 overflow-y-auto p-1">
        {filtered.map((a, i) => (
          <button key={a.id} onClick={() => run(a)}
            className={cn(
              'w-full text-left flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all',
              i === cursor ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
            )}>
            <span>{a.label}</span>
            <span className="text-xs text-text-muted font-mono">{a.group}</span>
          </button>
        ))}
        {filtered.length === 0 && <p className="text-center text-text-muted text-sm py-6">No actions found</p>}
      </div>
    </Dialog>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/src/features/command/
git commit -m "feat: command palette with keyboard navigation (⌘K)"
```

---

## WAVE 2B — Items feature

### Task 17: Source cards

**Files:**
- Create: `frontend/src/features/items/SourceCard.tsx`
- Create: `frontend/src/features/items/ItemsPage.tsx`

**Step 1: Create frontend/src/features/items/SourceCard.tsx**

```typescript
import { Badge } from '@/components'
import { useUpdateItem } from '@/hooks/useItems'
import { cn } from '@/lib/cn'

const SOURCE_COLORS: Record<string, string> = {
  pubmed: 'bg-accent',
  biorxiv: 'bg-teal',
  arxiv: 'bg-purple',
  reddit: 'bg-amber',
  x: 'bg-[#1da1f2]',
  lpsg: 'bg-text-muted',
  web: 'bg-green',
  duckduckgo: 'bg-green',
}

const SOURCE_BADGE: Record<string, Parameters<typeof Badge>[0]['variant']> = {
  pubmed: 'accent', biorxiv: 'teal', arxiv: 'purple',
  reddit: 'amber', x: 'default', lpsg: 'muted',
}

export function SourceCard({ item, selected, onSelect }: {
  item: ResearchItem
  selected: boolean
  onSelect: (id: number) => void
}) {
  const update = useUpdateItem()
  const accentBar = SOURCE_COLORS[item.source_type] ?? 'bg-text-muted'

  return (
    <div className={cn(
      'relative bg-bg-surface border border-border rounded-xl overflow-hidden transition-all duration-150',
      'hover:border-accent/30 hover:bg-bg-elevated',
      selected && 'border-accent/60 bg-bg-elevated'
    )}>
      {/* Left accent bar colored by source */}
      <div className={cn('absolute left-0 top-0 bottom-0 w-0.5', accentBar)} />

      <div className="pl-4 pr-4 pt-3.5 pb-3">
        {/* Header row */}
        <div className="flex items-start gap-2 mb-2">
          <input type="checkbox" checked={selected} onChange={() => onSelect(item.id)}
            className="mt-0.5 shrink-0 accent-accent" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Badge variant={SOURCE_BADGE[item.source_type] ?? 'default'}>{item.source_type}</Badge>
              <Badge variant="muted" mono>{item.theme}</Badge>
              {item.score > 0 && <span className="text-xs text-text-muted font-mono">score {item.score.toFixed(1)}</span>}
              {item.is_saved && <Badge variant="green">saved</Badge>}
            </div>
            <a href={item.url} target="_blank" rel="noreferrer"
              className="text-sm font-medium text-text-primary hover:text-accent transition-colors line-clamp-2">
              {item.title}
            </a>
          </div>
        </div>

        {/* Summary */}
        <p className="text-xs text-text-secondary line-clamp-2 mb-2.5 ml-6">{item.summary}</p>

        {/* Compound + mechanism chips */}
        {(item.compounds.length > 0 || item.mechanisms.length > 0) && (
          <div className="flex flex-wrap gap-1 mb-2.5 ml-6">
            {item.compounds.map(c => <Badge key={c} variant="teal" mono>{c}</Badge>)}
            {item.mechanisms.map(m => <Badge key={m} variant="purple" mono>{m}</Badge>)}
          </div>
        )}

        {/* Footer row */}
        <div className="flex items-center justify-between ml-6">
          <span className="text-xs text-text-muted font-mono">
            {item.domain} · {item.first_seen_at?.slice(0, 10)}
          </span>
          <div className="flex items-center gap-1">
            <ActionButton label={item.is_saved ? '★' : '☆'} title={item.is_saved ? 'Unsave' : 'Save'}
              onClick={() => update.mutate({ id: item.id, is_saved: !item.is_saved })} />
            <ActionButton label="▶" title="Shortlist"
              onClick={() => update.mutate({ id: item.id, review_status: 'shortlisted' })} />
            <ActionButton label="✕" title="Archive"
              onClick={() => update.mutate({ id: item.id, review_status: 'archived' })} />
          </div>
        </div>
      </div>
    </div>
  )
}

function ActionButton({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title}
      className="w-6 h-6 flex items-center justify-center text-xs text-text-muted hover:text-text-primary hover:bg-bg-elevated rounded transition-all">
      {label}
    </button>
  )
}
```

**Step 2: Create frontend/src/features/items/ItemsPage.tsx**

```typescript
import { useState } from 'react'
import { useItems, useUpdateItem } from '@/hooks/useItems'
import { useStore } from '@/store'
import { SourceCard } from './SourceCard'
import { FiltersBar } from './FiltersBar'
import { BulkBar } from './BulkBar'
import { Button, Spinner } from '@/components'

export function ItemsPage() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useItems()
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const items = data?.pages.flatMap(p => p.items) ?? []

  const toggleSelect = (id: number) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="space-y-4">
      <FiltersBar />
      {selected.size > 0 && <BulkBar selected={selected} onClear={() => setSelected(new Set())} />}
      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size={32} /></div>
      ) : (
        <div className="grid gap-3">
          {items.map(item => (
            <SourceCard key={item.id} item={item}
              selected={selected.has(item.id)} onSelect={toggleSelect} />
          ))}
        </div>
      )}
      {hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button variant="secondary" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add frontend/src/features/items/
git commit -m "feat: source cards with compound/mechanism chips, triage actions"
```

---

### Task 18: Filters bar + bulk actions

**Files:**
- Create: `frontend/src/features/items/FiltersBar.tsx`
- Create: `frontend/src/features/items/BulkBar.tsx`

**Step 1: Create frontend/src/features/items/FiltersBar.tsx**

```typescript
import { useStore } from '@/store'
import { Button } from '@/components'

const SOURCES = ['pubmed','biorxiv','arxiv','reddit','x','lpsg','web']
const STATUSES = ['new','reviewing','shortlisted','archived']
const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'score', label: 'Top score' },
  { value: 'saved', label: 'Saved first' },
]

export function FiltersBar() {
  const { theme, sourceType, reviewStatus, savedOnly, search, sort, setFilter, resetFilters } = useStore(s => ({
    ...s.filters, setFilter: s.setFilter, resetFilters: s.resetFilters,
  }))

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={search} onChange={e => setFilter('search', e.target.value)}
        placeholder="Search…"
        className="flex-1 min-w-48 px-3 py-2 bg-bg-subtle border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/50" />

      <select value={sourceType} onChange={e => setFilter('sourceType', e.target.value)}
        className="px-3 py-2 bg-bg-subtle border border-border rounded-lg text-sm text-text-secondary focus:outline-none">
        <option value="">All sources</option>
        {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <select value={reviewStatus} onChange={e => setFilter('reviewStatus', e.target.value)}
        className="px-3 py-2 bg-bg-subtle border border-border rounded-lg text-sm text-text-secondary focus:outline-none">
        <option value="">All statuses</option>
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <select value={sort} onChange={e => setFilter('sort', e.target.value)}
        className="px-3 py-2 bg-bg-subtle border border-border rounded-lg text-sm text-text-secondary focus:outline-none">
        {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>

      <label className="flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer">
        <input type="checkbox" checked={savedOnly} onChange={e => setFilter('savedOnly', e.target.checked)} className="accent-accent" />
        Saved only
      </label>

      <Button variant="ghost" size="sm" onClick={resetFilters}>Clear</Button>
    </div>
  )
}
```

**Step 2: Create frontend/src/features/items/BulkBar.tsx**

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useStore } from '@/store'
import { Button } from '@/components'

export function BulkBar({ selected, onClear }: { selected: Set<number>; onClear: () => void }) {
  const adminToken = useStore(s => s.adminToken)
  const qc = useQueryClient()
  const bulk = useMutation({
    mutationFn: (body: object) => api.patch<unknown>('/items/bulk', { item_ids: [...selected], ...body }, adminToken),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['items'] }); onClear() },
  })

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-accent/10 border border-accent/30 rounded-xl text-sm">
      <span className="text-accent font-medium">{selected.size} selected</span>
      <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ is_saved: true })}>Save</Button>
      <Button size="sm" variant="ghost" onClick={() => bulk.mutate({ review_status: 'archived' })}>Archive</Button>
      <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add frontend/src/features/items/FiltersBar.tsx frontend/src/features/items/BulkBar.tsx
git commit -m "feat: filter bar and bulk action bar for source items"
```

---

## WAVE 2C — Hypotheses feature

### Task 19: Hypothesis cards + SSE streaming

**Files:**
- Create: `frontend/src/features/hypotheses/HypothesisCard.tsx`
- Create: `frontend/src/features/hypotheses/HypothesesPage.tsx`
- Create: `frontend/src/features/hypotheses/StreamingHypothesis.tsx`

**Step 1: Create frontend/src/features/hypotheses/HypothesisCard.tsx**

```typescript
import { useState } from 'react'
import { Card, Badge, Button } from '@/components'
import { useUpdateHypothesis } from '@/hooks/useHypotheses'

const STATUS_VARIANT: Record<string, Parameters<typeof Badge>[0]['variant']> = {
  new: 'default', reviewing: 'amber', promoted: 'green', dismissed: 'red',
}

export function HypothesisCard({ h }: { h: Hypothesis }) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState(h.user_note ?? '')
  const update = useUpdateHypothesis()

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary leading-snug flex-1">{h.title}</h3>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant={STATUS_VARIANT[h.review_status] ?? 'default'}>{h.review_status}</Badge>
          {h.is_saved && <Badge variant="green">saved</Badge>}
        </div>
      </div>

      <p className="text-xs text-text-secondary font-mono leading-relaxed whitespace-pre-wrap">{h.rationale}</p>

      {h.evidence && (
        <p className="text-xs text-text-muted border-l-2 border-border pl-3 italic">{h.evidence}</p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="secondary"
          onClick={() => update.mutate({ id: h.id, is_saved: !h.is_saved })}>
          {h.is_saved ? '★ Saved' : '☆ Save'}
        </Button>
        <Button size="sm" variant="secondary"
          onClick={() => update.mutate({ id: h.id, review_status: 'promoted' })}>
          Promote
        </Button>
        <Button size="sm" variant="ghost"
          onClick={() => update.mutate({ id: h.id, review_status: 'dismissed' })}>
          Dismiss
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setNoteOpen(o => !o)}>
          Note
        </Button>
      </div>

      {noteOpen && (
        <div className="space-y-2">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
            className="w-full bg-bg-subtle border border-border rounded-lg p-2 text-sm text-text-primary resize-none focus:outline-none focus:border-accent/50" />
          <Button size="sm" onClick={() => update.mutate({ id: h.id, user_note: note })}>
            Save note
          </Button>
        </div>
      )}
    </Card>
  )
}
```

**Step 2: Create frontend/src/features/hypotheses/StreamingHypothesis.tsx**

```typescript
import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components'

export function StreamingHypothesis({ theme }: { theme?: string }) {
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)
  const [running, setRunning] = useState(false)

  const start = () => {
    setText('')
    setDone(false)
    setRunning(true)
    const url = '/api/hypotheses/stream' + (theme ? `?theme=${theme}` : '')
    const es = new EventSource(url)
    es.onmessage = (e) => {
      if (e.data === '[DONE]') { setDone(true); setRunning(false); es.close(); return }
      setText(t => t + e.data)
    }
    es.onerror = () => { setRunning(false); es.close() }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Generate hypothesis</h3>
        <button onClick={start} disabled={running}
          className="text-xs text-accent hover:text-accent-hover disabled:opacity-50 font-mono transition-colors">
          {running ? 'generating…' : '▶ Generate'}
        </button>
      </div>
      {(text || running) && (
        <p className="text-xs text-text-secondary font-mono leading-relaxed whitespace-pre-wrap">
          {text}{running && !done && <span className="animate-pulse">▌</span>}
        </p>
      )}
    </Card>
  )
}
```

**Step 3: Create frontend/src/features/hypotheses/HypothesesPage.tsx**

```typescript
import { useHypotheses } from '@/hooks/useHypotheses'
import { HypothesisCard } from './HypothesisCard'
import { StreamingHypothesis } from './StreamingHypothesis'
import { Spinner } from '@/components'

export function HypothesesPage() {
  const { data, isLoading } = useHypotheses()
  return (
    <div className="space-y-4 max-w-3xl">
      <StreamingHypothesis />
      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size={32} /></div>
      ) : (
        data?.hypotheses.map(h => <HypothesisCard key={h.id} h={h} />)
      )}
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add frontend/src/features/hypotheses/
git commit -m "feat: hypothesis cards with SSE streaming and triage actions"
```

---

## WAVE 2D — Visualization

### Task 20: Stats bar + Recharts trend charts

**Files:**
- Create: `frontend/src/features/analytics/StatsBar.tsx`
- Create: `frontend/src/features/analytics/ThemeTrendChart.tsx`
- Create: `frontend/src/features/overview/OverviewPage.tsx`

**Step 1: Create frontend/src/features/analytics/StatsBar.tsx**

```typescript
import { useDashboard } from '@/hooks/useDashboard'

export function StatsBar() {
  const { data } = useDashboard()
  const stats = [
    { label: 'Total items', value: data?.total_items ?? '—' },
    { label: 'Saved', value: data?.saved_count ?? '—' },
    { label: 'Hypotheses', value: data?.hypotheses_count ?? '—' },
    { label: 'Last run', value: data?.last_run_at?.slice(0, 10) ?? '—' },
    { label: 'Images', value: data?.image_count ?? '—' },
  ]
  return (
    <div className="grid grid-cols-5 gap-3 mb-6">
      {stats.map(({ label, value }) => (
        <div key={label} className="bg-bg-surface border border-border rounded-xl p-4">
          <p className="text-xs text-text-muted uppercase tracking-widest font-mono mb-1">{label}</p>
          <p className="text-2xl font-semibold text-text-primary font-mono">{value}</p>
        </div>
      ))}
    </div>
  )
}
```

**Step 2: Create frontend/src/features/analytics/ThemeTrendChart.tsx**

```typescript
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useDashboard } from '@/hooks/useDashboard'

export function ThemeTrendChart() {
  const { data } = useDashboard()
  // data.theme_counts is { theme: string, count: number }[]
  const chartData = data?.theme_counts ?? []

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-text-primary mb-4">Theme activity</h3>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="theme" tick={{ fontSize: 11, fill: '#4e6582', fontFamily: 'JetBrains Mono' }} />
          <YAxis tick={{ fontSize: 11, fill: '#4e6582' }} />
          <Tooltip
            contentStyle={{ background: '#161e2e', border: '1px solid #1e2d42', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#e2ecf7' }}
            itemStyle={{ color: '#8da4c0' }}
          />
          <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="url(#grad)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
```

**Step 3: Create frontend/src/features/overview/OverviewPage.tsx**

```typescript
import { StatsBar } from '@/features/analytics/StatsBar'
import { ThemeTrendChart } from '@/features/analytics/ThemeTrendChart'
import { RunHistory } from '@/features/analytics/RunHistory'

export function OverviewPage() {
  return (
    <div className="space-y-5">
      <StatsBar />
      <div className="grid grid-cols-2 gap-5">
        <ThemeTrendChart />
        <RunHistory />
      </div>
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add frontend/src/features/analytics/ frontend/src/features/overview/
git commit -m "feat: stats bar and theme trend area chart"
```

---

### Task 21: D3 compound/mechanism graph

**Files:**
- Create: `frontend/src/features/graphs/CompoundGraph.tsx`
- Create: `frontend/src/features/graphs/GraphPage.tsx`
- Create: `frontend/src/hooks/useGraphData.ts`

**Step 1: Create frontend/src/hooks/useGraphData.ts**

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useDashboard } from './useDashboard'

export function useGraphData() {
  const { data } = useDashboard()
  // Build graph from compound/mechanism co-occurrence in items
  // Returns { nodes: Node[], links: Link[] }
  return useQuery({
    queryKey: ['graph-data', data?.compounds, data?.mechanisms],
    queryFn: () => api.get<GraphData>('/browse/items?limit=200').then(buildGraph),
    enabled: !!data,
  })
}

function buildGraph(itemsPage: any): GraphData {
  const nodes = new Map<string, GraphNode>()
  const linkMap = new Map<string, number>()

  const ensureNode = (id: string, type: 'compound' | 'mechanism' | 'theme') => {
    if (!nodes.has(id)) nodes.set(id, { id, label: id, type, weight: 0 })
    nodes.get(id)!.weight++
  }

  for (const item of itemsPage.items ?? []) {
    const cs: string[] = item.compounds ?? []
    const ms: string[] = item.mechanisms ?? []
    const theme = item.theme
    cs.forEach(c => ensureNode(c, 'compound'))
    ms.forEach(m => ensureNode(m, 'mechanism'))
    ensureNode(theme, 'theme')
    cs.forEach(c => ms.forEach(m => {
      const key = `${c}--${m}`
      linkMap.set(key, (linkMap.get(key) ?? 0) + 1)
    }))
  }

  const links = [...linkMap.entries()]
    .filter(([, w]) => w > 0)
    .map(([key, weight]) => {
      const [source, target] = key.split('--')
      return { source, target, weight }
    })

  return { nodes: [...nodes.values()], links }
}
```

**Step 2: Create frontend/src/features/graphs/CompoundGraph.tsx**

```typescript
import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { useGraphData } from '@/hooks/useGraphData'
import { Spinner } from '@/components'

const NODE_COLOR = { compound: '#14b8a6', mechanism: '#a855f7', theme: '#22c55e' }

export function CompoundGraph({ onNodeClick }: { onNodeClick?: (node: GraphNode) => void }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const { data, isLoading } = useGraphData()

  useEffect(() => {
    if (!data || !svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    const { width, height } = svgRef.current.getBoundingClientRect()

    const sim = d3.forceSimulation(data.nodes as any)
      .force('link', d3.forceLink(data.links).id((d: any) => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(20))

    const link = svg.append('g').selectAll('line')
      .data(data.links).join('line')
      .attr('stroke', '#1e2d42')
      .attr('stroke-width', (d: any) => Math.sqrt(d.weight))

    const node = svg.append('g').selectAll('g')
      .data(data.nodes).join('g')
      .attr('cursor', 'pointer')
      .on('click', (_, d: any) => onNodeClick?.(d))
      .call(d3.drag<any, any>()
        .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
        .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null }))

    node.append('circle')
      .attr('r', (d: any) => 6 + Math.min(d.weight * 2, 14))
      .attr('fill', (d: any) => NODE_COLOR[d.type as keyof typeof NODE_COLOR] ?? '#8da4c0')
      .attr('fill-opacity', 0.85)
      .attr('stroke', '#0a0e13').attr('stroke-width', 1.5)

    node.append('text')
      .text((d: any) => d.label)
      .attr('dy', '0.35em').attr('dx', 10)
      .attr('font-size', 10).attr('font-family', 'JetBrains Mono')
      .attr('fill', '#8da4c0').attr('pointer-events', 'none')

    sim.on('tick', () => {
      link.attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y)
          .attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y)
      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`)
    })

    return () => { sim.stop() }
  }, [data, onNodeClick])

  if (isLoading) return <div className="flex justify-center py-20"><Spinner size={32} /></div>

  return <svg ref={svgRef} className="w-full h-[600px] bg-bg-surface border border-border rounded-xl" />
}
```

**Step 3: Create frontend/src/features/graphs/GraphPage.tsx**

```typescript
import { useState } from 'react'
import { CompoundGraph } from './CompoundGraph'
import { Badge } from '@/components'

export function GraphPage() {
  const [selected, setSelected] = useState<GraphNode | null>(null)
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-text-primary">Compound / Mechanism Graph</h1>
        <div className="flex gap-2 text-xs">
          {[['compound','teal'],['mechanism','purple'],['theme','green']] .map(([t,c]) => (
            <Badge key={t} variant={c as any} mono>{t}</Badge>
          ))}
        </div>
      </div>
      {selected && (
        <div className="bg-bg-surface border border-border rounded-xl p-3 text-sm text-text-secondary">
          Selected: <span className="font-mono text-text-primary">{selected.label}</span>
          <span className="ml-2 text-text-muted">({selected.type}, weight {selected.weight})</span>
        </div>
      )}
      <CompoundGraph onNodeClick={setSelected} />
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add frontend/src/features/graphs/ frontend/src/hooks/useGraphData.ts
git commit -m "feat: D3 force-directed compound/mechanism graph"
```

---

## WAVE 2E — Media gallery

### Task 22: Masonry image gallery + lightbox

**Files:**
- Create: `frontend/src/features/images/ImageCard.tsx`
- Create: `frontend/src/features/images/Lightbox.tsx`
- Create: `frontend/src/features/images/MediaPage.tsx`
- Create: `frontend/src/hooks/useImages.ts`

**Step 1: Create frontend/src/hooks/useImages.ts**

```typescript
import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useStore } from '@/store'

export function useImages() {
  const imageTheme = useStore(s => s.filters.imageTheme)
  return useInfiniteQuery({
    queryKey: ['images', imageTheme],
    queryFn: ({ pageParam = 0 }) =>
      api.get<ImagesPage>('/browse/images', { theme: imageTheme, offset: pageParam, limit: 40 }),
    getNextPageParam: (last, pages) =>
      last.has_more ? pages.reduce((acc, p) => acc + p.images.length, 0) : undefined,
    initialPageParam: 0,
  })
}
```

**Step 2: Create frontend/src/features/images/ImageCard.tsx**

```typescript
import { useState } from 'react'
import { Badge } from '@/components'

export function ImageCard({ img, onClick }: { img: ImageRecord; onClick: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const src = img.local_path ? `/cached-images/${img.local_path}` : img.thumb_url || img.image_url

  return (
    <div
      onClick={onClick}
      className="relative break-inside-avoid mb-3 rounded-xl overflow-hidden cursor-pointer group border border-border hover:border-accent/40 transition-all"
    >
      {!loaded && <div className="bg-bg-subtle h-40 animate-pulse" />}
      <img
        src={src} alt={img.title}
        onLoad={() => setLoaded(true)}
        className={`w-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        loading="lazy"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-3 flex flex-col justify-end">
        <p className="text-xs text-white line-clamp-2 mb-1">{img.title}</p>
        <div className="flex gap-1">
          <Badge variant="muted">{img.source_type}</Badge>
          {img.theme && <Badge variant="teal" mono>{img.theme}</Badge>}
        </div>
      </div>
    </div>
  )
}
```

**Step 3: Create frontend/src/features/images/Lightbox.tsx**

```typescript
import { useEffect } from 'react'

export function Lightbox({ img, onClose, onPrev, onNext }: {
  img: ImageRecord; onClose: () => void; onPrev?: () => void; onNext?: () => void
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev?.()
      if (e.key === 'ArrowRight') onNext?.()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, onPrev, onNext])

  const src = img.local_path ? `/cached-images/${img.local_path}` : img.image_url

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}>
      <button className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl" onClick={onClose}>×</button>
      {onPrev && <button className="absolute left-4 text-white/70 hover:text-white text-2xl px-2" onClick={e => { e.stopPropagation(); onPrev() }}>‹</button>}
      {onNext && <button className="absolute right-4 text-white/70 hover:text-white text-2xl px-2" onClick={e => { e.stopPropagation(); onNext() }}>›</button>}
      <img src={src} alt={img.title} className="max-h-[85vh] max-w-full rounded-xl object-contain"
        onClick={e => e.stopPropagation()} />
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-center text-white/80 text-sm max-w-lg px-4">
        <p>{img.title}</p>
        <p className="text-xs text-white/50 font-mono mt-1">{img.source_type} · {img.theme}</p>
      </div>
    </div>
  )
}
```

**Step 4: Create frontend/src/features/images/MediaPage.tsx**

```typescript
import { useState } from 'react'
import { useImages } from '@/hooks/useImages'
import { ImageCard } from './ImageCard'
import { Lightbox } from './Lightbox'
import { Button, Spinner } from '@/components'
import { useStore } from '@/store'

export function MediaPage() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useImages()
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const setFilter = useStore(s => s.setFilter)
  const imageTheme = useStore(s => s.filters.imageTheme)

  const images = data?.pages.flatMap(p => p.images) ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select value={imageTheme} onChange={e => setFilter('imageTheme', e.target.value)}
          className="px-3 py-2 bg-bg-subtle border border-border rounded-lg text-sm text-text-secondary focus:outline-none">
          <option value="">All themes</option>
          {['libido','pssd','erections','ejaculation_latency','orgasm'].map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <span className="text-sm text-text-muted">{images.length} images</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size={32} /></div>
      ) : (
        <div style={{ columns: '4 200px', columnGap: '12px' }}>
          {images.map((img, i) => (
            <ImageCard key={img.id} img={img} onClick={() => setLightboxIdx(i)} />
          ))}
        </div>
      )}

      {hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button variant="secondary" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}

      {lightboxIdx !== null && images[lightboxIdx] && (
        <Lightbox
          img={images[lightboxIdx]}
          onClose={() => setLightboxIdx(null)}
          onPrev={lightboxIdx > 0 ? () => setLightboxIdx(i => i! - 1) : undefined}
          onNext={lightboxIdx < images.length - 1 ? () => setLightboxIdx(i => i! + 1) : undefined}
        />
      )}
    </div>
  )
}
```

**Step 5: Commit**

```bash
git add frontend/src/features/images/ frontend/src/hooks/useImages.ts
git commit -m "feat: masonry image gallery with lazy load and lightbox"
```

---

## WAVE 3 — Integration

### Task 23: Wire up service.py to use new sources, run build, smoke test

**Files:**
- Modify: `app/service.py`
- Modify: `app/sources/__init__.py`

**Step 1: Add new sources to run_crawl in app/service.py**

Import and call `collect_pubmed`, `collect_biorxiv`, `collect_arxiv` alongside existing sources. Add `self._emit(...)` calls before/after each source call.

```python
from app.sources.pubmed import collect_pubmed
from app.sources.biorxiv import collect_biorxiv
from app.sources.arxiv import collect_arxiv

# In run_crawl, for each theme:
for source_fn, source_name in [
    (collect_literature, "duckduckgo"),
    (collect_anecdotes, "anecdotes"),
    (collect_reddit, "reddit"),
    (collect_x, "x"),
    (collect_lpsg, "lpsg"),
    (collect_pubmed, "pubmed"),
    (collect_biorxiv, "biorxiv"),
    (collect_arxiv, "arxiv"),
]:
    self._emit({"type": "source_start", "source": source_name, "theme": theme.slug})
    try:
        results = source_fn(session, self.settings, theme)
        self._emit({"type": "source_done", "source": source_name, "count": len(results)})
    except Exception as e:
        self._emit({"type": "error", "source": source_name, "message": str(e)})
        results = []
    # ... save to db
```

**Step 2: Build frontend**

```bash
cd frontend && npm run build
```

Expected: `app/static/dist/` populated with `index.html` and `assets/`

**Step 3: Start server and smoke test**

```bash
uvicorn app.main:app --reload --port 8000
```

- Visit http://localhost:8000 — React SPA should load
- Visit http://localhost:8000/api/dashboard — should return JSON
- Visit http://localhost:8000/items — should show source cards
- Visit http://localhost:8000/media — should show image gallery
- Visit http://localhost:8000/graph — should show D3 graph
- Press ⌘K — command palette should open

**Step 4: Update requirements.txt**

```
fastapi==0.135.1
uvicorn[standard]==0.34.0
requests==2.32.3
trafilatura==2.0.0
beautifulsoup4==4.13.4
python-dotenv==1.2.2
lxml==6.0.2
imagehash==4.3.2
Pillow==11.1.0
```

Remove `APScheduler` and `jinja2` since they're replaced by ARQ and the React SPA.

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: wire new sources into service, full integration complete"
```

---

## Type stubs (shared TypeScript types)

Create `frontend/src/types.ts` with:

```typescript
export interface ResearchItem {
  id: number
  source_type: string
  theme: string
  query: string
  title: string
  url: string
  summary: string
  content: string
  author: string
  published_at?: string
  domain: string
  image_url: string
  score: number
  compounds: string[]
  mechanisms: string[]
  metadata: Record<string, unknown>
  review_status: string
  is_saved: boolean
  user_note: string
  first_seen_at: string
  last_seen_at: string
}

export interface Hypothesis {
  id: number
  run_id: number
  title: string
  rationale: string
  evidence: string
  novelty_score: number
  safety_flags: string
  review_status: string
  is_saved: boolean
  user_note: string
  created_at: string
}

export interface ImageRecord {
  id: number
  item_id?: number
  source_type: string
  theme: string
  title: string
  image_url: string
  page_url: string
  thumb_url: string
  local_path: string
  created_at: string
}

export interface GraphNode {
  id: string
  label: string
  type: 'compound' | 'mechanism' | 'theme'
  weight: number
}

export interface GraphData {
  nodes: GraphNode[]
  links: { source: string; target: string; weight: number }[]
}

export interface ItemsPage {
  items: ResearchItem[]
  total: number
  has_more: boolean
}

export interface ImagesPage {
  images: ImageRecord[]
  total: number
  has_more: boolean
}

export interface DashboardPayload {
  app_name: string
  total_items: number
  saved_count: number
  hypotheses_count: number
  image_count: number
  last_run_at?: string
  theme_counts: { theme: string; count: number }[]
  compounds: string[]
  mechanisms: string[]
}
```

Add this import to all feature files: `import type { ResearchItem, Hypothesis, ... } from '@/types'`

---

## Dev workflow

```bash
# Terminal 1 — backend
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend (proxies /api to port 8000)
cd frontend && npm run dev

# Build for production
cd frontend && npm run build
# Then http://localhost:8000 serves the compiled SPA
```
