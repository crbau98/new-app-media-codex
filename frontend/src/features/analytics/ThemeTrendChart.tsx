import { useId, useState } from 'react'
import { useAppStore } from '@/store'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Brush,
  Legend,
} from 'recharts'
import type { TooltipProps } from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import { useQuery } from '@tanstack/react-query'
import { useDashboard } from '@/hooks/useDashboard'
import { cn } from '@/lib/cn'
import { CHART_AXIS_TICK } from '@/lib/chartTheme'
import { api, type TrendsPayload } from '@/lib/api'

type ChartView = "theme" | "source" | "daily"

interface ThemeTrendChartProps {
  onBarClick?: (value: string, view: ChartView) => void
}

// Palette for multi-series daily chart
const SERIES_COLORS = ["#3b82f6", "#14b8a6", "#f59e0b", "#a855f7", "#22c55e", "#ef4444", "#6366f1", "#f97316"]

// ─── Custom rich tooltip ──────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: TooltipProps<ValueType, NameType>) {
  if (!active || !payload || payload.length === 0) return null

  const count = payload[0]?.value as number | undefined
  const formattedLabel = label != null ? String(label) : ''

  return (
    <div
      className={cn(
        'bg-bg-elevated border border-border rounded-lg px-3 py-2',
        'shadow-xl pointer-events-none',
      )}
      style={{ minWidth: 120 }}
    >
      {formattedLabel && (
        <p className="text-accent text-[11px] font-semibold mb-1 truncate max-w-[160px]">
          {formattedLabel}
        </p>
      )}
      {count !== undefined && (
        <p className="text-2xl font-bold font-mono text-text-primary leading-none">
          {count.toLocaleString()}
        </p>
      )}
      <p className="text-[10px] text-text-muted font-mono mt-1">items</p>
    </div>
  )
}

