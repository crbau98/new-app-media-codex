import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type TrendsPayload } from '@/lib/api'
import { useAppStore } from '@/store'

const CELL_SIZE = 12
const CELL_GAP = 2
const CELL_STEP = CELL_SIZE + CELL_GAP
const DAY_LABEL_WIDTH = 20
const MONTH_LABEL_HEIGHT = 16

const RESEARCH_DAYS = 90
const MEDIA_DAYS = 365

const LEVELS = [
  { min: 0, max: 0, color: 'var(--color-bg-subtle)' },
  { min: 1, max: 2, color: '#1a3a2a' },
  { min: 3, max: 5, color: '#1e6b3a' },
  { min: 6, max: 10, color: '#2ea85a' },
  { min: 11, max: Infinity, color: '#3ef07a' },
] as const

const LEGEND_LABELS = ['None', 'Low', 'Med', 'High', 'Very high']

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const DAY_LABELS: { day: number; label: string }[] = [
  { day: 1, label: 'M' },
  { day: 3, label: 'W' },
  { day: 5, label: 'F' },
]

function getLevel(count: number): (typeof LEVELS)[number] {
  for (const level of LEVELS) {
    if (count >= level.min && count <= level.max) return level
  }
  return LEVELS[LEVELS.length - 1]
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function formatTooltipDate(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`
}

interface DayCell {
  date: Date
  dateStr: string
  count: number
  col: number
  row: number
}

function buildGrid(dailyCounts: Record<string, number>, daysBack: number): { cells: DayCell[]; weeks: number; monthLabels: { label: string; col: number }[] } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const start = new Date(today)
  start.setDate(start.getDate() - daysBack + 1)
  // Align to previous Monday (day 0 = Sunday in JS, we want Monday = row 0)
  const startDow = start.getDay()
  const mondayOffset = startDow === 0 ? -6 : 1 - startDow
  start.setDate(start.getDate() + mondayOffset)

  const cells: DayCell[] = []
  const monthLabels: { label: string; col: number }[] = []
  const seenMonths = new Set<string>()

  const cursor = new Date(start)
  let col = 0
  let maxCol = 0

  while (cursor <= today) {
    // row: 0=Mon, 1=Tue, ... 6=Sun
    const jsDay = cursor.getDay()
    const row = jsDay === 0 ? 6 : jsDay - 1

    if (row === 0 && col > 0) {
      // new week column
    }

    const dateStr = formatDate(cursor)
    const count = dailyCounts[dateStr] ?? 0

    // Track current column based on weeks from start
    const daysSinceStart = Math.floor((cursor.getTime() - start.getTime()) / 86400000)
    col = Math.floor(daysSinceStart / 7)
    if (col > maxCol) maxCol = col

    // Month label at first Monday of each month
    const monthKey = `${cursor.getFullYear()}-${cursor.getMonth()}`
    if (!seenMonths.has(monthKey) && row === 0) {
      seenMonths.add(monthKey)
      monthLabels.push({ label: MONTH_NAMES[cursor.getMonth()], col })
    }

    cells.push({ date: new Date(cursor), dateStr, count, col, row })
    cursor.setDate(cursor.getDate() + 1)
  }

  return { cells, weeks: maxCol + 1, monthLabels }
}

type HeatmapMode = 'research' | 'media'

export function ActivityHeatmap() {
  const setActiveView = useAppStore((s) => s.setActiveView)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)

  const [mode, setMode] = useState<HeatmapMode>('research')
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)

  const daysBack = mode === 'media' ? MEDIA_DAYS : RESEARCH_DAYS

  const { data: trends } = useQuery<TrendsPayload>({
    queryKey: ['statsTrends', RESEARCH_DAYS],
    queryFn: () => api.statsTrends(RESEARCH_DAYS),
    staleTime: 120_000,
    enabled: mode === 'research',
  })

  const { data: mediaAnalytics } = useQuery({
    queryKey: ['mediaAnalytics', MEDIA_DAYS],
    queryFn: () => api.mediaAnalytics(MEDIA_DAYS),
    staleTime: 120_000,
    enabled: mode === 'media',
  })

  // Sum across all source types per day (research mode)
  const researchCounts = useMemo(() => {
    if (!trends) return {}
    const counts: Record<string, number> = {}
    const { dates, series } = trends
    for (let i = 0; i < dates.length; i++) {
      let total = 0
      for (const src of Object.values(series)) {
        total += src[i] ?? 0
      }
      counts[dates[i]] = total
    }
    return counts
  }, [trends])

  // Media captures per day
  const mediaCounts = useMemo(() => {
    if (!mediaAnalytics) return {}
    const counts: Record<string, number> = {}
    for (const { date, count } of mediaAnalytics.daily_captures) {
      counts[date] = count
    }
    return counts
  }, [mediaAnalytics])

  const dailyCounts = mode === 'media' ? mediaCounts : researchCounts

  const { cells, weeks, monthLabels } = useMemo(() => buildGrid(dailyCounts, daysBack), [dailyCounts, daysBack])

  const totalCount = useMemo(() => cells.reduce((sum, c) => sum + c.count, 0), [cells])

  const svgWidth = DAY_LABEL_WIDTH + weeks * CELL_STEP
  const svgHeight = MONTH_LABEL_HEIGHT + 7 * CELL_STEP

  const noun = mode === 'media' ? 'capture' : 'item'

  function handleClick(cell: DayCell) {
    if (cell.count === 0) return
    resetFilters()
    if (mode === 'media') {
      setFilter('dateFrom', cell.dateStr)
      setFilter('dateTo', cell.dateStr)
      setActiveView('images')
    } else {
      setFilter('dateFrom', cell.dateStr)
      setFilter('dateTo', cell.dateStr)
      setActiveView('items')
    }
  }

  function handleMouseEnter(cell: DayCell, e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const parentRect = e.currentTarget.closest('svg')?.getBoundingClientRect()
    if (!parentRect) return
    setTooltip({
      x: rect.left - parentRect.left + CELL_SIZE / 2,
      y: rect.top - parentRect.top - 4,
      text: `${formatTooltipDate(cell.date)}: ${cell.count} ${noun}${cell.count !== 1 ? 's' : ''}`,
    })
  }

  function handleMouseLeave() {
    setTooltip(null)
  }

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4 card-hover glass">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-text-muted font-mono">Activity</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-text-muted tabular-nums">
            {totalCount.toLocaleString()} {noun}{totalCount !== 1 ? 's' : ''} · {daysBack}d
          </span>
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            <button
              onClick={() => setMode('research')}
              className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wide transition-colors ${
                mode === 'research'
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Research
            </button>
            <button
              onClick={() => setMode('media')}
              className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wide transition-colors border-l border-white/10 ${
                mode === 'media'
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Media
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          width={svgWidth}
          height={svgHeight}
          className="block"
          style={{ minWidth: svgWidth }}
        >
          {/* Month labels */}
          {monthLabels.map(({ label, col }) => (
            <text
              key={`month-${label}-${col}`}
              x={DAY_LABEL_WIDTH + col * CELL_STEP}
              y={MONTH_LABEL_HEIGHT - 4}
              className="fill-text-muted"
              fontSize={9}
              fontFamily="var(--font-mono, monospace)"
            >
              {label}
            </text>
          ))}

          {/* Day labels */}
          {DAY_LABELS.map(({ day, label }) => (
            <text
              key={`day-${day}`}
              x={0}
              y={MONTH_LABEL_HEIGHT + day * CELL_STEP + CELL_SIZE - 2}
              className="fill-text-muted"
              fontSize={9}
              fontFamily="var(--font-mono, monospace)"
            >
              {label}
            </text>
          ))}

          {/* Cells */}
          {cells.map((cell) => {
            const level = getLevel(cell.count)
            return (
              <rect
                key={cell.dateStr}
                x={DAY_LABEL_WIDTH + cell.col * CELL_STEP}
                y={MONTH_LABEL_HEIGHT + cell.row * CELL_STEP}
                width={CELL_SIZE}
                height={CELL_SIZE}
                rx={2}
                ry={2}
                fill={level.color}
                className={cell.count > 0 ? 'cursor-pointer hover:brightness-125 transition-[filter]' : ''}
                onClick={() => handleClick(cell)}
                onMouseEnter={(e) => handleMouseEnter(cell, e)}
                onMouseLeave={handleMouseLeave}
              />
            )
          })}

          {/* Tooltip */}
          {tooltip && (
            <g style={{ pointerEvents: 'none' }}>
              <rect
                x={tooltip.x - 60}
                y={tooltip.y - 22}
                width={120}
                height={20}
                rx={4}
                fill="#0f1520"
                stroke="#1e2d42"
                strokeWidth={1}
              />
              <text
                x={tooltip.x}
                y={tooltip.y - 9}
                textAnchor="middle"
                fill="#c8d6e5"
                fontSize={10}
                fontFamily="var(--font-mono, monospace)"
              >
                {tooltip.text}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 mt-3">
        <span className="text-[10px] text-text-muted font-mono mr-1">Less</span>
        {LEVELS.map((level, i) => (
          <div
            key={i}
            className="relative group"
          >
            <div
              style={{ width: CELL_SIZE, height: CELL_SIZE, backgroundColor: level.color, borderRadius: 2 }}
            />
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-bg-elevated border border-border rounded text-[9px] text-text-muted font-mono whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              {LEGEND_LABELS[i]}
            </span>
          </div>
        ))}
        <span className="text-[10px] text-text-muted font-mono ml-1">More</span>
      </div>
    </div>
  )
}
