# Full Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the Codex Research Radar into a polished, installable PWA with glassmorphism design, media-first UX, uncensored AI features, and mobile-optimized experience.

**Architecture:** Keep the existing FastAPI + React/Vite + Zustand + TanStack Query stack. Add hash-based URL routing (no React Router migration). Add service worker for PWA. Upgrade visual design via CSS custom properties + utility classes. Add new API endpoints for settings persistence and AI features. Virtual scroll for performance.

**Tech Stack:** React 19, Vite 6, Zustand 5, TanStack Query 5, Tailwind CSS 4, D3 7, Recharts, Inter + JetBrains Mono fonts, Workbox (service worker), FastAPI, SQLite

---

## Phase 1: Foundation — Navigation & URL Routing

### Task 1: Hash-based URL Sync

**Files:**
- Modify: `frontend/src/store.ts` — add hash sync logic
- Modify: `frontend/src/main.tsx` — remove unused BrowserRouter

**Step 1: Add hash sync to store**

In `frontend/src/store.ts`, add a `syncHash` function and modify `setActiveView` to update `location.hash`. Add a `hashchange` listener on window.

```typescript
// Add after imports
const VIEW_HASHES: Record<string, ActiveView> = {
  '#/overview': 'overview',
  '#/items': 'items',
  '#/media': 'images',
  '#/hypotheses': 'hypotheses',
  '#/graph': 'graph',
  '#/settings': 'settings',
};
const HASH_VIEWS: Record<ActiveView, string> = {
  overview: '#/overview',
  items: '#/items',
  images: '#/media',
  hypotheses: '#/hypotheses',
  graph: '#/graph',
  settings: '#/settings',
};

function getViewFromHash(): ActiveView {
  const hash = window.location.hash || '#/media';  // default to media (primary workflow)
  return VIEW_HASHES[hash.split('?')[0]] || 'images';
}
```

Modify `setActiveView` in the store:
```typescript
setActiveView: (v) => {
  set({ activeView: v });
  const newHash = HASH_VIEWS[v] || '#/media';
  if (window.location.hash.split('?')[0] !== newHash) {
    window.location.hash = newHash;
  }
},
```

Initialize `activeView` from hash:
```typescript
activeView: getViewFromHash(),
```

**Step 2: Add hashchange listener in main.tsx**

```typescript
// In main.tsx, after QueryClient setup
window.addEventListener('hashchange', () => {
  const view = getViewFromHash();
  const current = useAppStore.getState().activeView;
  if (view !== current) {
    useAppStore.getState().setActiveView(view);
  }
});
```

Export `getViewFromHash` from store.ts for use in main.tsx.

**Step 3: Remove BrowserRouter from main.tsx**

Remove the `import { BrowserRouter } from 'react-router-dom'` and remove the `<BrowserRouter>` wrapper from the JSX tree. It's unused.

**Step 4: Commit**

```bash
git add frontend/src/store.ts frontend/src/main.tsx
git commit -m "feat: add hash-based URL routing with browser back/forward support"
```

### Task 2: Deep Links for Media Filters

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx` — sync filters to URL hash params

**Step 1: Read filter state from hash params on mount**

```typescript
function getMediaFiltersFromHash(): { term?: string; source?: string } {
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return {};
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  return {
    term: params.get('term') || undefined,
    source: params.get('source') || undefined,
  };
}
```

On mount, initialize `selectedTerm` and `selectedSource` from hash params. On filter change, update hash params without triggering navigation.

**Step 2: Update hash on filter change**

```typescript
function updateMediaHash(term?: string, source?: string) {
  const params = new URLSearchParams();
  if (term) params.set('term', term);
  if (source) params.set('source', source);
  const qs = params.toString();
  window.location.hash = '#/media' + (qs ? '?' + qs : '');
}
```

Call `updateMediaHash` from the term/source filter change handlers.

**Step 3: Commit**

```bash
git add frontend/src/features/images/MediaPage.tsx
git commit -m "feat: deep link media filters via hash params"
```

### Task 3: Mobile Bottom Tab Bar

**Files:**
- Create: `frontend/src/components/BottomTabBar.tsx`
- Modify: `frontend/src/components/AppShell.tsx` — render BottomTabBar on mobile
- Modify: `frontend/src/components/Sidebar.tsx` — hide on mobile when BottomTabBar is active

**Step 1: Create BottomTabBar component**

```tsx
// frontend/src/components/BottomTabBar.tsx
import { useAppStore } from '../store';
import type { ActiveView } from '../store';