// ─── Daily tooltip (multi-series) ─────────────────────────────────────────────
function DailyTooltip({ active, payload, label }: TooltipProps<ValueType, NameType>) {
  if (!active || !payload || payload.length === 0) return null
  const date = label != null ? String(label) : ''
  return (
    <div
      className="bg-bg-elevated border border-border rounded-lg px-3 py-2 shadow-xl pointer-events-none"
      style={{ minWidth: 140 }}
    >
      {date && <p className="text-accent text-[11px] font-semibold mb-2 font-mono">{date}</p>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4 text-xs">
          <span className="text-text-muted truncate max-w-[90px]">{p.name}</span>
          <span className="font-mono font-bold" style={{ color: p.color }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── CSV download helper ───────────────────────────────────────────────────────
function downloadCSV(data: Record<string, unknown>[]) {
  if (!data?.length) return
  const keys = Object.keys(data[0])
  const csv = [keys.join(','), ...data.map(row => keys.map(k => row[k] ?? '').join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'theme-trends.csv'; a.click()
  URL.revokeObjectURL(url)
}

// ─── ThemeTrendChart ──────────────────────────────────────────────────────────
export function ThemeTrendChart({ onBarClick }: ThemeTrendChartProps = {}) {
  const uid = useId()
  const gradId = `themeGrad-${uid.replace(/:/g, '')}`
  const { data } = useDashboard()
  const themeData = data?.stats.themes ?? []
  const sourceData = data?.stats.source_mix ?? []

  const setActiveView = useAppStore((s) => s.setActiveView)
  const setFilter = useAppStore((s) => s.setFilter)
  const resetFilters = useAppStore((s) => s.resetFilters)

  const [view, setView] = useState<ChartView>("theme")

  // Fetch daily trends from /api/stats/trends for the "daily" view
  const { data: trendsData } = useQuery<TrendsPayload>({
    queryKey: ['stats-trends', 30],
    queryFn: () => api.statsTrends(30),
    staleTime: 5 * 60_000,
    enabled: view === 'daily',
  })

  // Build chart data for daily view: array of { date, source1: n, source2: n, ... }
  const dailyChartData = trendsData
    ? trendsData.dates.map((date, i) => {
        const point: Record<string, string | number> = { date }
        for (const [src, counts] of Object.entries(trendsData.series)) {
          point[src] = counts[i] ?? 0
        }
        return point
      })
    : []
  const dailySeries = trendsData ? Object.keys(trendsData.series) : []

  const chartData = view === "theme" ? themeData : sourceData
  const dataKey = view === "theme" ? "theme" : "source_type"

  const hasData = themeData.length > 0 || sourceData.length > 0

  if (!hasData && view !== 'daily') {
    return (
      <div className="bg-bg-surface border border-border rounded-xl p-5 flex items-center justify-center h-[264px]">
        <p className="text-xs text-text-muted font-mono">No theme data yet</p>
      </div>
    )
  }

  return (
    <div
      className="bg-bg-surface border border-border rounded-xl p-5"
      role="img"
      aria-label="Trend chart showing item counts per research theme, source, or daily timeline"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-text-primary">
            Trend
            {view === 'daily'
              ? ` — last ${trendsData?.dates.length ?? 30}d`
              : view === 'theme'
              ? ` — by theme`
              : ` — by source`}
          </p>
          {onBarClick && view !== 'daily' && (
            <span className="text-[10px] text-text-muted font-mono">click to filter</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const csvData = view === 'daily' ? dailyChartData : chartData as Record<string, unknown>[]
              downloadCSV(csvData)
            }}
            className="text-xs text-text-muted hover:text-text-primary font-mono transition-colors"
            title="Download chart data as CSV"
          >
            ↓ csv
          </button>
          <div className="flex gap-1 text-xs">
            {(["theme", "source", "daily"] as ChartView[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-2 py-1 rounded transition-colors capitalize",
                  view === v ? "bg-bg-elevated text-text-primary" : "text-text-muted hover:text-text-primary"
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Daily multi-series chart */}
      {view === 'daily' && (
        dailyChartData.length === 0 ? (
          <div className="flex items-center justify-center h-[200px]">
            <p className="text-xs text-text-muted font-mono">Loading daily data…</p>
          </div>
        ) : (
          <>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart
              data={dailyChartData}
              margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
              onClick={(chartData) => {
                if (!chartData?.activeLabel) return
                const date = chartData.activeLabel as string
                const from = new Date(date)
                from.setDate(from.getDate() - 3)
                const to = new Date(date)
                to.setDate(to.getDate() + 3)
                resetFilters()
                setFilter('dateFrom', from.toISOString().slice(0, 10))
                setFilter('dateTo', to.toISOString().slice(0, 10))
                setActiveView('items')
              }}
              style={{ cursor: 'pointer' }}
            >
              <defs>
                {dailySeries.map((src, i) => (
                  <linearGradient key={src} id={`${gradId}_${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <XAxis dataKey="date" tick={CHART_AXIS_TICK} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={CHART_AXIS_TICK} />
              <Tooltip
                content={<DailyTooltip />}
                cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 4' }}
                wrapperStyle={{ zIndex: 50, outline: 'none' }}
              />
              <Legend
                formatter={(v) => <span style={{ color: 'var(--color-text-secondary)', fontSize: 10 }}>{v}</span>}
              />
              {dailySeries.map((src, i) => (
                <Area
                  key={src}
                  type="monotone"
                  dataKey={src}
                  name={src}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  fill={`url(#${gradId}_${i})`}
                  strokeWidth={1.5}
                  dot={false}
                  stackId="1"
                />
              ))}
              <Brush
                dataKey="date"
                height={24}
                fill="#161e2e"
                stroke="#1e2d42"
                travellerWidth={8}
                tickFormatter={(v: unknown) => String(v).slice(5)}
              />
            </AreaChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-text-muted text-center mt-1">Click a date to filter items</p>
          </>
        )
      )}

      {/* Theme / Source bar charts */}
      {view !== 'daily' && (
        chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[200px]">
            <p className="text-xs text-text-muted font-mono">No {view} data yet</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart
              data={chartData}
              margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
              onClick={(chartState) => {
                if (!onBarClick) return
                const payload = (chartState as { activePayload?: { payload: Record<string, unknown> }[] } | undefined)?.activePayload?.[0]?.payload
                if (!payload) return
                const value = payload[dataKey]
                if (value) onBarClick(String(value), view)
              }}
              style={onBarClick ? { cursor: 'pointer' } : undefined}
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey={dataKey} tick={CHART_AXIS_TICK} />
              <YAxis tick={CHART_AXIS_TICK} />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 4' }}
                wrapperStyle={{ zIndex: 50, outline: 'none' }}
                allowEscapeViewBox={{ x: false, y: true }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#3b82f6"
                fill={`url(#${gradId})`}
                strokeWidth={2}
              />
              <Brush
                dataKey={dataKey}
                height={24}
                fill="#161e2e"
                stroke="#1e2d42"
                travellerWidth={8}
                tickFormatter={(v: unknown) => String(v).slice(0, 6)}
              />
            </AreaChart>
          </ResponsiveContainer>
        )
      )}
    </div>
  )
}
