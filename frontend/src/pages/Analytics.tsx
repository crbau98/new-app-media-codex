import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
  LineChart,
  Line,
} from 'recharts'
import {
  Library,
  Video,
  Image,
  Users,
  Eye,
  Heart,
  TrendingUp,
  TrendingDown,
  Clock,
  Plus,
  Star,
  Download,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { mediaItems, creators, categories } from '@/lib/mockData'

/* ───────────────────────────────────────────────
   Types
   ────────────────────────────────────────────── */

type TimeRange = 'today' | '7d' | '30d' | '90d' | 'all'

/* ───────────────────────────────────────────────
   Mock Analytics Data
   ────────────────────────────────────────────── */

function generateTrendData(days: number, base: number, variance: number) {
  const data = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const val = Math.max(0, Math.floor(base + Math.random() * variance - variance / 2))
    data.push({
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: val,
      likes: Math.floor(val * 0.15),
      comments: Math.floor(val * 0.08),
    })
  }
  return data
}

const VIEWS_DATA_7D = generateTrendData(7, 1200, 600)
const VIEWS_DATA_30D = generateTrendData(30, 900, 500)
const VIEWS_DATA_90D = generateTrendData(90, 700, 400)

const CATEGORY_DATA = categories
  .filter((c) => c.name !== 'Featured')
  .slice(0, 6)
  .map((c, i) => ({
    name: c.name,
    value: c.count,
    color: [
      '#e879a9',
      '#fb7185',
      '#a78bfa',
      '#fbbf24',
      '#2dd4bf',
      '#60a5fa',
    ][i],
  }))

const SOURCE_DATA = [
  { name: 'Tube', value: 28, color: '#e879a9' },
  { name: 'Redgifs', value: 22, color: '#fb7185' },
  { name: 'Coomer', value: 12, color: '#a78bfa' },
  { name: 'Kemono', value: 6, color: '#fbbf24' },
]

const QUALITY_DATA = [
  { name: 'HD', value: 65, color: '#e879a9' },
  { name: '4K', value: 12, color: '#34d399' },
  { name: 'Standard', value: 23, color: '#6b7280' },
]

const CREATOR_LEADERBOARD = creators
  .slice(0, 5)
  .map((c, i) => ({
    ...c,
    rank: i + 1,
    items: Math.floor(Math.random() * 20) + 5,
    views: c.followers * 3 + Math.floor(Math.random() * 5000),
    sparkline: Array.from({ length: 7 }, () => Math.floor(Math.random() * 50) + 10),
  }))
  .sort((a, b) => b.views - a.views)

const ACTIVITY_FEED = [
  { icon: Plus, color: 'var(--success)', text: "New media added: 'Midnight Steam Session'", time: '2 hours ago' },
  { icon: Eye, color: 'var(--accent)', text: "Viewed 'Golden Rain Finale'", time: '3 hours ago' },
  { icon: Heart, color: 'var(--error)', text: "Liked 'Deep Tissue Release'", time: '5 hours ago' },
  { icon: Star, color: 'var(--warning)', text: "Favorited 'Poolside Worship'", time: '6 hours ago' },
  { icon: Download, color: 'var(--success)', text: "Downloaded 'Solo Mirror Play'", time: '8 hours ago' },
  { icon: Plus, color: 'var(--success)', text: "New media added: 'Steam Room Tension'", time: '10 hours ago' },
  { icon: Eye, color: 'var(--accent)', text: "Viewed 'Three in the Locker Room'", time: '12 hours ago' },
  { icon: Heart, color: 'var(--error)', text: "Liked 'Triangle of Pleasure'", time: '14 hours ago' },
  { icon: Plus, color: 'var(--success)', text: "New media added: 'Warm Oil Rub'", time: '16 hours ago' },
  { icon: Eye, color: 'var(--accent)', text: "Viewed 'After Hours Sauna'", time: '18 hours ago' },
]

/* ───────────────────────────────────────────────
   CountUp Hook
   ────────────────────────────────────────────── */