const TABS: { id: ActiveView; label: string; icon: string }[] = [
  { id: 'overview', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4' },
  { id: 'items', label: 'Items', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { id: 'images', label: 'Media', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { id: 'hypotheses', label: 'Brain', icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
  { id: 'graph', label: 'Graph', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
];

export function BottomTabBar() {
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-white/10 bg-[var(--color-bg-base)]/90 backdrop-blur-xl md:hidden"
         style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {TABS.map((tab) => {
        const active = activeView === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ${
              active ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'
            }`}
          >
            {active && (
              <span className="absolute top-0 h-0.5 w-8 rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-teal)]" />
            )}
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
            </svg>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
```

**Step 2: Add to AppShell, hide sidebar on mobile**

In `AppShell.tsx`, import `BottomTabBar` and render it. Add `pb-16 md:pb-0` to the main content area so content isn't hidden behind the tab bar.

In `Sidebar.tsx`, add `hidden md:flex` to the sidebar container so it's desktop-only.

**Step 3: Commit**

```bash
git add frontend/src/components/BottomTabBar.tsx frontend/src/components/AppShell.tsx frontend/src/components/Sidebar.tsx
git commit -m "feat: add mobile bottom tab bar, hide sidebar on mobile"
```

### Task 4: Desktop Sidebar Polish

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx` — smooth collapse animation, tooltip on collapsed items

**Step 1: Add CSS transition for width**

Replace hard width toggle with CSS transition: `transition: width 200ms cubic-bezier(0.4, 0, 0.2, 1)`. Add `title={label}` attribute to nav items when collapsed for native tooltip.

**Step 2: Commit**

```bash
git add frontend/src/components/Sidebar.tsx
git commit -m "feat: polish sidebar collapse animation and tooltips"
```

---

## Phase 2: Visual Redesign

### Task 5: Typography & Font Upgrade

**Files:**
- Modify: `frontend/index.html` — add Inter font
- Modify: `frontend/src/index.css` — update font variables

**Step 1: Add Inter from Google Fonts**

Add to `<head>` in `index.html`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Step 2: Update CSS font variables**

In `index.css` @theme block, change `--font-sans` to `'Inter', 'IBM Plex Sans', system-ui, sans-serif`.

**Step 3: Add gradient text utility for page titles**

```css
.hero-gradient {
  background: linear-gradient(135deg, var(--color-accent), var(--color-teal));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

**Step 4: Commit**

```bash
git add frontend/index.html frontend/src/index.css
git commit -m "feat: upgrade typography to Inter, add gradient text utility"
```

### Task 6: Glassmorphism Design System

**Files:**
- Modify: `frontend/src/index.css` — new glass utilities and depth system

**Step 1: Add 4-tier depth system**

```css
.depth-base { background: var(--color-bg-base); }
.depth-surface {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.depth-elevated {
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.depth-floating {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
```

**Step 2: Upgrade existing `.glass` class**

```css
.glass {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(16px) saturate(1.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  transition: border-color 200ms, box-shadow 200ms;
}
.glass:hover {
  border-color: rgba(255, 255, 255, 0.15);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 0 20px rgba(var(--color-accent-rgb), 0.1);
}
```

**Step 3: Gradient accent pairs**

```css
.gradient-accent {
  background: linear-gradient(135deg, var(--color-accent), var(--color-teal));
}
.border-glow {
  border: 1px solid transparent;
  background-clip: padding-box;
  box-shadow: 0 0 12px rgba(var(--color-accent-rgb), 0.15);
}
```

**Step 4: Micro-animation utilities**

```css
.card-glass {
  transition: transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease;
}
.card-glass:hover {
  transform: translateY(-2px) scale(1.01);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}
.fade-in { animation: fadeIn 300ms ease-out; }
.slide-up { animation: slideUp 300ms ease-out; }
.zoom-in { animation: zoomIn 200ms ease-out; }

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes zoomIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
```

**Step 5: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: glassmorphism design system with depth tiers and micro-animations"
```

### Task 7: Apply Glass Design to Sidebar & Cards

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx` — apply glass classes
- Modify: `frontend/src/components/AppShell.tsx` — apply depth-base
- Modify: `frontend/src/features/items/ItemsPage.tsx` — apply card-glass to SourceCard
- Modify: `frontend/src/features/overview/OverviewPage.tsx` — glass cards for stats

**Step 1:** Replace `bg-[var(--color-bg-surface)]` with `glass` class on Sidebar container. Replace card wrapper classes with `card-glass glass`. Replace modal/drawer backgrounds with `depth-elevated`.

**Step 2:** Apply `hero-gradient` class to page titles (MediaPage, ItemsPage, HypothesesPage, etc.).

**Step 3: Commit**

```bash
git add frontend/src/components/ frontend/src/features/
git commit -m "feat: apply glassmorphism to sidebar, cards, and page titles"
```

### Task 8: Accent Color Gradient Pairs

**Files:**
- Modify: `frontend/src/features/settings/SettingsPage.tsx` — generate gradient pairs
- Modify: `frontend/src/main.tsx` — restore gradient on load
- Modify: `frontend/src/index.css` — add accent-rgb variable

**Step 1: Update ACCENT_COLORS to include gradient pair**

```typescript
const ACCENT_COLORS = [
  { name: 'Ocean',   primary: '#3b82f6', secondary: '#06b6d4' },
  { name: 'Violet',  primary: '#a855f7', secondary: '#ec4899' },
  { name: 'Emerald', primary: '#10b981', secondary: '#14b8a6' },
  { name: 'Sunset',  primary: '#f59e0b', secondary: '#ef4444' },
  { name: 'Rose',    primary: '#f43f5e', secondary: '#a855f7' },
  { name: 'Indigo',  primary: '#6366f1', secondary: '#3b82f6' },
  { name: 'Mint',    primary: '#14b8a6', secondary: '#22c55e' },
  { name: 'Flame',   primary: '#ef4444', secondary: '#f97316' },
];
```

`applyAccent` sets both `--color-accent` and `--color-accent-secondary`, plus `--color-accent-rgb` (for rgba usage). Store both values in localStorage.

**Step 2: Commit**

```bash
git add frontend/src/features/settings/SettingsPage.tsx frontend/src/main.tsx frontend/src/index.css
git commit -m "feat: gradient accent color pairs with RGB variable"
```

---

## Phase 3: Media Gallery Redesign

### Task 9: Smart Collections View

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx` — add collections grid
- Modify: `frontend/src/lib/api.ts` — update screenshot terms type

**Step 1: Update terms endpoint to return counts (already done in backend)**

The `/api/screenshots/terms` endpoint returns `{term, count}` pairs. Update the `api.ts` type:
```typescript
interface ScreenshotTerm { term: string; count: number; }
```

**Step 2: Build CollectionCard component**

```tsx
function CollectionCard({ term, count, images, onClick }: {
  term: string; count: number; images: Screenshot[]; onClick: () => void;
}) {
  const previews = images.slice(0, 4);
  return (
    <button onClick={onClick} className="card-glass glass group overflow-hidden rounded-xl text-left">
      <div className="grid grid-cols-2 aspect-[4/3]">
        {previews.map((img, i) => (
          <div key={i} className="overflow-hidden">
            {img.local_url?.endsWith('.mp4') ? (
              <video src={img.local_url} className="h-full w-full object-cover" muted />
            ) : (
              <img src={img.local_url} className="h-full w-full object-cover" loading="lazy" />
            )}
          </div>
        ))}
        {Array.from({ length: Math.max(0, 4 - previews.length) }).map((_, i) => (
          <div key={`empty-${i}`} className="bg-white/5" />
        ))}
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-[var(--color-text-primary)]">{term}</h3>
        <p className="text-xs text-[var(--color-text-muted)]">{count} items</p>
      </div>
    </button>
  );
}
```

**Step 3: Add collections mode toggle**

Add state: `const [viewMode, setViewMode] = useState<'collections' | 'grid' | 'filmstrip'>('collections')`. Show collections grid when no term is selected; show item grid when a collection is opened.

**Step 4: Commit**

```bash
git add frontend/src/features/images/MediaPage.tsx frontend/src/lib/api.ts
git commit -m "feat: smart collections view with mosaic preview cards"
```

### Task 10: Gallery View Modes (Grid + Filmstrip)

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx` — filmstrip view, view mode toggle

**Step 1: Add FilmstripView component**

Horizontal scroll container with large preview cards. Each card is ~300px wide, full height. Scroll snap for smooth navigation.

```tsx
function FilmstripView({ shots, onSelect }: { shots: Screenshot[]; onSelect: (idx: number) => void }) {
  return (
    <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory px-4 pb-4 hide-scrollbar">
      {shots.map((shot, i) => (
        <button key={shot.id} onClick={() => onSelect(i)}
          className="flex-none snap-center w-72 aspect-[3/4] overflow-hidden rounded-xl card-glass">
          {shot.local_url?.endsWith('.mp4') ? (
            <video src={shot.local_url} className="h-full w-full object-cover" muted />
          ) : (
            <img src={shot.local_url} className="h-full w-full object-cover" loading="lazy" />
          )}
        </button>
      ))}
    </div>
  );
}
```

**Step 2: Add view mode toggle buttons**

Three icon buttons (grid, filmstrip, slideshow) in the filter bar area.

**Step 3: Commit**

```bash
git add frontend/src/features/images/MediaPage.tsx
git commit -m "feat: filmstrip view mode and view toggle"
```

### Task 11: Immersive Lightbox Redesign

**Files:**
- Modify: `frontend/src/features/images/ScreenshotLightbox.tsx` — full redesign

**Step 1: Redesign lightbox layout**

- Background: `bg-black/95 backdrop-blur-xl`
- Image/video fills viewport with `object-contain max-h-[85vh]`
- Floating glass pill controls at top: close, slideshow, favorite, describe, delete
- Info panel slides up from bottom on tap/click (toggle)
- Navigation: large transparent hit areas on left/right edges, plus arrow key support

**Step 2: Add touch gesture support**

```typescript
// Touch handling for swipe navigation
const touchStartX = useRef(0);
const touchStartY = useRef(0);

const onTouchStart = (e: React.TouchEvent) => {
  touchStartX.current = e.touches[0].clientX;
  touchStartY.current = e.touches[0].clientY;
};
const onTouchEnd = (e: React.TouchEvent) => {
  const dx = e.changedTouches[0].clientX - touchStartX.current;
  const dy = e.changedTouches[0].clientY - touchStartY.current;
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
    if (dx > 0) onNavigate(idx - 1);  // swipe right = prev
    else onNavigate(idx + 1);  // swipe left = next
  } else if (dy > 80) {
    onClose();  // swipe down = dismiss
  }
};
```

**Step 3: Add pinch-to-zoom**

Track two-finger touch distance delta, apply CSS `transform: scale()` to the image element. Reset on release.

**Step 4: Keyboard shortcuts**

- `f` — toggle favorite
- `d` — trigger AI describe
- `Space` — play/pause video
- `Escape` — close lightbox
- Arrow keys — navigate

**Step 5: Commit**

```bash
git add frontend/src/features/images/ScreenshotLightbox.tsx
git commit -m "feat: immersive lightbox with gestures, pinch-zoom, and keyboard shortcuts"
```

### Task 12: Video-First Cards

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx` — larger video cards, hover preview

**Step 1: Make video cards span 2 columns in the masonry grid**

Detect if `shot.local_url?.endsWith('.mp4')` and add `col-span-2` class.

**Step 2: Hover-to-preview (already partially done)**

Ensure videos play first 3 seconds on hover, with muted audio. Pause and reset on mouse leave.

**Step 3: Video playback in lightbox**

Add full controls: scrub bar, volume slider, playback speed (0.5x/1x/1.5x/2x), fullscreen button.

**Step 4: Commit**

```bash
git add frontend/src/features/images/MediaPage.tsx
git commit -m "feat: video-first cards with 2x width and hover preview"
```

### Task 13: Batch Mode

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx` — batch selection + action bar

**Step 1: Add batch state**

```typescript
const [batchMode, setBatchMode] = useState(false);
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
```

**Step 2: Selection toggle on card click in batch mode**

When `batchMode` is true, clicking a card toggles its selection (checkmark overlay) instead of opening lightbox.

**Step 3: Bottom action bar**

When selections exist, show a sticky bottom bar:
```tsx
{selectedIds.size > 0 && (
  <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between gap-4 px-6 py-3 glass border-t border-white/10 md:bottom-0"
       style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}>
    <span className="text-sm">{selectedIds.size} selected</span>
    <div className="flex gap-2">
      <button className="btn-glass">Favorite {selectedIds.size}</button>
      <button className="btn-glass">AI Describe {selectedIds.size}</button>
      <button className="btn-glass text-red-400">Delete {selectedIds.size}</button>
    </div>
  </div>
)}
```

**Step 4: `m` keyboard shortcut to toggle batch mode**

**Step 5: Commit**

```bash
git add frontend/src/features/images/MediaPage.tsx
git commit -m "feat: batch mode with multi-select and action bar"
```

### Task 14: Virtual Scroll for Performance

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx` — virtual rendering

**Step 1: Implement simple virtual scroll**

Instead of adding a dependency, use IntersectionObserver-based lazy rendering. Track which "rows" of cards are near the viewport and only render those. Use `content-visibility: auto` CSS property for browser-level optimization.

```css
.media-card-virtual {
  content-visibility: auto;
  contain-intrinsic-size: 0 300px;
}
```

**Step 2: Commit**

```bash
git add frontend/src/features/images/MediaPage.tsx frontend/src/index.css
git commit -m "feat: virtual scroll with content-visibility for media grid"
```

### Task 15: Filter Bar Upgrade

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx` — sticky glass filter bar with badges

**Step 1: Make filter bar sticky**

```tsx
<div className="sticky top-0 z-30 glass border-b border-white/10 px-4 py-3">
```

**Step 2: Source pills with count badges**

```tsx
{sources.map((s) => (
  <button key={s.source} onClick={() => setSelectedSource(s.source)}
    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
      selectedSource === s.source ? 'gradient-accent text-white' : 'glass'
    }`}>
    {s.source}
    <span className="rounded-full bg-white/10 px-1.5 text-[10px]">{s.count}</span>
  </button>
))}
```

**Step 3: Term autocomplete search**

Add a text input with dropdown showing matching terms as the user types.

**Step 4: Commit**

```bash
git add frontend/src/features/images/MediaPage.tsx
git commit -m "feat: sticky glass filter bar with source badges and term autocomplete"
```

### Task 16: Capture Progress Overlay

**Files:**
- Modify: `app/api/screenshots.py` — track capture progress in app.state
- Modify: `frontend/src/features/images/MediaPage.tsx` — progress banner

**Step 1: Backend — track progress**

In `_run_capture()`, update `request.app.state.screenshot_progress` dict with `current_term`, `terms_done`, `terms_total`, `items_found`. Return this from `/api/screenshots/status`.

```python
# In screenshots.py, modify _run_capture
def _run_capture(app_state, settings, db, image_dir):
    from app.sources.screenshot import capture_screenshots, TERM_QUERIES
    total_terms = len(TERM_QUERIES)
    app_state.screenshot_progress = {"current_term": "", "terms_done": 0, "terms_total": total_terms, "items_found": 0}

    current_term = ""
    items_found = 0
    def progress_cb(term, source, done, total):
        nonlocal current_term, items_found
        current_term = term
        app_state.screenshot_progress = {
            "current_term": term, "terms_done": list(TERM_QUERIES.keys()).index(term),
            "terms_total": total_terms, "items_found": items_found,
        }

    for result in capture_screenshots(image_dir, progress_cb=progress_cb, db=db, settings=settings):
        if result["ok"] and result.get("local_path"):
            items_found += 1
            db.insert_screenshot(result["term"], result["source"], result.get("page_url", ""), result["local_path"])

    app_state.screenshot_progress = None
    return items_found
```

Modify `/status` endpoint to return progress:
```python
@router.get("/status")
async def capture_status(request: Request):
    running = getattr(request.app.state, "screenshot_running", False)
    progress = getattr(request.app.state, "screenshot_progress", None)
    return {"running": running, **(progress or {})}
```

**Step 2: Frontend — progress banner**

Poll `/api/screenshots/status` every 2s when capturing. Show glass bar:
```tsx
{captureStatus?.running && captureStatus.current_term && (
  <div className="glass border-b border-white/10 px-4 py-2 flex items-center gap-3">
    <div className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden">
      <div className="h-full gradient-accent rounded-full transition-all"
           style={{ width: `${(captureStatus.terms_done / captureStatus.terms_total) * 100}%` }} />
    </div>
    <span className="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">
      {captureStatus.current_term} ({captureStatus.items_found} found)
    </span>
  </div>
)}
```

**Step 3: Commit**

```bash
git add app/api/screenshots.py frontend/src/features/images/MediaPage.tsx
git commit -m "feat: real-time capture progress bar with term tracking"
```

---

## Phase 4: PWA

### Task 17: Web App Manifest

**Files:**
- Create: `frontend/public/manifest.json`
- Create: `frontend/public/icons/` — app icons (generate with SVG)
- Modify: `frontend/index.html` — link manifest

**Step 1: Create manifest.json**

```json
{
  "name": "Codex Research Radar",
  "short_name": "Codex",
  "description": "Research aggregation and media analysis platform",
  "start_url": "/#/media",
  "display": "standalone",
  "background_color": "#0a0e17",
  "theme_color": "#3b82f6",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

**Step 2: Generate icons**

Create simple SVG-based icons (a radar/compass symbol). Convert to PNG at 192px and 512px.

**Step 3: Link in index.html**

```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#3b82f6">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

**Step 4: Commit**

```bash
git add frontend/public/ frontend/index.html
git commit -m "feat: PWA manifest with app icons"
```

### Task 18: Service Worker

**Files:**
- Create: `frontend/public/sw.js` — service worker
- Modify: `frontend/src/main.tsx` — register service worker

**Step 1: Create service worker**

Cache app shell (HTML, JS, CSS) on install. Use stale-while-revalidate for API calls. Cache-first for images/videos.

```javascript
const CACHE_NAME = 'codex-v1';
const SHELL_URLS = ['/', '/index.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL_URLS)));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Cache-first for static assets and media
  if (url.pathname.startsWith('/data/') || url.pathname.match(/\.(js|css|woff2|png|jpg|webp|mp4)$/)) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
      return res;
    })));
    return;
  }
  // Stale-while-revalidate for API
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        return res;
      });
      return cached || fetched;
    }));
    return;
  }
  // Network-first for everything else
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
```

**Step 2: Register in main.tsx**

```typescript
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
```

**Step 3: Commit**

```bash
git add frontend/public/sw.js frontend/src/main.tsx
git commit -m "feat: service worker with offline support and caching strategies"
```

### Task 19: Install Prompt

**Files:**
- Create: `frontend/src/components/InstallPrompt.tsx`
- Modify: `frontend/src/components/AppShell.tsx` — render install prompt

**Step 1: Create InstallPrompt component**

Listen for `beforeinstallprompt` event. Show a glass banner with "Install Codex" button. Dismiss saves to localStorage so it doesn't show again.

**Step 2: Commit**

```bash
git add frontend/src/components/InstallPrompt.tsx frontend/src/components/AppShell.tsx
git commit -m "feat: PWA install prompt banner"
```

---

## Phase 5: AI Features (Uncensored)

### Task 20: Settings Persistence Backend

**Files:**
- Modify: `app/db.py` — add settings table + CRUD
- Create: `app/api/settings.py` — settings API endpoints
- Modify: `app/main.py` — register settings router

**Step 1: Add settings table to DB**

```python
# In db.py _create_tables()
conn.execute("""
    CREATE TABLE IF NOT EXISTS user_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
""")
```

Add methods: `get_setting(key)`, `set_setting(key, value)`, `get_all_settings()`.

**Step 2: Create settings API**

```python
# app/api/settings.py
@router.get("")
async def get_settings(request: Request):
    db = request.app.state.db
    return db.get_all_settings()

