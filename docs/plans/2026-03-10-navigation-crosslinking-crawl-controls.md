# Navigation Cross-Linking & Crawl Controls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every stat, chart, and hypothesis card navigable, add a Capture button to the sidebar, and expose visual_capture/ddg/redgifs in the FiltersBar.

**Architecture:** Pure frontend changes. All navigation uses existing `setActiveView` + `setFilter` Zustand actions. Capture status polling uses `api.screenshotStatus()` (already exists). One new store field (`screenshotRunning`) is added first and consumed by all downstream tasks.

**Tech Stack:** React 19, TypeScript, Zustand, TanStack Query, Recharts, Tailwind CSS v4

---

### Task 1: Add `screenshotRunning` to Zustand store

**Files:**
- Modify: `frontend/src/store.ts`

**Context:**
The store already has `crawlRunning: boolean` and `setCrawlRunning`. We need the same pair for screenshot/capture state. The sidebar `CrawlFooter` will poll and set this; `screenshotRunning` defaults to `false`.

**Step 1: Add the field + action to the interface**

In `frontend/src/store.ts`, find the `AppState` interface. After the `crawlRunning` / `setCrawlRunning` lines, add:

```ts
  screenshotRunning: boolean
  setScreenshotRunning: (running: boolean) => void
```

**Step 2: Add the implementation to the store**

In the `create<AppState>((set) => ({...}))` body, after `setCrawlRunning: (crawlRunning) => set({ crawlRunning }),` add:

```ts
  screenshotRunning: false,
  setScreenshotRunning: (screenshotRunning) => set({ screenshotRunning }),
```

**Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors (or only pre-existing ones unrelated to store.ts).

**Step 4: Commit**

```bash
git add frontend/src/store.ts
git commit -m "feat: add screenshotRunning state to store"
```

---

