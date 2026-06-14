import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, ResponsiveContainer } from 'recharts'
import { useDashboard } from '@/hooks/useDashboard'
import { useAppStore } from '@/store'
import { cn } from '@/lib/cn'
import { api, type TrendsPayload } from '@/lib/api'

// ─── useCountUp hook ─────────────────────────────────────────────────────────
function useCountUp(target: number, duration = 800): number {
  const [displayed, setDisplayed] = useState(0)
  const rafRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const startValRef = useRef(0)

  useEffect(() => {
    if (typeof target !== 'number' || isNaN(target)) return

    // Cancel any in-flight animation
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    startTimeRef.current = null
    startValRef.current = displayed

    function step(now: number) {
      if (startTimeRef.current === null) startTimeRef.current = now
      const elapsed = now - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const value = Math.round(startValRef.current + (target - startValRef.current) * eased)
      setDisplayed(value)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step)
      }
    }

    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration])

  return displayed
}

// ─── Trend snapshot helpers ───────────────────────────────────────────────────

interface StatSnapshot {
  item_count: number
  saved_item_count: number
  hypothesis_count: number
  image_count: number
}

function loadSnapshot(): StatSnapshot | null {
  return null
}

function saveSnapshot(_s: StatSnapshot) {
  // no-op: snapshots are session-only
}

type TrendDir = 'up' | 'down' | 'neutral'

function TrendBadge({ dir }: { dir: TrendDir }) {
  if (dir === 'up') {
    return (
      <span className="inline-flex items-center text-[10px] font-bold text-green-400 bg-green-400/10 rounded px-1 py-0.5 select-none">
        ↑
      </span>
    )
  }
  if (dir === 'down') {
    return (
      <span className="inline-flex items-center text-[10px] font-bold text-red-400 bg-red-400/10 rounded px-1 py-0.5 select-none">
        ↓
      </span>
    )
  }
  return (
    <span className="inline-flex items-center text-[10px] font-bold text-text-muted bg-bg-subtle rounded px-1 py-0.5 select-none">
      ·
    </span>
  )
}