@router.put("")
async def update_settings(request: Request, body: dict):
    db = request.app.state.db
    for key, value in body.items():
        db.set_setting(key, json.dumps(value))
    return {"ok": True}
```

**Step 3: Register router in main.py**

```python
from app.api.settings import router as settings_router
app.include_router(settings_router, prefix="/api/settings")
```

**Step 4: Commit**

```bash
git add app/db.py app/api/settings.py app/main.py
git commit -m "feat: settings persistence API with SQLite backend"
```

### Task 21: Vision AI Settings UI

**Files:**
- Modify: `frontend/src/features/settings/SettingsPage.tsx` — add Vision AI section

**Step 1: Add VisionAISection component**

Fields: Base URL, Model Name, API Key (password input). Presets dropdown: OpenAI, Ollama (localhost:11434), Together AI, OpenRouter. Save button persists to backend via `/api/settings`.

**Step 2: Commit**

```bash
git add frontend/src/features/settings/SettingsPage.tsx
git commit -m "feat: vision AI model configuration in settings"
```

### Task 22: Uncensored AI Describe Prompt

**Files:**
- Modify: `app/api/screenshots.py` — update summarize prompt for NSFW detail

**Step 1: Update the summarize endpoint prompt**

Replace the existing prompt with an uncensored, research-focused prompt:

```python
_SUMMARIZE_PROMPT = (
    "You are a clinical research cataloging assistant. Describe this image in explicit, "
    "uncensored detail for a sexual health research database. Include:\n"
    "1. Body type and physical attributes (build, musculature, body hair, skin tone)\n"
    "2. Anatomy visible (specific body parts, state of arousal if applicable)\n"
    "3. Activity or pose (sexual act, position, solo/duo/group)\n"
    "4. Setting and context\n"
    "5. Estimated age range (young adult, adult, middle-aged)\n\n"
    "Be clinical and descriptive. Do not censor or euphemize. This is for medical/research purposes.\n\n"
    "Respond with JSON:\n"
    '{"description": "detailed text", "tags": {"body_type": "...", "act_type": "...", '
    '"anatomy": ["..."], "participant_count": "solo|duo|group", "age_range": "..."}}'
)
```

**Step 2: Parse and store tags**

Add `ai_tags` column to screenshots table (JSON text). Parse the response JSON and store both `ai_summary` (description text) and `ai_tags` (structured tags JSON).

```python
# In db.py _migrate()
if "ai_tags" not in screenshot_columns:
    conn.execute("ALTER TABLE screenshots ADD COLUMN ai_tags TEXT DEFAULT NULL")