### Task 2: Add Capture button to sidebar `CrawlFooter`

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`

**Context:**
`CrawlFooter` already renders a "Run Now" crawl button and polls for `crawlRunning`. We need to:
1. Poll `/api/screenshots/status` every 3 s and sync to `screenshotRunning` in the store.
2. Add a "Capture" button that calls `api.triggerCapture()`.
3. Both expanded and collapsed layouts need updating.

**Step 1: Add imports at top of `Sidebar.tsx`**

The file already imports `useAppStore`, `useQuery`, `api`, `cn`. Add `useEffect` to the React import:

```ts
import { useEffect, type ReactNode } from "react"
```

**Step 2: Replace the entire `CrawlFooter` function with this implementation**

```tsx
function CrawlFooter({ collapsed }: { collapsed: boolean }) {
  const crawlRunning = useAppStore((s) => s.crawlRunning)
  const screenshotRunning = useAppStore((s) => s.screenshotRunning)
  const setScreenshotRunning = useAppStore((s) => s.setScreenshotRunning)

  const { data: dashboard } = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  // Poll screenshot status
  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const s = await api.screenshotStatus()
        if (!cancelled) setScreenshotRunning(s.running)
      } catch { /* ignore */ }
    }
    poll()
    const interval = setInterval(poll, screenshotRunning ? 1_000 : 3_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [screenshotRunning, setScreenshotRunning])

  const lastRun = dashboard?.last_run
  const lastRunAgo = lastRun?.finished_at
    ? (() => {
        const diff = Date.now() - new Date(lastRun.finished_at).getTime()
        const mins = Math.floor(diff / 60000)
        if (mins < 60) return `${mins}m ago`
        return `${Math.floor(mins / 60)}h ago`
      })()
    : null

  async function handleRun() {
    if (crawlRunning) return
    await api.triggerCrawl()
  }

  async function handleCapture() {
    if (screenshotRunning) return
    setScreenshotRunning(true)
    try {
      await api.triggerCapture()
    } catch {
      setScreenshotRunning(false)
    }
  }

  if (collapsed) {
    return (
      <div className="px-1 py-3 border-t border-border flex flex-col items-center gap-2">
        <button
          onClick={handleRun}
          disabled={crawlRunning}
          title="Run Crawl"
          className={cn(
            "w-8 h-8 rounded-md flex items-center justify-center",
            "text-text-muted hover:text-accent hover:bg-bg-elevated transition-colors",
            crawlRunning && "opacity-50 cursor-not-allowed"
          )}
        >
          {/* Play icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <button
          onClick={handleCapture}
          disabled={screenshotRunning}
          title="Run Capture"
          className={cn(
            "w-8 h-8 rounded-md flex items-center justify-center",
            "text-text-muted hover:text-accent hover:bg-bg-elevated transition-colors",
            screenshotRunning && "opacity-50 cursor-not-allowed"
          )}
        >
          {/* Camera icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 border-t border-border space-y-2">
      {/* Status row */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", crawlRunning ? "bg-amber-400 animate-pulse" : "bg-text-muted")} />
          <span className="text-[11px] text-text-muted font-mono">
            {crawlRunning ? "Crawling…" : lastRunAgo ? lastRunAgo : "Never"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", screenshotRunning ? "bg-amber-400 animate-pulse" : "bg-text-muted")} />
          <span className="text-[11px] text-text-muted font-mono">
            {screenshotRunning ? "Capturing…" : "Capture idle"}
          </span>
        </div>
      </div>
      {/* Buttons row */}
      <div className="flex gap-2">
        <button
          onClick={handleRun}
          disabled={crawlRunning}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md",
            "text-[11px] font-medium border border-border text-text-secondary",
            "hover:border-accent/40 hover:text-accent transition-colors",
            crawlRunning && "opacity-50 cursor-not-allowed"
          )}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          {crawlRunning ? "Running…" : "Crawl"}
        </button>
        <button
          onClick={handleCapture}
          disabled={screenshotRunning}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md",
            "text-[11px] font-medium border border-border text-text-secondary",
            "hover:border-accent/40 hover:text-accent transition-colors",
            screenshotRunning && "opacity-50 cursor-not-allowed"
          )}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          {screenshotRunning ? "Capturing…" : "Capture"}
        </button>
      </div>
    </div>
  )
}
```

**Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no new errors.

**Step 4: Commit**

```bash
git add frontend/src/components/Sidebar.tsx
git commit -m "feat: add Capture button and screenshot status polling to sidebar"
```

---

### Task 3: Make StatsBar cards clickable

**Files:**
- Modify: `frontend/src/features/analytics/StatsBar.tsx`

**Context:**
Currently each stat card is a plain `<div>`. We need to wrap them in `<button>` elements that call `setActiveView` and optionally `setFilter`. The "Last run" card stays non-clickable (no meaningful drill-down). Cards gain subtle hover styling with a `→` indicator.

**Step 1: Replace the entire `StatsBar` component with this implementation**

```tsx
import { useDashboard } from '@/hooks/useDashboard'
import { useAppStore } from '@/store'
import { cn } from '@/lib/cn'

