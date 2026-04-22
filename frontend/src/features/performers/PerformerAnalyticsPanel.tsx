import React, { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

const BAR_COLORS: Record<string, string> = {
  OnlyFans: "bg-sky-400",
  "Twitter/X": "bg-neutral-400",
  Instagram: "bg-pink-400",
  Reddit: "bg-orange-400",
  Fansly: "bg-violet-400",
}

interface Props {
  onTagClick?: (tag: string) => void
}

export function PerformerAnalyticsPanel({ onTagClick }: Props) {
  const { data } = useQuery({
    queryKey: ["performer-analytics"],
    queryFn: () => api.performerAnalytics(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  const maxPlatformCount = useMemo(
    () => Math.max(...(data?.platform_distribution ?? []).map((p) => p.count), 1),
    [data?.platform_distribution],
  )

  const maxTagCount = useMemo(
    () => Math.max(...(data?.tag_cloud ?? []).map((t) => t.count), 1),
    [data?.tag_cloud],
  )

  if (!data) {
    return (
      <div className="depth-surface rounded-xl p-5 text-center text-sm text-white/40">
        Loading analytics...
      </div>
    )
  }

  const { platform_distribution, top_by_media, recent_additions, tag_cloud, growth, media_stats } = data

  return (
    <div className="depth-surface rounded-xl p-5 space-y-6">
      {/* Header row with growth stats */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-white/40">
          Analytics
        </h3>
        <div className="flex gap-4 text-xs text-white/50">
          <span>
            <span className="text-white/90 font-medium">{growth.total}</span> total
          </span>
          <span>
            <span className="text-emerald-400 font-medium">+{growth.this_week}</span> this week
          </span>
          <span>
            <span className="text-emerald-400 font-medium">+{growth.this_month}</span> this month
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Platform Distribution */}
        <div className="depth-elevated rounded-xl p-4 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-widest text-white/40">
            Platforms
          </h4>
          <div className="space-y-2">
            {platform_distribution.map((p) => (
              <div key={p.platform} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/70">{p.platform}</span>
                  <span className="text-white/50 tabular-nums">{p.count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${BAR_COLORS[p.platform] ?? "bg-white/30"}`}
                    style={{ width: `${(p.count / maxPlatformCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Performers */}
        <div className="depth-elevated rounded-xl p-4 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-widest text-white/40">
            Top by Media
          </h4>
          <div className="space-y-2">
            {top_by_media.slice(0, 5).map((p, i) => (
              <div key={p.id} className="flex items-center gap-2.5">
                <span className="text-[10px] font-bold text-white/25 w-3 text-right">{i + 1}</span>
                <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-semibold text-white/60 shrink-0">
                  {p.username.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white/80 truncate">{p.username}</p>
                  <p className="text-[10px] text-white/40">{p.platform}</p>
                </div>
                <span className="text-xs tabular-nums text-white/50">{p.media_count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Additions */}
        <div className="depth-elevated rounded-xl p-4 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-widest text-white/40">
            Recent Additions
          </h4>
          <div className="space-y-2">
            {recent_additions.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-semibold text-white/60 shrink-0">
                  {p.username.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white/80 truncate">{p.username}</p>
                  <p className="text-[10px] text-white/40">{p.platform}</p>
                </div>
                <span className="text-[10px] text-white/30">
                  {new Date(p.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Tag Cloud */}
        <div className="depth-elevated rounded-xl p-4 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-widest text-white/40">
            Tags
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {tag_cloud.slice(0, 20).map((t) => {
              const size = 0.65 + (t.count / maxTagCount) * 0.35
              return (
                <button
                  key={t.tag}
                  onClick={() => onTagClick?.(t.tag)}
                  className="rounded-md bg-white/5 px-2 py-0.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white/90"
                  style={{ fontSize: `${size}rem` }}
                >
                  {t.tag}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Media stats footer */}
      <div className="flex gap-6 text-xs text-white/40 border-t border-white/5 pt-3">
        <span>
          <span className="text-white/70 font-medium">{media_stats.total_photos.toLocaleString()}</span> photos
        </span>
        <span>
          <span className="text-white/70 font-medium">{media_stats.total_videos.toLocaleString()}</span> videos
        </span>
        <span>
          <span className="text-white/70 font-medium">{media_stats.avg_per_performer}</span> avg/performer
        </span>
      </div>
    </div>
  )
}