```

**Step 3: Refusal detection**

```python
# After getting response, check for refusal patterns
refusal_patterns = ["i cannot", "i can't", "i'm unable", "not appropriate", "i apologize"]
if any(p in content.lower() for p in refusal_patterns):
    return JSONResponse({"summary": None, "refused": True, "message": "Model refused NSFW content. Try an uncensored model in Settings."}, status_code=200)
```

**Step 4: Commit**

```bash
git add app/api/screenshots.py app/db.py
git commit -m "feat: uncensored NSFW AI description with structured tags and refusal detection"
```

### Task 23: AI Describe in Lightbox UI

**Files:**
- Modify: `frontend/src/features/images/ScreenshotLightbox.tsx` — describe button + display
- Modify: `frontend/src/lib/api.ts` — add summarize mutation

**Step 1: Add summarize API call**

```typescript
// In api.ts
export async function summarizeScreenshot(id: number): Promise<{ summary: string; refused?: boolean; tags?: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/screenshots/${id}/summarize`, { method: 'POST' });
  return res.json();
}
```

**Step 2: Add describe button + summary display in lightbox**

In the info panel, show a "Describe" button that calls the mutation. While loading, show typing animation dots. Once complete, show the description text. If `refused`, show warning with link to settings. Display tags as chips below the description.

**Step 3: Commit**

```bash
git add frontend/src/features/images/ScreenshotLightbox.tsx frontend/src/lib/api.ts
git commit -m "feat: AI describe button in lightbox with tag display"
```

### Task 24: Batch AI Describe

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx` — batch describe action

**Step 1: Add batch describe handler**

```typescript
async function handleBatchDescribe() {
  const ids = Array.from(selectedIds);
  setDescribing(true);
  setDescribeProgress({ done: 0, total: ids.length });
  for (const id of ids) {
    await summarizeScreenshot(id);
    setDescribeProgress((p) => ({ ...p, done: p.done + 1 }));
  }
  setDescribing(false);
  queryClient.invalidateQueries({ queryKey: ['screenshots'] });
}
```

**Step 2: Progress indicator in batch bar**

Show "Describing 3/12..." with progress bar while running.

**Step 3: Commit**

```bash
git add frontend/src/features/images/MediaPage.tsx
git commit -m "feat: batch AI describe with progress indicator"
```

### Task 25: AI Search (FTS on Summaries)

**Files:**
- Modify: `app/db.py` — add FTS index on ai_summary
- Modify: `app/api/screenshots.py` — add search endpoint
- Modify: `frontend/src/features/images/MediaPage.tsx` — wire search to FTS

**Step 1: Add FTS virtual table**

```python
# In db.py _migrate()
conn.execute("""
    CREATE VIRTUAL TABLE IF NOT EXISTS screenshots_fts
    USING fts5(ai_summary, ai_tags, content=screenshots, content_rowid=id)
""")
```

Add triggers to keep FTS in sync on INSERT/UPDATE/DELETE.

**Step 2: Add search endpoint**

```python
@router.get("/search")
async def search_screenshots(request: Request, q: str, limit: int = 50):
    db = request.app.state.db
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT s.* FROM screenshots_fts f JOIN screenshots s ON f.rowid = s.id WHERE f.screenshots_fts MATCH ? LIMIT ?",
            (q, limit)
        ).fetchall()
    return [dict(r) for r in rows]
