# Media Codex v2.0

A completely redesigned, premium queer media library and discovery platform.

**Live Demo**: [https://zailwtl7cfod6.kimi.page](https://zailwtl7cfod6.kimi.page)  
**Backend**: [https://codex-research-radar.onrender.com](https://codex-research-radar.onrender.com)

---

## What's New in v2.0

### Design — Completely Rebuilt from Scratch

- **Cinematic Hero** — Auto-rotating featured media with ambient backdrop blur, Ken Burns effect, and staggered text entrance
- **Smart Masonry Grid** — Responsive CSS grid that adapts to natural image aspect ratios
- **Premium Dark Mode** — Mature, sophisticated aesthetic (not cheap or tacky). Apple TV+ meets Are.na.
- **Ambient UI** — Cursor-following radial glow effect (desktop dark mode)
- **Smooth Page Transitions** — Framer Motion `AnimatePresence` with shared element transitions
- **Adaptive Accent** — Accent color subtly shifts based on featured content

### 15 Bugs Fixed

| Bug | Fix |
|-----|-----|
| Empty hero void | Cinematic rotating hero with real content |
| Grid layout glitches | True masonry with consistent alignment |
| Cramped category headers | Beautiful 80px cards with counts and gradients |
| Cheap VIDEO/NEW labels | Subtle 6px accent pulse dot |
| Tiny unreadable source labels | Properly sized badges with icons |
| Navigation clutter | Clean 4-section collapsible sidebar |
| Missing error states | Graceful blurred placeholder + retry button |
| Scroll jumping | `scrollTop` preservation + measured heights |
| Poor skeletons | Exact-shape skeletons with shimmer sweep |
| Mobile tab bar overlap | 80px bottom padding + safe-area-inset |
| Inconsistent border radius | Unified 6px/10px/14px/20px/999px system |
| Broken focus rings | 2px accent outline + 2px offset everywhere |
| Weak typography | Full Inter hierarchy: hero/h1/h2/h3/body/caption |
| Empty favorites void | Beautiful bounce-in illustration + CTA |
| No image blur-up | Progressive 20px blur → sharp crossfade |

### 14 Creative Improvements

1. **Preview on Hover** — Video cards play muted 3-second loops on hover
2. **Discovery Roulette** — "Surprise Me" button with animated card shuffle
3. **Creator Spotlights** — Weekly featured creator with animated conic-gradient ring
4. **Mood Filters** — "Late Night", "Morning", "Quick Break", "Deep Dive"
5. **Stats Badge System** — Gamification: Collector, Explorer, Curator
6. **Trending Pulse** — Live activity glow indicator on hot content
7. **Quick Actions** — Right-click / long-press context menu on all items
8. **Gesture Support** — Swipe between categories, pinch-to-zoom ready
9. **Category Cards** — Rich imagery cards instead of plain text headers
10. **Stories Rail** — Instagram-like horizontal creator stories
11. **Command Palette** — ⌘K global search with keyboard navigation
12. **Keyboard Shortcuts** — Full shortcut system (?, /, J, K, L, F, etc.)
13. **Bulk Selection** — Ctrl+click or long-press multi-select
14. **Watch Party Indicator** — Simulated shared viewing experience

---

## Architecture

### Frontend (this directory)

| Layer | Technology |
|-------|------------|
| Framework | React 19 + TypeScript |
| Build Tool | Vite 7.3 |
| Styling | Tailwind CSS v3.4 + shadcn/ui |
| Animations | Framer Motion |
| State | Zustand (with persist middleware) |
| Data Fetching | TanStack Query (React Query) |
| Charts | Recharts |
| Icons | Lucide React |

### Backend (separate — your existing FastAPI app)

The frontend connects to your existing Python/FastAPI backend running on Render.

---

## Project Structure

```
├── src/
│   ├── components/          # Shared UI components
│   │   ├── Navbar.tsx       # Collapsible sidebar (240px → 72px)
│   │   ├── TopBar.tsx       # Fixed 56px header with search
│   │   ├── Layout.tsx       # Responsive app shell
│   │   ├── BottomTabBar.tsx # Mobile 64px tab bar
│   │   ├── MediaCard.tsx    # Primary content card
│   │   ├── MediaDetail.tsx  # Slide-out detail drawer
│   │   ├── CategoryHeader.tsx
│   │   ├── EmptyState.tsx
│   │   ├── SkeletonGrid.tsx
│   │   ├── Toast.tsx
│   │   ├── CommandPalette.tsx
│   │   └── AmbientGlow.tsx  # Cursor-following glow
│   ├── pages/
│   │   ├── Home.tsx         # Media library (main page)
│   │   ├── Explore.tsx      # Discovery hub
│   │   ├── Creators.tsx     # Performer directory
│   │   ├── Search.tsx       # Search with filters
│   │   ├── Settings.tsx     # 6-section settings
│   │   └── Analytics.tsx    # Charts + stats dashboard
│   ├── lib/
│   │   ├── api.ts           # Hybrid API (real + mock fallback)
│   │   ├── api-adapter.ts   # Type adapters (Backend → Frontend)
│   │   ├── backendOrigin.ts # API URL resolution
│   │   ├── mockData.ts      # Fallback demo data
│   │   └── utils.ts
│   ├── store.ts             # Zustand global state
│   └── index.css            # Design token system
├── .env.example
├── tailwind.config.js
├── tsconfig.app.json
└── vite.config.ts
```

---

## Connecting to Your Backend

The frontend auto-detects how to connect to your FastAPI backend:

### Automatic Detection

| Frontend Host | Backend Target |
|--------------|----------------|
| `localhost` | Same-origin (expects backend on `:8000`) |
| `*.onrender.com` | Same-origin |
| Any other host (Vercel, Netlify, etc.) | `https://codex-research-radar.onrender.com` |

### Manual Override

Create a `.env` file in the **frontend root** (this directory):

```bash
# .env
VITE_BACKEND_ORIGIN=https://codex-research-radar.onrender.com
```

Then rebuild:

```bash
npm run build
```

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/screenshots` | Browse media items |
| `GET /api/screenshots/terms` | Category list |
| `GET /api/screenshots/media-stats` | Media statistics |
| `GET /api/screenshots/search?q=` | Search media |
| `GET /api/screenshots/{id}` | Single media item |
| `GET /api/screenshots/{id}/related` | Related items |
| `GET /api/performers` | Creator list |
| `GET /api/performers/stats` | Creator statistics |
| `GET /api/performers/analytics` | Creator analytics |
| `GET /api/search/unified?q=` | Unified search |
| `GET /api/stats/insights` | Analytics insights |
| `GET /api/stats/trends?days=` | Trend data |
| `GET /api/stats/source-health` | Source health |
| `GET /api/dashboard` | Dashboard data |
| `GET /api/settings` | User settings |
| `PUT /api/settings` | Update settings |

### Graceful Fallback

If the backend is unreachable (offline, 5xx error, timeout), the frontend **automatically falls back to mock data** with a console warning. The app never crashes — it always shows content.

---

## Development

### Prerequisites

- Node.js 20+
- npm 10+

### Install

```bash
npm install
```

### Run Dev Server

```bash
npm run dev
```

### Build for Production

```bash
npm run build
```

Output goes to `dist/`.

### Type Check

```bash
npx tsc --noEmit
```

---

## Deployment

### Option A: Render (Recommended — matches your current setup)

Your existing Render web service can serve the built frontend:

1. Build the frontend:
   ```bash
   npm run build
   ```

2. Ensure your FastAPI app serves the `dist/` folder at root path (`/`)

3. Set environment variable in Render:
   - `VITE_BACKEND_ORIGIN` = `https://codex-research-radar.onrender.com` (if frontend and backend are separate services)

### Option B: Vercel (Frontend Only)

1. Install Vercel CLI: `npm i -g vercel`
2. Run: `vercel`
3. Set environment variable in Vercel dashboard:
   - `VITE_BACKEND_ORIGIN` = `https://codex-research-radar.onrender.com`

The frontend will auto-detect and connect to your Render backend.

### Option C: Netlify

1. Run: `npm run build`
2. Deploy `dist/` folder
3. Set environment variable:
   - `VITE_BACKEND_ORIGIN` = `https://codex-research-radar.onrender.com`

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_BACKEND_ORIGIN` | No | Auto-detected | FastAPI backend URL (no trailing slash) |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `?` | Show keyboard shortcuts |
| `/` or `⌘K` | Open search / command palette |
| `J` / `K` | Next / Previous item |
| `L` | Like item |
| `F` | Favorite item |
| `S` | Share item |
| `Esc` | Close modal / drawer |
| `Space` | Play / Pause video |
| `M` | Mute / Unmute |

---

## PWA / Offline Support

The app is built as a Progressive Web App:
- Service worker ready (add `vite-plugin-pwa` to enable)
- Offline fallback to mock data
- Add to Home Screen support

---

## Browser Support

- Chrome 120+
- Firefox 120+
- Safari 17+
- Edge 120+

---

## Credits

- **Frontend**: Rebuilt with React 19, Tailwind CSS, Framer Motion
- **Backend**: Your existing FastAPI app (unchanged)
- **Design System**: Custom-built for queer media curation

---

## License

Same as your existing project.
