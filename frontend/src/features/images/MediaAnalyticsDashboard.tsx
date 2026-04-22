import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend, PieChart, Pie, Cell,
} from "recharts"
import { api } from "@/lib/api"
import { Spinner } from "@/components/Spinner"

const SOURCE_COLORS: Record<string, string> = {
  ddg: "#6366f1",
  redgifs: "#f43f5e",
  x: "#0ea5e9",
  url: "#10b981",
  other: "#94a3b8",
}

const PIE_COLORS = ["#6366f1", "#f43f5e", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"]

function TagCloud({ tags }: { tags: { tag: string; count: number }[] }) {
  if (tags.length === 0) return <p className="text-xs text-white/40">No tags yet</p>
  const max = tags[0]?.count || 1
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => {
        const weight = Math.max(10, Math.round(10 + (t.count / max) * 8))
        const opacity = 0.4 + (t.count / max) * 0.6
        return (
          <span
            key={t.tag}
            style={{ fontSize: `${weight}px`, opacity }}
            className="cursor-default rounded-full bg-white/5 px-2 py-0.5 text-[var(--color-text-secondary)] hover:bg-white/10 transition-colors"
            title={`${t.count} items`}
          >
            {t.tag}
          </span>
        )
      })}
    </div>
  )
}

const CHART_TOOLTIP_STYLE = {
  contentStyle: { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "11px" },
  labelStyle: { color: "#94a3b8" },
  itemStyle: { color: "#e2e8f0" },
}

export function MediaAnalyticsDashboard({ onClose }: { onClose: () => void }) {
  const [days, setDays] = useState(30)

  const { data, isLoading } = useQuery({
    queryKey: ["media-analytics", days],
    queryFn: () => api.mediaAnalytics(days),
    staleTime: 60_000,
  })

  return (
    <div className="border-b border-white/10 bg-white/[0.015] px-4 py-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Media Analytics</h2>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-[var(--color-text-secondary)]"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            Close ×
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-8"><Spinner /></div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">

          {/* Daily captures line chart */}
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 sm:col-span-2">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Daily Captures ({days}d)</p>
            {data.daily_captures.length === 0 ? (
              <p className="text-xs text-white/30 py-4 text-center">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={data.daily_captures} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: "#64748b" }} />
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                  <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} name="Captures" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Source distribution pie */}
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">By Source</p>
            {data.source_dist.length === 0 ? (
              <p className="text-xs text-white/30 py-4 text-center">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={data.source_dist} dataKey="count" nameKey="source" cx="50%" cy="50%" outerRadius={55} strokeWidth={0}>
                    {data.source_dist.map((entry, i) => (
                      <Cell key={entry.source} fill={SOURCE_COLORS[entry.source] ?? PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v: number, name: string) => [v, name]} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: "10px", color: "#94a3b8" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top terms bar chart */}
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 sm:col-span-2">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Top Terms</p>
            {data.top_terms.length === 0 ? (
              <p className="text-xs text-white/30 py-4 text-center">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={data.top_terms.slice(0, 12)} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 9, fill: "#64748b" }} />
                  <YAxis type="category" dataKey="term" tick={{ fontSize: 9, fill: "#94a3b8" }} width={90} />
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="count" fill="#6366f1" radius={[0, 3, 3, 0]} name="Count" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Rating distribution */}
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Rating Distribution</p>
            {data.rating_dist.length === 0 ? (
              <p className="text-xs text-white/30 py-4 text-center">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={data.rating_dist} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <XAxis dataKey="rating" tick={{ fontSize: 9, fill: "#64748b" }} tickFormatter={(v: number) => v === 0 ? "None" : "★".repeat(v)} />
                  <YAxis tick={{ fontSize: 9, fill: "#64748b" }} />
                  <Tooltip {...CHART_TOOLTIP_STYLE} labelFormatter={(v: number) => v === 0 ? "Unrated" : `${v} ★`} />
                  <Bar dataKey="count" fill="#f59e0b" radius={[3, 3, 0, 0]} name="Count" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Type over time */}
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 sm:col-span-2">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Images vs Videos (30d)</p>
            {data.type_over_time.length === 0 ? (
              <p className="text-xs text-white/30 py-4 text-center">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={data.type_over_time} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#64748b" }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: "#64748b" }} />
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="images" stackId="a" fill="#6366f1" name="Images" />
                  <Bar dataKey="videos" stackId="a" fill="#f43f5e" name="Videos" radius={[3, 3, 0, 0]} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: "10px", color: "#94a3b8" }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Tag cloud */}
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Tag Cloud</p>
            <TagCloud tags={data.tag_cloud} />
          </div>

        </div>
      )}
    </div>
  )
}