```

**Step 3: Wire frontend search bar to FTS**

When user types in the search field, if query length > 2, call `/api/screenshots/search?q=...` instead of the regular browse endpoint. Debounce at 300ms.

**Step 4: Commit**

```bash
git add app/db.py app/api/screenshots.py frontend/src/features/images/MediaPage.tsx
git commit -m "feat: AI-powered search using FTS on AI summaries"
```

### Task 26: More Like This

**Files:**
- Modify: `frontend/src/features/images/ScreenshotLightbox.tsx` — "More like this" button
- Modify: `app/api/screenshots.py` — similar endpoint

**Step 1: Backend — find similar by tag overlap**

```python
@router.get("/{screenshot_id}/similar")
async def find_similar(request: Request, screenshot_id: int, limit: int = 12):
    db = request.app.state.db
    with db.connect() as conn:
        source = conn.execute("SELECT ai_tags FROM screenshots WHERE id = ?", (screenshot_id,)).fetchone()
        if not source or not source["ai_tags"]:
            return []
        # Simple keyword overlap scoring
        source_tags = set(json.loads(source["ai_tags"]).values()) if source["ai_tags"] else set()
        rows = conn.execute(
            "SELECT id, term, source, local_path, ai_tags FROM screenshots WHERE id != ? AND ai_tags IS NOT NULL",
            (screenshot_id,)
        ).fetchall()
        scored = []
        for r in rows:
            try:
                tags = set(json.loads(r["ai_tags"]).values())
                overlap = len(source_tags & tags)
                if overlap > 0:
                    scored.append((overlap, dict(r)))
            except:
                continue
        scored.sort(key=lambda x: x[0], reverse=True)
        return [s[1] for s in scored[:limit]]