function useCountUp(target: number, duration = 1000, startOnMount = true) {
  const [value, setValue] = useState(0)
  const startTime = useRef<number | null>(null)
  const raf = useRef<number | null>(null)

  const start = useCallback(() => {
    startTime.current = null
    const step = (ts: number) => {
      if (!startTime.current) startTime.current = ts
      const progress = Math.min((ts - startTime.current) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.floor(eased * target))
      if (progress < 1) {
        raf.current = requestAnimationFrame(step)
      }
    }
    raf.current = requestAnimationFrame(step)
  }, [target, duration])

  useEffect(() => {
    if (startOnMount) start()
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [start, startOnMount])

  return value
}

/* ───────────────────────────────────────────────
   Stat Card
   ────────────────────────────────────────────── */

function StatCard({
  label,
  value,
  change,
  changeType,
  icon: Icon,
  delay = 0,
  sparklineData,
}: {
  label: string
  value: number
  change: string
  changeType: 'up' | 'down' | 'neutral'
  icon: React.ElementType
  delay?: number
  sparklineData?: number[]
}) {
  const count = useCountUp(value, 1000)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      }}
      className="bg-[var(--bg-elevated)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-5 min-w-[160px] flex-1"
    >
      <div className="flex items-start justify-between mb-3">
        <Icon size={18} className="text-[var(--text-tertiary)]" />
        {sparklineData && (
          <svg width="40" height="20" viewBox="0 0 40 20" className="opacity-50">
            <polyline
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.5"
              points={sparklineData
                .map((v, i) => `${(i / (sparklineData.length - 1)) * 40},${20 - (v / Math.max(...sparklineData)) * 20}`)
                .join(' ')}
            />
          </svg>
        )}
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
        {label}
      </p>
      <p className="text-[28px] font-bold text-[var(--text-primary)] leading-none tracking-tight">
        {count.toLocaleString()}
      </p>
      <div className="flex items-center gap-1 mt-2">
        {changeType === 'up' && <TrendingUp size={14} className="text-[var(--success)]" />}
        {changeType === 'down' && <TrendingDown size={14} className="text-[var(--error)]" />}
        <span
          className={cn(
            'text-[12px] font-medium',
            changeType === 'up' && 'text-[var(--success)]',
            changeType === 'down' && 'text-[var(--error)]',
            changeType === 'neutral' && 'text-[var(--text-tertiary)]'
          )}
        >
          {change}
        </span>
      </div>
    </motion.div>
  )
}

/* ───────────────────────────────────────────────
   Chart Tooltip
   ────────────────────────────────────────────── */

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number; name?: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-md px-3 py-2">
      <p className="text-[12px] text-[var(--text-tertiary)] mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-[13px] font-medium text-[var(--text-primary)]">
          {p.name ? `${p.name}: ` : ''}
          {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </p>
      ))}
    </div>
  )
}

/* ───────────────────────────────────────────────
   Main Analytics Page
   ────────────────────────────────────────────── */

const TIME_RANGES: { label: string; value: TimeRange; dateLabel: string }[] = [
  { label: 'Today', value: 'today', dateLabel: 'May 7, 2026' },
  { label: '7 Days', value: '7d', dateLabel: 'May 1 — May 7, 2026' },
  { label: '30 Days', value: '30d', dateLabel: 'Apr 7 — May 7, 2026' },
  { label: '90 Days', value: '90d', dateLabel: 'Feb 6 — May 7, 2026' },
  { label: 'All Time', value: 'all', dateLabel: 'Jan 2025 — May 2026' },
]

