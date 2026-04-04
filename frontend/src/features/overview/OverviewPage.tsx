import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { useQuery } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { ActivityHeatmap } from '@/features/overview/ActivityHeatmap'
import { useDashboard } from '@/hooks/useDashboard'
import { cn } from '@/lib/cn'
import { useAppStore } from '@/store'
import { TagChip } from '@/components/TagChip'
import { Skeleton, SkeletonStatBar, SkeletonChart } from '@/components/Skeleton'
import { Recommendations } from '@/features/overview/Recommendations'
import { api, type ActivityEvent } from '@/lib/api'

const StatsBar = lazy(() => import('@/features/analytics/StatsBar').then((m) => ({ default: m.StatsBar })))
const ThemeTrendChart = lazy(() => import('@/features/analytics/ThemeTrendChart').then((m) => ({ default: m.ThemeTrendChart })))
const InsightsSection = lazy(() => import('@/features/overview/InsightsSection').then((m) => ({ default: m.InsightsSection })))
const SourceDonut = lazy(() => import('@/features/overview/OverviewChartWidgets').then((m) => ({ default: m.SourceDonut })))
const TopCompoundsChart = lazy(() => import('@/features/overview/OverviewChartWidgets').then((m) => ({ default: m.TopCompoundsChart })))
const TopMechanismsChart = lazy(() => import('@/features/overview/OverviewChartWidgets').then((m) => ({ default: m.TopMechanismsChart })))
const ScoreHistogramChart = lazy(() => import('@/features/overview/OverviewChartWidgets').then((m) => ({ default: m.ScoreHistogramChart })))

function useRevealOnView<T extends HTMLElement>(rootMargin = "240px") {
  const ref = useRef<T | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (isVisible || !ref.current) return
    const node = ref.current

    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setIsVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [isVisible, rootMargin])

  return { ref, isVisible }
}

function DeferredSection({
  children,
  fallback,
  className,
}: {
  children: React.ReactNode
  fallback: React.ReactNode
  className?: string
}) {
  const { ref, isVisible } = useRevealOnView<HTMLDivElement>()

  return (
    <div ref={ref} className={className}>
      {isVisible ? children : fallback}
    </div>
  )
}

// ─── Section header ────────────────────────────────────────────────────────────
function SectionHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-text-muted font-mono">{children}</h2>
      {action}
    </div>
  )
}