```

**Step 2: Frontend — "More like this" button in lightbox**

Shows a row of similar image thumbnails below the current image. Clicking one navigates to it.

**Step 3: Commit**

```bash
git add app/api/screenshots.py frontend/src/features/images/ScreenshotLightbox.tsx
git commit -m "feat: 'More like this' recommendations via tag overlap"
```

---

## Phase 6: Feature Completions

### Task 27: Command Palette Wiring

**Files:**
- Modify: `frontend/src/components/CommandPalette.tsx` — wire to real actions

**Step 1: Define command registry**

```typescript
const COMMANDS = [
  { id: 'nav-media', label: 'Go to Media', category: 'Navigate', action: () => setActiveView('images') },
  { id: 'nav-items', label: 'Go to Items', category: 'Navigate', action: () => setActiveView('items') },
  { id: 'nav-hypotheses', label: 'Go to Hypotheses', category: 'Navigate', action: () => setActiveView('hypotheses') },
  { id: 'nav-graph', label: 'Go to Graph', category: 'Navigate', action: () => setActiveView('graph') },
  { id: 'nav-settings', label: 'Go to Settings', category: 'Navigate', action: () => setActiveView('settings') },
  { id: 'run-crawl', label: 'Run Crawl', category: 'Actions', action: () => triggerCrawl() },
  { id: 'run-capture', label: 'Run Media Capture', category: 'Actions', action: () => triggerCapture() },
  { id: 'toggle-batch', label: 'Toggle Batch Mode', category: 'Media', action: () => toggleBatch() },
];
```

**Step 2: Fuzzy search + keyboard navigation**

Filter commands by query with simple substring match. Up/down arrows navigate, Enter executes.

**Step 3: Recent commands section**

Store last 5 executed commands in localStorage. Show at top of palette when empty query.

**Step 4: Commit**

```bash
git add frontend/src/components/CommandPalette.tsx
git commit -m "feat: wire command palette to navigation, actions, and recent commands"
```

### Task 28: Dynamic Theme List

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx` — fetch themes from API
- Modify: `frontend/src/features/settings/SettingsPage.tsx` — remove hardcoded list