function trend(current: number, previous: number | undefined): TrendDir {
  if (previous === undefined) return 'neutral'
  if (current > previous) return 'up'
  if (current < previous) return 'down'
  return 'neutral'
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function MiniSparkline({ data, color }: { data: { v: number }[]; color: string }) {
  if (!data.length) return null
  return (
    <div className="mt-2 -mx-1 -mb-1">
      <ResponsiveContainer width="100%" height={32}>
        <LineChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Animated stat card ───────────────────────────────────────────────────────
interface StatCardProps {
  label: string
  value: number | string
  trendDir?: TrendDir
  onClick?: () => void
  accent?: boolean
  sparkData?: { v: number }[]
  sparkColor?: string
}

function StatCard({ label, value, trendDir = 'neutral', onClick, accent, sparkData, sparkColor }: StatCardProps) {
  const isNumeric = typeof value === 'number'
  const animated = useCountUp(isNumeric ? value : 0, 800)
  const displayed = isNumeric ? animated : value
  const Comp = onClick ? 'button' : 'div'

  return (
    <Comp
      onClick={onClick}
      className={cn(
        'group bg-bg-surface border border-border rounded-xl p-4 text-left content-card-interactive',
        onClick && 'cursor-pointer hover:border-accent/40 hover:bg-bg-elevated transition-colors',
        accent && 'border-accent/20 bg-bg-elevated',
      )}
    >
      <p className="text-[11px] text-text-muted uppercase tracking-widest font-mono mb-2">{label}</p>
      <div className="flex items-baseline justify-between gap-2">
        <p className={cn(
          'text-3xl font-bold font-mono',
          accent ? 'gradient-text' : 'text-text-primary',
        )}>
          {displayed}
        </p>
        <div className="flex items-center gap-1.5">
          {isNumeric && <TrendBadge dir={trendDir} />}
          {onClick && (
            <span className="text-text-muted text-xs opacity-0 group-hover:opacity-100 transition-opacity">→</span>
          )}
        </div>
      </div>
      {sparkData && sparkData.length > 1 && (
        <MiniSparkline data={sparkData} color={sparkColor ?? '#3b82f6'} />
      )}
    </Comp>
  )
}

// ─── Build sparkline arrays from trends data ─────────────────────────────────
function buildSparklines(trends: TrendsPayload | undefined) {
  if (!trends?.dates?.length) return { total: [], items: [], hypotheses: [], images: [] }

  // Use last 7 days
  const len = trends.dates.length
  const start = Math.max(0, len - 7)

  // Sum all source series for total items per day
  const sourceKeys = Object.keys(trends.series)
  const totalPerDay: { v: number }[] = []
  for (let i = start; i < len; i++) {
    let sum = 0
    for (const k of sourceKeys) {
      sum += trends.series[k]?.[i] ?? 0
    }
    totalPerDay.push({ v: sum })
  }

  // Cumulative sum for "total items" sparkline
  const cumulativeTotal: { v: number }[] = []
  let running = 0
  for (const d of totalPerDay) {
    running += d.v
    cumulativeTotal.push({ v: running })
  }

  return { total: totalPerDay, cumulative: cumulativeTotal }
}

// ─── StatsBar ─────────────────────────────────────────────────────────────────
export function StatsBar() {
  const { data, isFetching } = useDashboard()
  const t = data?.stats.totals
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setFilter = useAppStore((s) => s.setFilter)
  const resetFilters = useAppStore((s) => s.resetFilters)

  // Reading queue count
  const { data: queueData } = useQuery<{ count: number }>({
    queryKey: ['queue-count'],
    queryFn: api.queueCount,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  const queueCount = queueData?.count ?? 0

  // Fetch 7-day trends for sparklines
  const { data: trends } = useQuery<TrendsPayload>({
    queryKey: ['statsTrends', 7],
    queryFn: () => api.statsTrends(7),
    staleTime: 120_000,
  })
  const sparks = buildSparklines(trends)

  // Load previous snapshot once on mount (stable ref)
  const prevRef = useRef<StatSnapshot | null>(loadSnapshot())

  // When fresh data arrives, update snapshot
  useEffect(() => {
    if (!t) return
    const current: StatSnapshot = {
      item_count: t.item_count,
      saved_item_count: t.saved_item_count,
      hypothesis_count: t.hypothesis_count,
      image_count: t.image_count,
    }
    // Save as next prev; but update prevRef only if snapshot was already saved
    // (avoid marking first-ever load as "trend up" from 0)
    const existing = prevRef.current
    if (existing !== null) {
      // already had a snapshot — save new snapshot for next comparison
      saveSnapshot(current)
    } else {
      // first time: save snapshot, keep prevRef null so all trends show neutral
      saveSnapshot(current)
      prevRef.current = null
    }
  }, [t])

  function goItems(extra?: { savedOnly?: boolean; queuedOnly?: boolean }) {
    resetFilters()
    if (extra?.savedOnly) setFilter('savedOnly', true)
    if (extra?.queuedOnly) setFilter('queuedOnly', true)
    setActiveView('images')
  }

  const prev = prevRef.current

  const stats: StatCardProps[] = [
    {
      label: 'Total Items',
      value: t?.item_count ?? 0,
      trendDir: t ? trend(t.item_count, prev?.item_count) : 'neutral',
      onClick: () => goItems(),
      accent: true,
      sparkData: sparks.total,
      sparkColor: '#3b82f6',
    },
    {
      label: 'Saved',
      value: t?.saved_item_count ?? 0,
      trendDir: t ? trend(t.saved_item_count, prev?.saved_item_count) : 'neutral',
      onClick: () => goItems({ savedOnly: true }),
    },
    {
      label: 'Hypotheses',
      value: t?.hypothesis_count ?? 0,
      trendDir: t ? trend(t.hypothesis_count, prev?.hypothesis_count) : 'neutral',
      onClick: () => setActiveView('images'),
    },
    {
      label: 'Images',
      value: t?.image_count ?? 0,
      trendDir: t ? trend(t.image_count, prev?.image_count) : 'neutral',
      onClick: () => setActiveView('images'),
    },
    {
      label: 'Queue',
      value: queueCount,
      trendDir: 'neutral',
      onClick: queueCount > 0 ? () => goItems({ queuedOnly: true }) : undefined,
      sparkColor: '#f59e0b',
    },
    {
      label: 'Last Run',
      value: data?.last_run?.started_at?.slice(0, 10) ?? '—',
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {stats.map((s) => (
        <StatCard key={s.label} {...s} />
      ))}
      {isFetching && (
        <span className="loading-dot w-1 h-1 rounded-full bg-accent inline-block" />
      )}
    </div>
  )
}