// ─── ThemePills ───────────────────────────────────────────────────────────────
function ThemePills() {
  const { data: dashboard } = useDashboard()
  const setActiveView = useAppStore((s) => s.setActiveView)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)
  const themes = (dashboard?.themes ?? []) as { slug: string; label: string }[]

  const themeCounts: Record<string, number> = {}
  const themeSummaries = dashboard?.stats.theme_summaries ?? []
  const themeStats = dashboard?.stats.themes ?? []

  if (themeSummaries.length > 0) {
    for (const ts of themeSummaries) {
      themeCounts[ts.theme] = ts.count
    }
  } else {
    for (const ts of themeStats) {
      themeCounts[ts.theme] = ts.count
    }
  }

  if (!themes.length) return null

  function goTheme(slug: string) {
    resetFilters()
    setFilter('theme', slug)
    setActiveView('items')
  }

  return (
    <div className="flex gap-2 flex-wrap">
      {themes.map((t) => {
        const count = themeCounts[t.slug]
        return (
          <button
            key={t.slug}
            onClick={() => goTheme(t.slug)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-bg-surface border border-border text-text-secondary hover:border-accent/50 hover:text-accent hover:bg-accent/5 transition-all"
          >
            {t.label}
            {count !== undefined && count > 0 && (
              <span className="inline-flex items-center justify-center bg-accent/15 text-accent font-mono font-bold text-[10px] rounded-full px-1.5 min-w-[18px] h-[18px] leading-none">
                {count >= 1000 ? `${Math.floor(count / 1000)}k` : count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function OverviewHero() {
  const { data: dashboard } = useDashboard()
  const setActiveView = useAppStore((s) => s.setActiveView)
  const resetFilters = useAppStore((s) => s.resetFilters)

  const latestRun = dashboard?.recent_runs?.[0]
  const liveStatus = dashboard?.is_running ? "Live capture running" : "Idle and ready"
  const itemCount = dashboard?.stats?.totals?.item_count ?? 0
  const mediaCount = dashboard?.stats?.totals?.image_count ?? 0
  const topicCount = dashboard?.themes?.length ?? 0

  function go(view: "items" | "images" | "performers" | "hypotheses") {
    resetFilters()
    setActiveView(view)
  }

  return (
    <div className="hero-surface overflow-hidden rounded-[28px] px-6 py-6 sm:px-7 sm:py-7">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.24em] text-slate-300">
            Research radar
            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 lowercase tracking-normal text-slate-300">
              {liveStatus}
            </span>
          </div>
          <div className="space-y-2">
            <h1 className="hero-title text-3xl font-semibold text-white sm:text-[2.45rem]">
              See what’s changing, what’s working, and where to go next
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-300">
              Start from the latest run, jump into media or creators, and use the overview as a fast command center instead of a static dashboard.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => go("items")} className="ui-chip ui-chip-active">
              Open items
            </button>
            <button onClick={() => go("images")} className="ui-chip">
              Review media
            </button>
            <button onClick={() => go("performers")} className="ui-chip">
              Manage creators
            </button>
            <button onClick={() => go("hypotheses")} className="ui-chip">
              Explore ideas
            </button>
          </div>
        </div>

        <div className="grid min-w-[280px] grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <p className="text-[11px] text-slate-400">Items tracked</p>
            <p className="mt-1 text-2xl font-semibold text-white">{itemCount.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <p className="text-[11px] text-slate-400">Media assets</p>
            <p className="mt-1 text-2xl font-semibold text-white">{mediaCount.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <p className="text-[11px] text-slate-400">Themes</p>
            <p className="mt-1 text-2xl font-semibold text-white">{topicCount.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <p className="text-[11px] text-slate-400">Latest run</p>
            <p className="mt-1 truncate text-sm font-medium text-sky-200">
              {latestRun ? new Date(latestRun.started_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No runs yet"}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── TopTagsPanel ─────────────────────────────────────────────────────────────
function TopTagsPanel() {
  const { data: dashboard } = useDashboard()
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const compounds = dashboard?.stats.top_compounds ?? []
  const mechanisms = dashboard?.stats.top_mechanisms ?? []
  if (compounds.length === 0 && mechanisms.length === 0) return null

  function goTag(type: 'compound' | 'mechanism', value: string) {
    resetFilters()
    setFilter(type, value)
    setActiveView('items')
  }

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4 card-glass glass">
      <SectionHeading>Top Signals</SectionHeading>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {compounds.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-teal/70 font-mono mb-2">Compounds</p>
            <div className="flex flex-wrap gap-1.5">
              {compounds.slice(0, 10).map(({ name, count }) => (
                <TagChip
                  key={name}
                  label={name}
                  variant="compound"
                  showCount={count}
                  size="md"
                  onClick={(e) => { e.stopPropagation(); goTag('compound', name) }}
                />
              ))}
            </div>
          </div>
        )}
        {mechanisms.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-purple/70 font-mono mb-2">Mechanisms</p>
            <div className="flex flex-wrap gap-1.5">
              {mechanisms.slice(0, 10).map(({ name, count }) => (
                <TagChip
                  key={name}
                  label={name}
                  variant="mechanism"
                  showCount={count}
                  size="md"
                  onClick={(e) => { e.stopPropagation(); goTag('mechanism', name) }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function OverviewSectionIntro() {
  const { data: dashboard } = useDashboard()
  const setActiveView = useAppStore((s) => s.setActiveView)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const latestRun = dashboard?.recent_runs?.[0]
  const totals = dashboard?.stats?.totals
  const runLabel = dashboard?.is_running ? "Capture is live" : "Idle and ready"
  const lastRunLabel = latestRun?.started_at
    ? `Last run ${timeAgo(latestRun.started_at)}`
    : "No previous runs"

  function openView(view: "items" | "images" | "performers") {
    resetFilters()
    setActiveView(view)
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 card-glass glass">
        <p className="text-[11px] uppercase tracking-[0.22em] text-text-muted font-mono">Overview at a glance</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="ui-chip ui-chip-active">{runLabel}</span>
          <span className="ui-chip">{lastRunLabel}</span>
          <span className="ui-chip">{totals?.item_count?.toLocaleString() ?? "0"} items</span>
          <span className="ui-chip">{totals?.image_count?.toLocaleString() ?? "0"} media</span>
          <span className="ui-chip">{totals?.hypothesis_count?.toLocaleString() ?? "0"} ideas</span>
        </div>
      </div>
      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 card-glass glass">
        <p className="text-[11px] uppercase tracking-[0.22em] text-text-muted font-mono">Fast actions</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="ui-chip ui-chip-active" onClick={() => openView("items")}>
            Open items
          </button>
          <button className="ui-chip" onClick={() => openView("images")}>
            Review media
          </button>
          <button className="ui-chip" onClick={() => openView("performers")}>
            Explore creators
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── RecentRuns ───────────────────────────────────────────────────────────────
function RecentRuns({ runs }: { runs: { id: number; started_at: string; finished_at?: string; status: string; notes?: unknown }[] }) {
  if (!runs?.length) return null
  return (
    <div>
      <SectionHeading>Recent Runs</SectionHeading>
      <div className="bg-bg-surface border border-border rounded-xl divide-y divide-border card-glass glass">
        {runs.slice(0, 5).map((run) => {
          const duration = run.finished_at
            ? Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)
            : null
          const notes = run.notes as { collected?: { new_items?: number } } | undefined
          const itemsAdded = notes?.collected?.new_items ?? 0
          return (
            <div key={run.id} className="flex items-center gap-3 px-3 py-2.5 text-xs">
              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", run.status === "completed" ? "bg-green" : "bg-red")} />
              <span className="text-text-muted font-mono flex-1 truncate">{run.started_at.slice(0, 16).replace("T", " ")}</span>
              <span className="text-text-secondary font-medium">{itemsAdded > 0 ? `+${itemsAdded}` : '0'}</span>
              {duration != null && <span className="text-text-muted tabular-nums">{duration}s</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const SOURCE_BADGE: Record<string, string> = {
  reddit:    'bg-orange-500/15 text-orange-400',
  twitter:   'bg-sky-500/15 text-sky-400',
  x:         'bg-sky-500/15 text-sky-400',
  pubmed:    'bg-blue-500/15 text-blue-400',
  biorxiv:   'bg-green-500/15 text-green-400',
  arxiv:     'bg-teal-500/15 text-teal-400',
  literature:'bg-purple-500/15 text-purple-400',
  duckduckgo:'bg-amber-500/15 text-amber-400',
  lpsg:      'bg-rose-500/15 text-rose-400',
}

function sourceBadgeClass(sourceType: string): string {
  return SOURCE_BADGE[sourceType?.toLowerCase()] ?? 'bg-bg-subtle text-text-muted'
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

// ─── ActivityFeed ─────────────────────────────────────────────────────────────
function ActivityFeed() {
  const setActiveView = useAppStore((s) => s.setActiveView)
  const { data: dashboard } = useDashboard()
  const isRunning = dashboard?.is_running ?? false
  const { data: events, isLoading } = useQuery<ActivityEvent[]>({
    queryKey: ['activity'],
    queryFn: () => api.activity(),
    staleTime: isRunning ? 10_000 : 60_000,
    refetchInterval: isRunning ? 15_000 : false,
  })

  const displayed = (events ?? []).slice(0, 20)

  function handleClick(e: ActivityEvent) {
    if (e.event_type === 'hypothesis') {
      setActiveView('hypotheses')
    } else if (e.event_type === 'screenshot') {
      setActiveView('images')
    } else {
      setActiveView('items')
    }
  }

  return (
    <div>
      <SectionHeading
        action={
          isRunning && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-green bg-green/10 border border-green/30 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
              Live
            </span>
          )
        }
      >
        Activity
      </SectionHeading>
      <div className="bg-bg-surface border border-border rounded-xl overflow-hidden card-glass glass">
        {isLoading ? (
          <div className="p-3 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-2 animate-pulse">
                <div className="w-5 h-5 rounded-full shimmer shrink-0" />
                <div className="flex-1 h-3 shimmer rounded" />
                <div className="w-10 h-3 shimmer rounded" />
              </div>
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <p className="px-4 py-6 text-xs text-text-muted font-mono text-center">No activity yet.</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto divide-y divide-border/50">
            {displayed.map((e, i) => {
              const label = e.title ?? e.term ?? '(untitled)'
              const truncated = label.length > 52 ? label.slice(0, 52) + '…' : label
              const typeLabel =
                e.event_type === 'item' ? (e.source_type ?? 'item')
                : e.event_type === 'hypothesis' ? 'idea'
                : 'media'
              const badgeClass =
                e.event_type === 'item' ? sourceBadgeClass(e.source_type ?? '')
                : e.event_type === 'hypothesis' ? 'bg-purple-500/15 text-purple-400'
                : 'bg-teal-500/15 text-teal-400'

              return (
                <li key={`${e.event_type}-${e.id}-${i}`}>
                  <button
                    onClick={() => handleClick(e)}
                    className="w-full flex items-center gap-2.5 text-left group hover:bg-bg-elevated px-3 py-2 transition-colors"
                  >
                    <span
                      className={cn(
                        'text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase shrink-0 min-w-[44px] text-center',
                        badgeClass,
                      )}
                    >
                      {typeLabel}
                    </span>
                    <span className="flex-1 text-xs text-text-secondary leading-snug group-hover:text-text-primary transition-colors truncate">
                      {truncated}
                    </span>
                    {e.created_at && (
                      <span className="text-[10px] font-mono text-text-muted whitespace-nowrap shrink-0">
                        {timeAgo(e.created_at)}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// ─── RecentActivityStrip ──────────────────────────────────────────────────────
function RecentActivityStrip() {
  const { data: dashboard } = useDashboard()
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId)
  const items = (dashboard?.items ?? []).slice(0, 8)

  if (items.length === 0) return null

  return (
    <div>
      <SectionHeading
        action={
          <button
            onClick={() => setActiveView('items')}
            className="text-[11px] text-text-muted hover:text-accent transition-colors"
          >
            View all →
          </button>
        }
      >
        Latest Items
      </SectionHeading>
      <div className="flex gap-2.5 overflow-x-auto pb-1.5 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-border">
        {items.map((item) => {
          const title = item.title.length > 55 ? item.title.slice(0, 55).trimEnd() + '…' : item.title
          return (
            <button
              key={item.id}
              onClick={() => {
                setActiveView('items')
                setTimeout(() => setSelectedItemId(item.id), 50)
              }}
              className="flex-shrink-0 w-52 bg-bg-surface border border-border rounded-xl p-3 text-left hover:border-accent/40 hover:bg-bg-elevated transition-all group card-glass glass"
            >
              <p className="text-xs text-text-primary font-medium leading-snug mb-2.5 line-clamp-2 group-hover:text-accent transition-colors">
                {title}
              </p>
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    'text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded uppercase',
                    sourceBadgeClass(item.source_type),
                  )}
                >
                  {item.source_type}
                </span>
                {item.score != null && (
                  <span className="text-[10px] font-mono text-text-muted tabular-nums">
                    {item.score.toFixed(2)}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── RecentTimeline ──────────────────────────────────────────────────────────
function RecentTimeline() {
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId)
  const { data: events, isLoading } = useQuery<ActivityEvent[]>({
    queryKey: ['activity'],
    queryFn: () => api.activity(),
    staleTime: 60_000,
  })

  const displayed = (events ?? []).slice(0, 10)

  if (isLoading) {
    return (
      <div className="bg-bg-surface border border-border rounded-xl p-3 card-glass glass space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2 animate-pulse">
            <div className="w-4 h-4 rounded shimmer shrink-0" />
            <div className="flex-1 h-3 shimmer rounded" />
            <div className="w-10 h-3 shimmer rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (displayed.length === 0) return null

  function handleClick(e: ActivityEvent) {
    if (e.event_type === 'item') {
      setActiveView('items')
      if (e.id) setTimeout(() => setSelectedItemId(e.id), 50)
    } else if (e.event_type === 'hypothesis') {
      setActiveView('hypotheses')
    } else {
      setActiveView('images')
    }
  }

  return (
    <div>
      <SectionHeading>Recent Activity</SectionHeading>
      <div className="bg-bg-surface border border-border rounded-xl overflow-hidden card-glass glass">
        <ul className="divide-y divide-border/50">
          {displayed.map((e, i) => {
            const label = e.title ?? e.term ?? '(untitled)'
            const truncated = label.length > 60 ? label.slice(0, 60) + '\u2026' : label
            const typeLabel =
              e.event_type === 'item' ? (e.source_type ?? 'item')
              : e.event_type === 'hypothesis' ? 'idea'
              : 'media'

            return (
              <li key={`${e.event_type}-${e.id}-${i}`}>
                <button
                  onClick={() => handleClick(e)}
                  className="w-full flex items-center gap-2 text-left hover:bg-bg-elevated px-3 py-1.5 transition-colors group"
                >
                  <span className={cn(
                    'text-[8px] font-mono font-bold px-1 py-0.5 rounded uppercase shrink-0 min-w-[36px] text-center',
                    e.event_type === 'item' ? sourceBadgeClass(e.source_type ?? '')
                    : e.event_type === 'hypothesis' ? 'bg-purple-500/15 text-purple-400'
                    : 'bg-teal-500/15 text-teal-400',
                  )}>
                    {typeLabel}
                  </span>
                  <span className="flex-1 text-[11px] text-text-secondary leading-tight truncate group-hover:text-text-primary transition-colors">
                    {truncated}
                  </span>
                  {e.created_at && (
                    <span className="text-[10px] font-mono text-text-muted whitespace-nowrap shrink-0">
                      {timeAgo(e.created_at)}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// ─── TopCompoundsMini ────────────────────────────────────────────────────────
function TopCompoundsMini() {
  const { data: dashboard } = useDashboard()
  const setActiveView = useAppStore((s) => s.setActiveView)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)

  const compounds = dashboard?.stats.top_compounds ?? []
  const top5 = compounds.slice(0, 5)

  if (top5.length === 0) return null

  const maxCount = top5[0]?.count ?? 1

  function goCompound(name: string) {
    resetFilters()
    setFilter('compound', name)
    setActiveView('items')
  }

  return (
    <div>
      <SectionHeading>Top Compounds</SectionHeading>
      <div className="bg-bg-surface border border-border rounded-xl p-3 card-glass glass space-y-1.5">
        {top5.map(({ name, count }) => (
          <button
            key={name}
            onClick={() => goCompound(name)}
            className="w-full flex items-center gap-2 group hover:bg-bg-elevated rounded-lg px-2 py-1 transition-colors"
          >
            <span className="flex-1 text-xs text-text-secondary group-hover:text-text-primary transition-colors text-left truncate">
              {name}
            </span>
            <div className="w-20 h-1.5 rounded-full bg-bg-subtle overflow-hidden shrink-0">
              <div
                className="h-full rounded-full bg-teal"
                style={{ width: `${Math.round((count / maxCount) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-text-muted tabular-nums w-6 text-right shrink-0">{count}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── TopRatedMediaStrip ───────────────────────────────────────────────────────
function TopRatedMediaStrip() {
  const setActiveView = useAppStore((s) => s.setActiveView)
  const { data, isLoading } = useQuery({
    queryKey: ['top-rated-screenshots'],
    queryFn: api.topRatedScreenshots,
    staleTime: 5 * 60_000,
  })

  const shots = (data ?? []).slice(0, 12)

  if (isLoading) {
    return (
      <div>
        <SectionHeading action={<span className="text-[10px] font-mono text-text-muted">top rated</span>}>
          Top Media
        </SectionHeading>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex-none w-24 h-24 rounded-lg bg-white/5 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (shots.length === 0) return null

  function isVideo(src: string) {
    return /\.(mp4|webm|mov)$/i.test(src)
  }

  return (
    <div>
      <SectionHeading
        action={
          <button
            onClick={() => setActiveView('images')}
            className="text-[11px] text-text-muted hover:text-accent transition-colors"
          >
            View all →
          </button>
        }
      >
        Top Media
      </SectionHeading>
      <div className="flex gap-2 overflow-x-auto pb-1.5 hide-scrollbar">
        {shots.map((shot) => {
          const src = shot.local_url ?? shot.page_url ?? ''
          const vid = isVideo(src)
          return (
            <button
              key={shot.id}
              onClick={() => setActiveView('images')}
              className="group relative flex-none w-24 h-24 rounded-lg overflow-hidden border border-white/10 hover:border-accent/50 transition-all hover:scale-[1.03]"
              title={`${shot.term} — ${'★'.repeat(shot.rating ?? 0)}`}
            >
              {vid ? (
                <video
                  src={src}
                  muted
                  playsInline
                  className="h-full w-full object-cover transition-[filter] duration-200 group-hover:brightness-110"
                  onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                  onMouseLeave={(e) => { const v = e.currentTarget; v.pause(); v.currentTime = 0 }}
                />
              ) : (
                <img
                  src={src}
                  alt={shot.term}
                  loading="lazy"
                  className="h-full w-full object-cover transition-[filter] duration-200 group-hover:brightness-110"
                />
              )}
              {/* Rating badge */}
              <div className="absolute bottom-1 left-1 text-[9px] text-yellow-400 drop-shadow">
                {'★'.repeat(shot.rating ?? 0)}
              </div>
              {vid && (
                <div className="absolute top-1 right-1 rounded bg-purple-500/80 px-1 py-0.5 text-[8px] font-bold text-white leading-none">
                  VID
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── TopCreatorsPanel ────────────────────────────────────────────────────────
function TopCreatorsPanel() {
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setMediaCreator = useAppStore((s) => s.setMediaCreator)

  const { data, isLoading } = useQuery({
    queryKey: ["performer-analytics"],
    queryFn: () => api.performerAnalytics(),
    staleTime: 5 * 60_000,
  })

  const top = (data?.top_by_media ?? []).slice(0, 8)

  function openCreatorShots(id: number, username: string) {
    setMediaCreator(id, username)
    setActiveView("images")
  }

  if (isLoading) {
    return (
      <div>
        <SectionHeading>Top Creators</SectionHeading>
        <div className="bg-bg-surface border border-border rounded-xl p-3 card-glass glass space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-1">
              <div className="w-6 h-6 rounded-full bg-white/5 animate-pulse shrink-0" />
              <div className="flex-1 h-3 rounded bg-white/5 animate-pulse" style={{ width: `${55 + i * 8}%` }} />
              <div className="w-8 h-3 rounded bg-white/5 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (top.length === 0) return null

  const maxMedia = top[0]?.media_count ?? 1
  const growth = data?.growth

  return (
    <div>
      <SectionHeading
        action={
          <button
            onClick={() => setActiveView("performers")}
            className="text-[10px] font-mono text-text-muted hover:text-accent transition-colors"
          >
            view all →
          </button>
        }
      >
        Top Creators
      </SectionHeading>
      <div className="bg-bg-surface border border-border rounded-xl p-3 card-glass glass space-y-1">
        {growth && (
          <div className="flex items-center gap-3 px-1 pb-1.5 mb-1 border-b border-white/5">
            <span className="text-[10px] text-text-muted">Total</span>
            <span className="text-xs font-bold text-text-primary font-mono">{growth.total}</span>
            {growth.this_week > 0 && (
              <span className="ml-auto text-[10px] text-green-400 font-mono">+{growth.this_week} this wk</span>
            )}
          </div>
        )}
        {top.map(({ id, username, media_count }) => (
          <button
            key={id}
            onClick={() => openCreatorShots(id, username)}
            className="w-full flex items-center gap-2 group hover:bg-bg-elevated rounded-lg px-1 py-1 transition-colors"
            title={`View shots from @${username}`}
          >
            <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[9px] font-bold"
              style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6" }}>
              {username.charAt(0).toUpperCase()}
            </div>
            <span className="flex-1 text-xs text-text-secondary group-hover:text-text-primary transition-colors text-left truncate">
              @{username}
            </span>
            <div className="w-14 h-1 rounded-full bg-bg-subtle overflow-hidden shrink-0">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.round((media_count / maxMedia) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-text-muted tabular-nums w-7 text-right shrink-0">{media_count}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── OverviewPage ─────────────────────────────────────────────────────────────
export function OverviewPage() {
  const { data: dashboard, isLoading, isError, error, refetch, isFetching } = useDashboard()
  const queryClient = useQueryClient()
  const setActiveView = useAppStore((s) => s.setActiveView)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)

  function goSource(sourceType: string) {
    resetFilters()
    setFilter('sourceType', sourceType)
    setActiveView('items')
  }

  function handleChartClick(value: string, chartView: 'theme' | 'source' | 'daily') {
    if (chartView === 'daily') return
    resetFilters()
    if (chartView === 'theme') {
      setFilter('theme', value)
    } else {
      setFilter('sourceType', value)
    }
    setActiveView('items')
  }

  if (isLoading) {
    return (
      <div className="space-y-5 p-2">
        <SkeletonStatBar count={5} />
        <Skeleton variant="card" className="h-16 w-full rounded-xl" />
        <SkeletonChart />
        <div className="grid grid-cols-3 gap-5">
          <Skeleton variant="card" className="col-span-2 h-48 rounded-xl" />
          <Skeleton variant="card" className="h-48 rounded-xl" />
        </div>
      </div>
    )
  }

  if (isError) {
    const message = error instanceof Error ? error.message : "Dashboard request failed"
    return (
      <div className="p-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-amber/30 bg-amber/10 p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber">Dashboard Unavailable</p>
          <h2 className="mt-2 text-xl font-semibold text-text-primary">The API is unreachable or returning an error.</h2>
          <p className="mt-2 text-sm text-text-secondary">Check that the backend is running and `VITE_BACKEND_URL` points to the right target.</p>
          <p className="mt-3 rounded-lg bg-black/20 px-3 py-2 font-mono text-xs text-amber/90">{message}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["dashboard"] })
                refetch()
              }}
              className="rounded-lg border border-amber/40 bg-amber/15 px-4 py-2 text-sm font-medium text-amber transition-colors hover:bg-amber/25"
            >
              {isFetching ? "Retrying…" : "Retry"}
            </button>
            <button
              onClick={() => { resetFilters(); setActiveView("items") }}
              className="rounded-lg border border-border bg-bg-surface px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary"
            >
              Open Items →
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <OverviewHero />
      <OverviewSectionIntro />

      {/* Stats row */}
      <Suspense fallback={<SkeletonStatBar count={5} />}>
        <StatsBar />
      </Suspense>

      {/* Theme quick-nav */}
      <ThemePills />

      {/* Research Insights */}
      <DeferredSection
        fallback={<Skeleton variant="card" className="h-60 w-full rounded-xl" />}
        className="min-h-[240px]"
      >
        <Suspense fallback={<Skeleton variant="card" className="h-60 w-full rounded-xl" />}>
          <InsightsSection />
        </Suspense>
      </DeferredSection>

      {/* Quick glance: timeline + top compounds */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4">
        <RecentTimeline />
        <TopCompoundsMini />
      </div>

      {/* Main content: 2/3 + 1/3 grid */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
        {/* Left column */}
        <div className="space-y-5 min-w-0">
          <DeferredSection fallback={<SkeletonChart />} className="min-h-[300px]">
            <Suspense fallback={<SkeletonChart />}>
              <ThemeTrendChart onBarClick={handleChartClick} />
            </Suspense>
          </DeferredSection>
          <DeferredSection fallback={<Skeleton variant="card" className="h-64 rounded-xl" />}>
            <ActivityHeatmap />
          </DeferredSection>
          <DeferredSection fallback={<Skeleton variant="card" className="h-40 rounded-xl" />}>
            <TopRatedMediaStrip />
          </DeferredSection>
          <DeferredSection fallback={<Skeleton variant="card" className="h-48 rounded-xl" />}>
            <RecentActivityStrip />
          </DeferredSection>
          <DeferredSection fallback={<Skeleton variant="card" className="h-44 rounded-xl" />}>
            <Recommendations />
          </DeferredSection>
          <DeferredSection fallback={<Skeleton variant="card" className="h-48 rounded-xl" />}>
            <TopTagsPanel />
          </DeferredSection>

          {/* Compounds + Mechanisms side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DeferredSection fallback={<Skeleton variant="card" className="h-48 rounded-xl" />}>
              <Suspense fallback={<Skeleton variant="card" className="h-48 rounded-xl" />}>
                <TopCompoundsChart />
              </Suspense>
            </DeferredSection>
            <DeferredSection fallback={<Skeleton variant="card" className="h-48 rounded-xl" />}>
              <Suspense fallback={<Skeleton variant="card" className="h-48 rounded-xl" />}>
                <TopMechanismsChart />
              </Suspense>
            </DeferredSection>
          </div>

          <DeferredSection fallback={<Skeleton variant="card" className="h-36 rounded-xl" />}>
            <Suspense fallback={<Skeleton variant="card" className="h-36 rounded-xl" />}>
              <ScoreHistogramChart />
            </Suspense>
          </DeferredSection>
        </div>

        {/* Right sidebar */}
        <div className="space-y-5 min-w-0">
          <DeferredSection fallback={<Skeleton variant="card" className="h-56 rounded-xl" />}>
            <Suspense fallback={<Skeleton variant="card" className="h-56 rounded-xl" />}>
              <SourceDonut
                sourceMix={dashboard?.stats?.source_mix ?? []}
                onSliceClick={goSource}
              />
            </Suspense>
          </DeferredSection>
          <DeferredSection fallback={<Skeleton variant="card" className="h-56 rounded-xl" />}>
            <TopCreatorsPanel />
          </DeferredSection>
          <DeferredSection fallback={<Skeleton variant="card" className="h-60 rounded-xl" />}>
            <ActivityFeed />
          </DeferredSection>
          <DeferredSection fallback={<Skeleton variant="card" className="h-40 rounded-xl" />}>
            <RecentRuns runs={(dashboard?.recent_runs ?? []) as { id: number; started_at: string; finished_at?: string; status: string; notes?: unknown }[]} />
          </DeferredSection>
        </div>
      </div>
    </div>
  )
}

export default OverviewPage