**Step 1: Replace hardcoded theme array**

Instead of `['libido', 'pssd', 'erections', ...]`, fetch from the dashboard endpoint:
```typescript
const { data: dashboard } = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard });
const themes = dashboard?.themes || [];
```

**Step 2: Commit**

```bash
git add frontend/src/features/images/MediaPage.tsx frontend/src/features/settings/SettingsPage.tsx
git commit -m "feat: dynamic theme list from API, remove hardcoded themes"
```

### Task 29: Code Splitting

**Files:**
- Modify: `frontend/src/App.tsx` — lazy load heavy views

**Step 1: Lazy load GraphPage and OverviewPage**

```typescript
import { lazy, Suspense } from 'react';
import { Skeleton } from '../components/Skeleton';

const OverviewPage = lazy(() => import('./features/overview/OverviewPage'));
const GraphPage = lazy(() => import('./features/graphs/GraphPage'));

// In VIEW_MAP, wrap with Suspense:
const VIEW_MAP: Record<ActiveView, React.ReactNode> = {
  overview: <Suspense fallback={<Skeleton className="h-96" />}><OverviewPage /></Suspense>,
  graph: <Suspense fallback={<Skeleton className="h-96" />}><GraphPage /></Suspense>,
  // ... rest unchanged
};
```

**Step 2: Add default exports to lazy-loaded pages**

Ensure `OverviewPage` and `GraphPage` have `export default` in addition to named exports.