export function StatsBar() {
  const { data } = useDashboard()
  const t = data?.stats.totals
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setFilter = useAppStore((s) => s.setFilter)
  const resetFilters = useAppStore((s) => s.resetFilters)

  function goItems(overrides?: Partial<Parameters<typeof setFilter>[1] extends infer V ? Record<string, V> : never>) {
    resetFilters()
    if (overrides) {
      Object.entries(overrides).forEach(([k, v]) => setFilter(k as any, v as any))
    }
    setActiveView('items')
  }

  const stats: { label: string; value: string | number; onClick?: () => void }[] = [
    { label: 'Total items', value: t?.item_count ?? '—', onClick: () => goItems() },
    { label: 'Saved', value: t?.saved_item_count ?? '—', onClick: () => goItems({ savedOnly: true }) },
    { label: 'Hypotheses', value: t?.hypothesis_count ?? '—', onClick: () => setActiveView('hypotheses') },
    { label: 'Images', value: t?.image_count ?? '—', onClick: () => setActiveView('images') },
    { label: 'Last run', value: data?.last_run?.started_at?.slice(0, 10) ?? '—' },
  ]

  return (
    <div className="grid grid-cols-5 gap-3 mb-6">
      {stats.map(({ label, value, onClick }) => {
        const inner = (
          <>
            <p className="text-xs text-text-muted uppercase tracking-widest font-mono mb-1">{label}</p>
            <div className="flex items-baseline justify-between">
              <p className="text-2xl font-semibold text-text-primary font-mono">{value}</p>
              {onClick && <span className="text-text-muted text-xs opacity-0 group-hover:opacity-100 transition-opacity">→</span>}
            </div>
          </>
        )
        if (!onClick) {
          return (
            <div key={label} className="bg-bg-surface border border-border rounded-xl p-4">
              {inner}
            </div>
          )
        }
        return (
          <button
            key={label}
            onClick={onClick}
            className={cn(
              "group bg-bg-surface border border-border rounded-xl p-4 text-left",
              "hover:border-accent/40 hover:bg-bg-elevated transition-colors cursor-pointer"
            )}
          >
            {inner}
          </button>
        )
      })}
    </div>
  )
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no new errors.

**Step 3: Commit**

```bash
git add frontend/src/features/analytics/StatsBar.tsx
git commit -m "feat: make StatsBar cards clickable with view navigation"
```

---

### Task 4: Overview — themes quick-nav row + clickable donut slices

**Files:**
- Modify: `frontend/src/features/overview/OverviewPage.tsx`

**Context:**
Add a horizontal scrollable pill row below `<StatsBar />` showing all 8 themes from `dashboard.themes`. Each pill navigates to Items filtered by that theme. Also wire `onClick` on the `<Pie>` component to navigate to Items filtered by the clicked source_type. The `ThemeTrendChart` uses an AreaChart which doesn't support slice clicks natively, so theme navigation from the trend chart is handled via the new pills row instead.

**Step 1: Add store imports to OverviewPage.tsx**

At the top of the file, add:

```tsx
import { useAppStore } from '@/store'
```

**Step 2: Add a `ThemePills` component above `SourceDonut`**

Insert this new component (before the `SourceDonut` function):

```tsx
function ThemePills() {
  const { data: dashboard } = useDashboard()
  const setActiveView = useAppStore((s) => s.setActiveView)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)
  const themes = dashboard?.themes ?? []
  if (!themes.length) return null

  function goTheme(slug: string) {
    resetFilters()
    setFilter('theme', slug)
    setActiveView('items')
  }

  return (
    <div className="flex gap-2 flex-wrap">
      {themes.map((t: { slug: string; label: string }) => (
        <button
          key={t.slug}
          onClick={() => goTheme(t.slug)}
          className="px-3 py-1.5 rounded-full text-xs font-medium bg-bg-surface border border-border text-text-secondary hover:border-accent/40 hover:text-accent transition-colors"
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
```

**Step 3: Update `SourceDonut` to accept and use a click handler**

Replace the `SourceDonut` function signature and add `onClick` to `<Pie>`:

```tsx
function SourceDonut({
  sourceMix,
  onSliceClick,
}: {
  sourceMix: { source_type: string; count: number }[]
  onSliceClick: (sourceType: string) => void
}) {
  if (!sourceMix?.length) return null
  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5">
      <p className="text-sm font-medium text-text-primary mb-4">Items by Source</p>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={sourceMix}
            dataKey="count"
            nameKey="source_type"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={80}
            paddingAngle={2}
            onClick={(entry: { source_type?: string }) => {
              if (entry.source_type) onSliceClick(entry.source_type)
            }}
            className="cursor-pointer"
          >
            {sourceMix.map((entry, i) => (
              <Cell key={entry.source_type} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: "#0f1520", border: "1px solid #1e2d42", borderRadius: 8, fontSize: 12 }}
            formatter={(v: number, name: string) => [v, name]}
          />
          <Legend
            formatter={(v) => <span style={{ color: "#8da4c0", fontSize: 11 }}>{v}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
```

**Step 4: Update `OverviewPage` to wire navigation and pass `onSliceClick`**

Replace the `OverviewPage` function body:

```tsx
export function OverviewPage() {
  const { data: dashboard } = useDashboard()
  const setActiveView = useAppStore((s) => s.setActiveView)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)

  function goSource(sourceType: string) {
    resetFilters()
    setFilter('sourceType', sourceType)
    setActiveView('items')
  }

  return (
    <div className="space-y-5">
      <StatsBar />
      <ThemePills />
      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2">
          <ThemeTrendChart />
        </div>
        <div className="space-y-5">
          <SourceDonut
            sourceMix={dashboard?.stats?.source_mix ?? []}
            onSliceClick={goSource}
          />
          <RecentRuns runs={(dashboard?.recent_runs ?? []) as { id: number; started_at: string; finished_at?: string; status: string; notes?: unknown }[]} />
        </div>
      </div>
    </div>
  )
}
```

**Step 5: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no new errors.

**Step 6: Commit**

```bash
git add frontend/src/features/overview/OverviewPage.tsx
git commit -m "feat: add theme pills nav row and clickable source donut on Overview"
```

---

### Task 5: FiltersBar — add visual_capture, ddg, redgifs sources

**Files:**
- Modify: `frontend/src/features/items/FiltersBar.tsx`

**Context:**
The `SOURCES` array is a plain string list rendered directly into `<option>` elements. We need to replace it with a label map so existing and new sources display cleanly.

**Step 1: Replace the `SOURCES` constant with a `SOURCE_LABELS` map**

Find and replace:

```ts
const SOURCES = ['pubmed', 'biorxiv', 'arxiv', 'reddit', 'x', 'lpsg', 'web']
```

With:

```ts
const SOURCE_LABELS: Record<string, string> = {
  pubmed: 'PubMed',
  biorxiv: 'bioRxiv',
  arxiv: 'arXiv',
  reddit: 'Reddit',
  x: 'X / Twitter',
  lpsg: 'LPSG',
  web: 'Web',
  visual_capture: 'Visual Capture',
  ddg: 'DDG Images',
  redgifs: 'Redgifs',
}
```

**Step 2: Update the `<select>` to use `SOURCE_LABELS`**

Find:

```tsx
          {SOURCES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
```

Replace with:

```tsx
          {Object.entries(SOURCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
```

**Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no new errors.

**Step 4: Commit**

```bash
git add frontend/src/features/items/FiltersBar.tsx
git commit -m "feat: add visual_capture, ddg, redgifs to FiltersBar source options"
```

---

### Task 6: HypothesisCard — "View source items" link

**Files:**
- Modify: `frontend/src/features/hypotheses/HypothesisCard.tsx`

**Context:**
Each hypothesis is generated from the highest-scoring research items. Add a "View source items →" text button that navigates to Items sorted by `score`. No backend change needed.

**Step 1: Add store import to HypothesisCard.tsx**

The file currently imports from `@/components` and `@/hooks/useHypotheses`. Add:

```tsx
import { useAppStore } from '@/store'
```

**Step 2: Add the store actions inside the component**

At the top of the `HypothesisCard` function body, after `const update = useUpdateHypothesis()`, add:

```tsx
  const setActiveView = useAppStore((s) => s.setActiveView)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)

  function viewSourceItems() {
    resetFilters()
    setFilter('sort', 'score')
    setActiveView('items')
  }
```

**Step 3: Add the link to the Actions row**

In the `{/* Actions */}` section, add `viewSourceItems` button after the existing "Note" button:

```tsx
        <Button size="sm" variant="ghost" onClick={viewSourceItems} className="ml-auto text-text-muted hover:text-accent">
          View source items →
        </Button>
```

**Step 4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no new errors.

**Step 5: Commit**

```bash
git add frontend/src/features/hypotheses/HypothesisCard.tsx
git commit -m "feat: add view source items link to HypothesisCard"
```

---

### Task 7: Rebuild frontend and smoke-test all flows

**Files:** None (build only)

**Step 1: Run production build**

```bash
cd frontend && npm run build 2>&1 | tail -10
```
Expected: `✓ built in X.XXs` with 0 errors. Bundle output goes to `app/static/dist/`.

**Step 2: Smoke-test in browser — Sidebar Capture button**

Open `http://localhost:5173`. Confirm:
- Sidebar footer shows both "Crawl" and "Capture" buttons
- Collapsed sidebar shows two icon buttons stacked
- Clicking "Capture" shows "Capturing…" while running

**Step 3: Smoke-test — StatsBar navigation**

Click each stat card. Confirm:
- "Total items" → navigates to Items view
- "Saved" → Items with saved filter active
- "Hypotheses" → Hypotheses view
- "Images" → Images view
- "Last run" card — no pointer cursor, no navigation

**Step 4: Smoke-test — Overview cross-linking**

- Click a theme pill → Items filtered by that theme, FiltersBar shows the theme selected
- Click a donut slice → Items filtered by that source

**Step 5: Smoke-test — FiltersBar sources**

Open Items view → Source dropdown → confirm "Visual Capture", "DDG Images", "Redgifs" appear in list.

**Step 6: Smoke-test — Hypothesis link**

Open Hypotheses view → any card → click "View source items →" → Items view sorted by score.

**Step 7: Commit build artifacts**

```bash
git add app/static/dist/
git commit -m "build: rebuild frontend with navigation cross-linking and crawl controls"
```