export function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>('7d')

  const rangeInfo = TIME_RANGES.find((r) => r.value === timeRange)!

  // Stats derived from mock data
  const totalItems = mediaItems.length
  const totalVideos = mediaItems.filter((m) => m.isVideo).length
  const totalImages = mediaItems.filter((m) => !m.isVideo).length
  const totalCreators = creators.length
  const totalViews = mediaItems.reduce((acc, m) => acc + m.views, 0)
  const totalFavorites = Math.floor(totalItems * 0.42)

  const viewsData =
    timeRange === 'today'
      ? VIEWS_DATA_7D.slice(-1)
      : timeRange === '7d'
        ? VIEWS_DATA_7D
        : timeRange === '30d'
          ? VIEWS_DATA_30D
          : timeRange === '90d'
            ? VIEWS_DATA_90D
            : VIEWS_DATA_90D

  return (
    <div className="min-h-[100dvh] pb-20">
      <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.3,
            ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
          }}
          className="flex flex-col md:flex-row md:items-end md:justify-between gap-4"
        >
          <div>
            <h1 className="text-[clamp(24px,3vw,36px)] font-bold text-[var(--text-primary)] tracking-tight">
              Analytics
            </h1>
            <p className="text-[14px] text-[var(--text-secondary)] mt-1">
              Library insights and trends &middot; {rangeInfo.dateLabel}
            </p>
          </div>

          {/* Time range selector */}
          <div className="inline-flex items-center bg-[var(--bg-surface)] rounded-full p-1 gap-1">
            {TIME_RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setTimeRange(r.value)}
                className={cn(
                  'px-3 py-1.5 text-[13px] font-medium rounded-full transition-colors duration-150',
                  timeRange === r.value
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </motion.div>

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard
            label="Total Items"
            value={totalItems}
            change="+12%"
            changeType="up"
            icon={Library}
            delay={0}
            sparklineData={[45, 52, 48, 60, 55, 68, 62]}
          />
          <StatCard
            label="Videos"
            value={totalVideos}
            change="+3 new"
            changeType="up"
            icon={Video}
            delay={0.06}
            sparklineData={[30, 32, 35, 33, 38, 40, 42]}
          />
          <StatCard
            label="Images"
            value={totalImages}
            change="+5 new"
            changeType="up"
            icon={Image}
            delay={0.12}
            sparklineData={[20, 22, 21, 25, 24, 28, 26]}
          />
          <StatCard
            label="Creators"
            value={totalCreators}
            change="+1 new"
            changeType="up"
            icon={Users}
            delay={0.18}
          />
          <StatCard
            label="Views This Week"
            value={Math.floor(totalViews / 1000)}
            change="+8%"
            changeType="up"
            icon={Eye}
            delay={0.24}
            sparklineData={[800, 950, 1100, 1050, 1200, 1350, 1280]}
          />
          <StatCard
            label="Favorites"
            value={totalFavorites}
            change="+15%"
            changeType="up"
            icon={Heart}
            delay={0.3}
            sparklineData={[20, 25, 22, 30, 28, 35, 32]}
          />
        </div>

        {/* ── Views Trend Chart ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.5,
            delay: 0.35,
            ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
          }}
          className="bg-[var(--bg-elevated)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-5"
        >
          <h3 className="text-[16px] font-semibold text-[var(--text-primary)] mb-4">Views Trend</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={viewsData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <defs>
                  <linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: 'var(--text-tertiary)' }}
                  axisLine={{ stroke: 'var(--border-subtle)' }}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill="url(#viewsGradient)"
                  animationDuration={1000}
                  dot={{ r: 3, fill: 'var(--accent)', strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: 'var(--accent)', strokeWidth: 0, style: { filter: 'drop-shadow(0 0 6px var(--accent-glow))' } }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* ── Breakdown Row: Category Pie + Source Bar ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Category Distribution */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.4,
              ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
            }}
            className="bg-[var(--bg-elevated)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-5"
          >
            <h3 className="text-[16px] font-semibold text-[var(--text-primary)] mb-4">Category Distribution</h3>
            <div className="h-[240px] flex items-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={CATEGORY_DATA}
                    cx="40%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    animationDuration={800}
                    animationEasing="ease-out"
                  >
                    {CATEGORY_DATA.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              {/* Legend */}
              <div className="flex flex-col gap-2 min-w-[140px]">
                {CATEGORY_DATA.map((c) => (
                  <div key={c.name} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                    <span className="text-[12px] text-[var(--text-secondary)] truncate">{c.name}</span>
                    <span className="text-[12px] font-medium text-[var(--text-primary)] ml-auto">{c.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Source Breakdown */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.45,
              ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
            }}
            className="bg-[var(--bg-elevated)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-5"
          >
            <h3 className="text-[16px] font-semibold text-[var(--text-primary)] mb-4">Source Breakdown</h3>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={SOURCE_DATA}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tick={{ fontSize: 13, fill: 'var(--text-secondary)' }}
                    axisLine={false}
                    tickLine={false}
                    width={70}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} animationDuration={600}>
                    {SOURCE_DATA.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.color}
                        fillOpacity={1 - index * 0.2}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>

        {/* ── Creator Leaderboard + Activity Feed ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Creator Leaderboard */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.5,
              ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
            }}
            className="bg-[var(--bg-elevated)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-semibold text-[var(--text-primary)]">Top Creators</h3>
              <button className="text-[12px] font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors">
                View all →
              </button>
            </div>
            <div className="space-y-2 max-h-[320px] overflow-y-auto hide-scrollbar">
              {CREATOR_LEADERBOARD.map((c, i) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: 0.4,
                    delay: 0.55 + i * 0.04,
                    ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
                  }}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-[var(--bg-surface)] transition-colors group"
                >
                  <span
                    className={cn(
                      'w-6 text-[14px] font-bold text-center shrink-0',
                      i < 3 ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'
                    )}
                  >
                    {i + 1}
                  </span>
                  <img
                    src={c.avatar}
                    alt={c.name}
                    className="w-9 h-9 rounded-full object-cover shrink-0"
                    loading="lazy"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{c.name}</p>
                    <p className="text-[11px] text-[var(--text-tertiary)]">{c.items} items</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[12px] font-medium text-[var(--text-secondary)]">
                      {(c.views / 1000).toFixed(1)}k
                    </p>
                    {/* Mini bar */}
                    <div className="w-10 h-1 rounded-full bg-[var(--bg-surface)] mt-1 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{
                          width: `${(c.views / CREATOR_LEADERBOARD[0].views) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Recent Activity Feed */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.5,
              ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
            }}
            className="bg-[var(--bg-elevated)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-5"
          >
            <h3 className="text-[16px] font-semibold text-[var(--text-primary)] mb-4">Recent Activity</h3>
            <div className="space-y-1 max-h-[320px] overflow-y-auto hide-scrollbar">
              {ACTIVITY_FEED.map((item, i) => {
                const Icon = item.icon
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.3,
                      delay: 0.55 + i * 0.05,
                      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
                    }}
                    className="flex items-center gap-3 p-2.5 rounded-md hover:bg-[var(--bg-surface)] transition-colors"
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `rgba(${item.color.includes('--') ? 'var(--accent)' : item.color}, 0.15)` }}
                    >
                      <Icon size={14} style={{ color: `var(${item.color})` }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[var(--text-primary)] truncate">{item.text}</p>
                    </div>
                    <span className="text-[11px] text-[var(--text-tertiary)] shrink-0 flex items-center gap-1">
                      <Clock size={10} />
                      {item.time}
                    </span>
                  </motion.div>
                )
              })}
            </div>
          </motion.div>
        </div>

        {/* ── Engagement + Quality ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Engagement Over Time */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.6,
              ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
            }}
            className="bg-[var(--bg-elevated)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-5"
          >
            <h3 className="text-[16px] font-semibold text-[var(--text-primary)] mb-4">Engagement Over Time</h3>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={VIEWS_DATA_30D} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                    axisLine={{ stroke: 'var(--border-subtle)' }}
                    tickLine={false}
                    interval={4}
                  />
                  <YAxis hide />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="likes"
                    name="Likes"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={false}
                    animationDuration={800}
                  />
                  <Line
                    type="monotone"
                    dataKey="comments"
                    name="Comments"
                    stroke="var(--success)"
                    strokeWidth={2}
                    dot={false}
                    animationDuration={800}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Quality Distribution */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.65,
              ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
            }}
            className="bg-[var(--bg-elevated)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-5"
          >
            <h3 className="text-[16px] font-semibold text-[var(--text-primary)] mb-4">Quality Distribution</h3>
            <div className="h-[200px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={QUALITY_DATA}
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    innerRadius={50}
                    paddingAngle={2}
                    dataKey="value"
                    animationDuration={800}
                  >
                    {QUALITY_DATA.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>

        {/* ── Insights ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.5,
            delay: 0.7,
            ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
          }}
        >
          <h3 className="text-[16px] font-semibold text-[var(--text-primary)] mb-3">Insights</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                icon: Clock,
                text: 'Your most active time is 10pm — 2am',
                accent: true,
              },
              {
                icon: TrendingUp,
                text: "You've viewed 47% more content this week",
                accent: false,
              },
              {
                icon: Star,
                text: 'Top category: gay massage (23 items)',
                accent: true,
              },
            ].map((insight, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.4,
                  delay: 0.75 + i * 0.08,
                  ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
                }}
                className="bg-[var(--bg-elevated)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-4 flex items-start gap-3"
                style={{
                  borderLeftWidth: '3px',
                  borderLeftColor: insight.accent ? 'var(--accent)' : 'var(--success)',
                }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor: insight.accent ? 'var(--accent-dim)' : 'rgba(52,211,153,0.15)',
                  }}
                >
                  <insight.icon
                    size={16}
                    style={{ color: insight.accent ? 'var(--accent)' : 'var(--success)' }}
                  />
                </div>
                <p className="text-[13px] text-[var(--text-primary)] leading-relaxed pt-1">{insight.text}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
