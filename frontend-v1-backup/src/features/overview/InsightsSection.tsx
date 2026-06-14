import { useQuery } from '@tanstack/react-query'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { api, type InsightsPayload } from '@/lib/api'
import { useAppStore } from '@/store'

const SOURCE_COLORS: Record<string, string> = {
  reddit: '#f97316',
  twitter: '#0ea5e9',
  x: '#0ea5e9',
  pubmed: '#3b82f6',
  biorxiv: '#22c55e',
  arxiv: '#14b8a6',
  literature: '#a855f7',
  duckduckgo: '#f59e0b',
  lpsg: '#f43f5e',
}

const THEME_COLORS = ['#3b82f6', '#14b8a6', '#f59e0b', '#a855f7', '#22c55e', '#ef4444', '#6366f1', '#ec4899', '#0ea5e9', '#84cc16']

const CHART_TOOLTIP_STYLE = {
  background: '#0f1520',
  border: '1px solid #1e2d42',
  borderRadius: 8,
  fontSize: 12,
} as const

function sourceColor(source: string): string {
  return SOURCE_COLORS[source?.toLowerCase()] ?? '#6b7280'
}

// ─── SourceBreakdownBar ──────────────────────────────────────────────────────
function SourceBreakdownBar({
  data,
  onClick,
}: {
  data: InsightsPayload['source_breakdown']
  onClick: (source: string) => void
}) {
  if (!data?.length) return null
  const total = data.reduce((s, d) => s + d.count, 0) || 1

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4 card-hover glass">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted font-mono mb-3">
        Source Breakdown
      </h3>

      {/* Stacked bar */}
      <div className="flex h-5 rounded-full overflow-hidden mb-3">
        {data.map((d) => (
          <button
            key={d.source}
            onClick={() => onClick(d.source)}
            className="h-full transition-opacity hover:opacity-80"
            style={{
              width: `${(d.count / total) * 100}%`,
              backgroundColor: sourceColor(d.source),
              minWidth: d.count > 0 ? 4 : 0,
            }}
            title={`${d.source}: ${d.count} (${d.percentage}%)`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {data.map((d) => (
          <button
            key={d.source}
            onClick={() => onClick(d.source)}
            className="flex items-center gap-1.5 text-[11px] text-text-secondary hover:text-text-primary transition-colors"
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: sourceColor(d.source) }}
            />
            <span className="capitalize">{d.source}</span>
            <span className="text-text-muted font-mono">{d.percentage}%</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── ReviewFunnel ────────────────────────────────────────────────────────────
function ReviewFunnel({
  data,
  onClick,
}: {
  data: InsightsPayload['review_funnel']
  onClick: (status: string) => void
}) {
  const stages = [
    { key: 'total', label: 'Total', value: data.total, color: '#6b7280' },
    { key: 'new', label: 'New', value: data.new, color: '#3b82f6' },
    { key: 'reviewing', label: 'Reviewing', value: data.reviewing, color: '#f59e0b' },
    { key: 'shortlisted', label: 'Shortlisted', value: data.shortlisted, color: '#22c55e' },
    { key: 'archived', label: 'Archived', value: data.archived, color: '#ef4444' },
  ]

  const maxVal = data.total || 1

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4 card-hover glass">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted font-mono mb-3">
        Review Funnel
      </h3>
      <div className="space-y-1.5">
        {stages.map((stage, i) => {
          const widthPct = Math.max((stage.value / maxVal) * 100, 2)
          const dropOff =
            i > 0 && stages[i - 1].value > 0
              ? Math.round(((stages[i - 1].value - stage.value) / stages[i - 1].value) * 100)
              : null

          return (
            <button
              key={stage.key}
              onClick={() => {
                if (stage.key !== 'total') onClick(stage.key)
              }}
              className="w-full flex items-center gap-2 group hover:bg-bg-elevated rounded px-1 py-0.5 transition-colors"
            >
              <span className="text-[11px] text-text-secondary w-16 text-left shrink-0 group-hover:text-text-primary transition-colors">
                {stage.label}
              </span>
              <div className="flex-1 h-3 bg-bg-subtle rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${widthPct}%`, backgroundColor: stage.color }}
                />
              </div>
              <span className="text-[11px] font-mono text-text-muted w-8 text-right shrink-0 tabular-nums">
                {stage.value}
              </span>
              {dropOff !== null && dropOff > 0 && (
                <span className="text-[9px] font-mono text-text-muted/60 w-8 text-right shrink-0">
                  -{dropOff}%
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── GrowthIndicator ─────────────────────────────────────────────────────────
function GrowthIndicator({ data }: { data: InsightsPayload['growth'] }) {
  const isUp = data.growth_rate >= 0
  const arrow = isUp ? '\u2191' : '\u2193'
  const color = isUp ? 'text-green' : 'text-red'

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4 card-hover glass">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted font-mono mb-3">
        Growth
      </h3>
      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-bold text-text-primary tabular-nums">
          {data.items_last_7d}
        </span>
        <span className="text-xs text-text-secondary">items this week</span>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <span className={`text-sm font-bold ${color}`}>
          {arrow} {Math.abs(data.growth_rate)}%
        </span>
        <span className="text-[11px] text-text-muted">vs previous week</span>
      </div>
      <div className="mt-3 pt-3 border-t border-border/50">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-text-primary tabular-nums">
            {data.items_last_30d}
          </span>
          <span className="text-[11px] text-text-muted">items last 30 days</span>
        </div>
      </div>
    </div>
  )
}

// ─── TopThemesChart ──────────────────────────────────────────────────────────
function TopThemesChart({
  data,
  onClick,
}: {
  data: InsightsPayload['top_themes']
  onClick: (theme: string) => void
}) {
  if (!data?.length) return null
  const chartData = data.slice(0, 8)
  const height = 8 + chartData.length * 28

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4 card-hover glass">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted font-mono mb-3">
        Top Themes
      </h3>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="theme"
            width={100}
            tick={{ fontSize: 11, fill: '#8facc8' }}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          />
          <Bar
            dataKey="count"
            radius={[0, 4, 4, 0]}
            cursor="pointer"
            onClick={(entry: { theme: string }) => onClick(entry.theme)}
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={THEME_COLORS[i % THEME_COLORS.length]} fillOpacity={1 - i * 0.06} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── InsightsSection ─────────────────────────────────────────────────────────
export function InsightsSection() {
  const { data, isLoading } = useQuery<InsightsPayload>({
    queryKey: ['insights'],
    queryFn: api.insights,
    staleTime: 120_000,
  })

  const setActiveView = useAppStore((s) => s.setActiveView)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)

  function goSource(source: string) {
    resetFilters()
    setFilter('sourceType', source)
    setActiveView('images')
  }

  function goStatus(status: string) {
    resetFilters()
    setFilter('reviewStatus', status)
    setActiveView('images')
  }

  function goTheme(theme: string) {
    resetFilters()
    setFilter('theme', theme)
    setActiveView('images')
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-bg-surface border border-border rounded-xl p-4 card-hover glass h-40 animate-pulse">
            <div className="h-3 w-24 shimmer rounded mb-3" />
            <div className="h-20 shimmer rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (!data) return null

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-text-muted font-mono mb-3">
        Research Insights
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SourceBreakdownBar data={data.source_breakdown} onClick={goSource} />
        <ReviewFunnel data={data.review_funnel} onClick={goStatus} />
        <GrowthIndicator data={data.growth} />
        <TopThemesChart data={data.top_themes} onClick={goTheme} />
      </div>
    </div>
  )
}

export default InsightsSection