**Step 3: Commit**

```bash
git add frontend/src/App.tsx frontend/src/features/overview/OverviewPage.tsx frontend/src/features/graphs/GraphPage.tsx
git commit -m "feat: code splitting for GraphPage and OverviewPage (~400KB savings)"
```

### Task 30: Settings Sync Frontend

**Files:**
- Modify: `frontend/src/features/settings/SettingsPage.tsx` — sync to backend
- Modify: `frontend/src/lib/api.ts` — settings API calls

**Step 1: Add settings API calls**

```typescript
export async function fetchSettings(): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/api/settings`);
  return res.json();
}
export async function updateSettings(settings: Record<string, unknown>): Promise<void> {
  await fetch(`${BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}
```

**Step 2: Load from backend on mount, write on change**

Use `useQuery` to fetch settings on mount. Merge with localStorage (localStorage wins for instant restore, backend is source of truth for cross-device sync). On any setting change, write to both localStorage and backend.

**Step 3: Commit**

```bash
git add frontend/src/features/settings/SettingsPage.tsx frontend/src/lib/api.ts
git commit -m "feat: settings sync to backend with localStorage fast cache"
```

---

## Phase 7: Mobile Polish

### Task 31: Mobile Media Grid

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx` — responsive columns

**Step 1: Responsive grid classes**

```tsx
<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3">
```

Remove hover-dependent interactions on touch devices. Add long-press context menu for mobile (replaces right-click).

**Step 2: Commit**

```bash
git add frontend/src/features/images/MediaPage.tsx
git commit -m "feat: responsive mobile media grid with long-press context menu"
```

### Task 32: Pull-to-Refresh

**Files:**
- Create: `frontend/src/hooks/usePullToRefresh.ts`
- Modify: `frontend/src/features/images/MediaPage.tsx` — use hook

**Step 1: Create pull-to-refresh hook**

```typescript
export function usePullToRefresh(onRefresh: () => Promise<void>) {
  // Track touch start/move/end on the main scrollable container
  // When at scrollTop === 0 and user pulls down > 60px, trigger refresh
  // Show rubber-band animation indicator
}
```

**Step 2: Wire to MediaPage**

```typescript
usePullToRefresh(async () => {
  await queryClient.invalidateQueries({ queryKey: ['screenshots'] });
});
```

**Step 3: Commit**

```bash
git add frontend/src/hooks/usePullToRefresh.ts frontend/src/features/images/MediaPage.tsx
git commit -m "feat: pull-to-refresh on media and items pages"
```

### Task 33: Mobile Chart Reflow

**Files:**
- Modify: `frontend/src/features/overview/OverviewPage.tsx` — single column on mobile

**Step 1: Responsive grid**

Charts stack to single column on mobile. Simplified axis labels. Add horizontal swipe carousel for chart cards.

**Step 2: Safe area insets**

Add `env(safe-area-inset-*)` padding to AppShell and BottomTabBar.

**Step 3: Commit**

```bash
git add frontend/src/features/overview/OverviewPage.tsx frontend/src/components/AppShell.tsx
git commit -m "feat: mobile chart reflow and safe area handling"
```

---

## Phase 8: Push Notifications & Offline

### Task 34: Push Notifications

**Files:**
- Modify: `frontend/public/sw.js` — handle push events
- Modify: `frontend/src/components/AppShell.tsx` — notification opt-in
- Modify: `app/api/screenshots.py` — send notification on capture complete

**Step 1: Add push event handler to service worker**

```javascript
self.addEventListener('push', (e) => {
  const data = e.data?.json() || { title: 'Codex', body: 'Task complete' };
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
  }));
});
```

**Step 2: Opt-in UI**

Add notification permission request button in settings. Store subscription in backend.

**Step 3: Commit**

```bash
git add frontend/public/sw.js frontend/src/components/AppShell.tsx app/api/screenshots.py
git commit -m "feat: push notifications for crawl and capture completion"
```

### Task 35: Offline Favorites

**Files:**
- Modify: `frontend/public/sw.js` — cache favorited media
- Modify: `frontend/src/features/images/MediaPage.tsx` — cache on favorite

**Step 1: When a user favorites an image/video, add its URL to a special cache**

```typescript
async function cacheFavorite(url: string) {
  if ('caches' in window) {
    const cache = await caches.open('codex-favorites');
    await cache.add(url);
  }
}
```

**Step 2: Service worker serves favorites from cache when offline**

**Step 3: Commit**

```bash
git add frontend/public/sw.js frontend/src/features/images/MediaPage.tsx
git commit -m "feat: offline access to favorited media via service worker cache"
```

---

## Build & Verify

### Task 36: Final Build & Test

**Step 1: Build frontend**

```bash
cd frontend && npm run build
```

Verify no TypeScript errors, bundle size improvement from code splitting.

**Step 2: Test all views**

Navigate to each view via hash URLs. Verify back/forward works. Test on mobile viewport. Test PWA install. Test offline mode.

**Step 3: Commit build**

```bash
cd .. && git add -A
git commit -m "feat: complete full redesign — PWA, glassmorphism, media-first UX, uncensored AI"
```
