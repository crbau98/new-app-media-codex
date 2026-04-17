import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query"
import { cn } from "@/lib/cn"
import { api, type Performer, type PerformerMedia, type PerformerLink, type Screenshot } from "@/lib/api"
import { resolvePublicUrl } from "@/lib/backendOrigin"
import { getPerformerAvatarSrc } from "@/lib/performer"
import { getScreenshotMediaSrc } from "@/lib/media"
import { useAppStore } from "@/store"
import { Skeleton } from "@/components/Skeleton"
import { sharedQueryKeys, useCaptureQueueQuery } from "@/features/sharedQueries"

/* ── Helpers ──────────────────────────────────────────────────────────── */

function getPerformerMediaSrc(m: PerformerMedia): string {
  // local_url is a web-accessible URL computed by backend.  For screenshots-origin
  // rows it already embeds shot_id so the proxy can refresh expired yt-dlp URLs.
  if (m.local_url) return resolvePublicUrl(m.local_url)
  // source_url is a remote URL - use proxy to avoid CORS issues
  if (m.source_url) {
    const url = m.source_url
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const shotId = m.source_kind === "screenshot" && m.id ? `&shot_id=${m.id}` : ""
      return resolvePublicUrl(`/api/screenshots/proxy-media?url=${encodeURIComponent(url)}${shotId}`)
    }
    return resolvePublicUrl(url)
  }
  // thumbnail_path and local_path are filesystem paths - not directly accessible
  return ""
}

function getPerformerMediaPreviewSrc(m: PerformerMedia): string {
  // Prefer a dedicated preview_url (extracted video poster or thumbnail).  Fall
  // back to video-poster endpoint for screenshot-origin videos, then main src.
  if (m.preview_url) return resolvePublicUrl(m.preview_url)
  if (m.source_kind === "screenshot" && m.media_type === "video" && m.id) {
    return resolvePublicUrl(`/api/screenshots/video-poster/${m.id}`)
  }
  return getPerformerMediaSrc(m)
}

function withCacheBust(url: string): string {
  if (!url) return url
  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}bust=${Date.now()}`
}

/* ── Constants ────────────────────────────────────────────────────────── */

const PLATFORMS = ["OnlyFans", "Twitter/X", "Instagram", "Reddit", "Fansly"] as const

const PLATFORM_COLORS: Record<string, string> = {
  OnlyFans: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  "Twitter/X": "bg-neutral-500/20 text-neutral-300 border-neutral-500/30",
  Instagram: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  Reddit: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  Fansly: "bg-violet-500/20 text-violet-300 border-violet-500/30",
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  inactive: "bg-neutral-500/20 text-neutral-400 border-neutral-500/30",
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  private: "bg-purple-500/20 text-purple-400 border-purple-500/30",
}

const MEDIA_PAGE_SIZE = 18

function parseTags(tags: string | null): string[] {
  if (!tags) return []
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return tags.split(",").map((t) => t.trim()).filter(Boolean)
  }
}

function isVideo(src: string): boolean {
  return /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/i.test(src)
}

/* ── Platform Icon ────────────────────────────────────────────────────── */

function PlatformIcon({ platform }: { platform: string }) {
  const common = "w-4 h-4 shrink-0"
  switch (platform) {
    case "Twitter/X":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      )
    case "Instagram":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="5" /><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      )
    case "Reddit":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm6.67-10a1.46 1.46 0 0 0-2.47-1 7.12 7.12 0 0 0-3.85-1.23l.65-3.07 2.12.45a1.04 1.04 0 1 0 .12-.52l-2.37-.5a.27.27 0 0 0-.32.2l-.72 3.43a7.19 7.19 0 0 0-3.92 1.23 1.46 1.46 0 1 0-1.6 2.39 2.87 2.87 0 0 0 0 .44c0 2.24 2.61 4.06 5.83 4.06s5.83-1.82 5.83-4.06a2.87 2.87 0 0 0 0-.44 1.46 1.46 0 0 0 .89-1.38zM9.5 13a1.04 1.04 0 1 1 0 2.08A1.04 1.04 0 0 1 9.5 13zm5.54 2.83a3.67 3.67 0 0 1-2.54.72 3.67 3.67 0 0 1-2.54-.72.23.23 0 0 1 .32-.33 3.24 3.24 0 0 0 2.22.62 3.24 3.24 0 0 0 2.22-.62.23.23 0 0 1 .32.33zM14.5 15.08a1.04 1.04 0 1 1 0-2.08 1.04 1.04 0 0 1 0 2.08z" />
        </svg>
      )
    default:
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      )
  }
}

/* ── Editable Tags Row ────────────────────────────────────────────────── */

function TagsRow({
  tags,
  onUpdate,
  disabled,
}: {
  tags: string[]
  onUpdate: (tags: string[]) => void
  disabled: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [input, setInput] = useState("")

  function addTag() {
    const val = input.trim()
    if (!val || tags.includes(val)) return
    onUpdate([...tags, val])
    setInput("")
    setAdding(false)
  }

  function removeTag(tag: string) {
    onUpdate(tags.filter((t) => t !== tag))
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span
          key={t}
          className="group inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/5 px-2.5 py-1 text-xs text-text-secondary"
        >
          {t}
          {!disabled && (
            <button
              onClick={() => removeTag(t)}
              className="ml-0.5 hidden rounded-full p-0.5 text-text-muted hover:text-red-400 group-hover:inline-flex"
              aria-label={`Remove tag ${t}`}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
        </span>
      ))}
      {adding ? (
        <div className="inline-flex items-center gap-1">
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTag()
              if (e.key === "Escape") { setAdding(false); setInput("") }
            }}
            className="w-24 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
            placeholder="tag name"
          />
          <button onClick={addTag} className="rounded-lg bg-accent/20 px-2 py-1 text-[10px] text-accent">Add</button>
          <button onClick={() => { setAdding(false); setInput("") }} className="text-[10px] text-text-muted">Cancel</button>
        </div>
      ) : (
        !disabled && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-full border border-dashed border-white/15 px-2.5 py-1 text-[10px] text-text-muted transition-colors hover:border-accent hover:text-accent"
          >
            + Add tag
          </button>
        )
      )}
    </div>
  )
}

/* ── Capture Button ──────────────────────────────────────────────────── */

function CaptureButton({ performerId }: { performerId: number }) {
  const addToast = useAppStore((s) => s.addToast)
  const qc = useQueryClient()

  const { data: queueData } = useCaptureQueueQuery({
    refetchInterval: (query) => {
      const queue = query.state.data?.queue ?? []
      const active = queue.some((e) => e.performer_id === performerId && (e.status === "queued" || e.status === "running"))
      return active ? 3_000 : 30_000
    },
    staleTime: 0,
  })

  const queueEntry = useMemo(
    () => (queueData?.queue ?? []).find((e) => e.performer_id === performerId),
    [queueData, performerId]
  )
  const isActive = queueEntry?.status === "queued" || queueEntry?.status === "running"
  const isDone = queueEntry?.status === "done"

  const prevDoneRef = useRef(false)
  useEffect(() => {
    if (isDone && !prevDoneRef.current) {
      qc.invalidateQueries({ queryKey: ["performer", performerId] })
      qc.invalidateQueries({ queryKey: ["performer-media-infinite", performerId] })
    }
    prevDoneRef.current = !!isDone
  }, [isDone, performerId, qc])

  const mutation = useMutation({
    mutationFn: () => api.capturePerformerMedia(performerId),
    onSuccess: () => {
      addToast("Capture queued", "success")
      qc.invalidateQueries({ queryKey: sharedQueryKeys.captureQueue() })
    },
    onError: () => addToast("Failed to queue capture", "error"),
  })

  return (
    <button
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending || isActive}
      className={cn(
        "flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm transition-colors disabled:opacity-60",
        isActive
          ? "border-accent/30 bg-accent/10 text-accent"
          : isDone
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : "border-white/10 text-text-secondary hover:bg-white/5 hover:text-text-primary"
      )}
    >
      {mutation.isPending || isActive ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : isDone ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      )}
      {mutation.isPending ? "Queuing…" : isActive ? "In Queue" : isDone ? `+${queueEntry?.captured_count ?? 0} captured` : "Capture Content"}
    </button>
  )
}

/* ── Similar Creators ────────────────────────────────────────────────── */

function SimilarCreators({
  performerId,
  onSelect,
}: {
  performerId: number
  onSelect: (id: number) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["similar-performers", performerId],
    queryFn: () => api.similarPerformers(performerId),
    staleTime: 60_000,
  })

  if (isLoading) return <div className="h-4 w-24 animate-pulse rounded bg-white/5" />
  if (!data || data.length === 0) return <p className="text-xs text-text-muted">No similar creators found yet. Add tags to improve matching.</p>

  const PLATFORM_COLORS_LOCAL: Record<string, string> = {
    OnlyFans: "bg-sky-500/20 text-sky-300 border-sky-500/30",
    "Twitter/X": "bg-neutral-500/20 text-neutral-300 border-neutral-500/30",
    Instagram: "bg-pink-500/20 text-pink-300 border-pink-500/30",
    Reddit: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    Fansly: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {data.map((p: Performer) => {
        const pClass = PLATFORM_COLORS_LOCAL[p.platform] ?? "bg-white/10 text-text-secondary border-white/10"
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] p-2.5 text-left transition-colors hover:border-white/15 hover:bg-white/5"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sm font-bold text-text-muted overflow-hidden">
              {getPerformerAvatarSrc(p) ? (
                <img src={getPerformerAvatarSrc(p)} alt={p.username} className="h-full w-full object-cover" />
              ) : (
                p.username.charAt(0).toUpperCase()
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-text-primary">@{p.username}</p>
              <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px]", pClass)}>{p.platform}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

/* ── Refresh Avatar Button ───────────────────────────────────────────── */

function RefreshAvatarButton({ performerId }: { performerId: number }) {
  const addToast = useAppStore((s) => s.addToast)
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => api.enrichPerformer(performerId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["performer", performerId] })
      qc.invalidateQueries({ queryKey: ["performers"] })
      addToast(data.updated ? "Avatar refreshed" : "No new avatar found", data.updated ? "success" : "info")
    },
    onError: () => addToast("Failed to refresh avatar", "error"),
  })

  return (
    <button
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="flex items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary disabled:opacity-40"
      title="Fetch latest avatar from Redgifs"
    >
      {mutation.isPending ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </svg>
      )}
      Refresh Avatar
    </button>
  )
}

/* ── Auto-Link Button ────────────────────────────────────────────────── */

function AutoLinkButton({ performerId }: { performerId: number }) {
  const addToast = useAppStore((s) => s.addToast)
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => api.autoLinkPerformers(),
    onSuccess: (data) => {
      addToast(`Linked ${data.linked} screenshots to ${data.performers_matched} creators`, "success")
      qc.invalidateQueries({ queryKey: ["performer", performerId] })
      qc.invalidateQueries({ queryKey: ["performer-media-infinite", performerId] })
      qc.invalidateQueries({ queryKey: ["screenshots"] })
      qc.invalidateQueries({ queryKey: ["media-stats"] })
    },
    onError: () => addToast("Failed to auto-link media", "error"),
  })

  return (
    <button
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="flex items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary disabled:opacity-40"
    >
      {mutation.isPending ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      )}
      Link Existing Media
    </button>
  )
}

/* ── Add Link Form ────────────────────────────────────────────────────── */

function AddLinkForm({
  performerId,
  onDone,
}: {
  performerId: number
  onDone: () => void
}) {
  const qc = useQueryClient()
  const addToast = useAppStore((s) => s.addToast)
  const [platform, setPlatform] = useState<string>("Twitter/X")
  const [url, setUrl] = useState("")

  const mutation = useMutation({
    mutationFn: () => api.addPerformerLink(performerId, { platform, url: url.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["performer", performerId] })
      addToast("Link added", "success")
      onDone()
    },
    onError: () => addToast("Failed to add link", "error"),
  })

  return (
    <div className="flex items-end gap-2">
      <div>
        <label className="mb-1 block text-[10px] text-text-muted">Platform</label>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-text-secondary focus:border-accent focus:outline-none"
        >
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="flex-1">
        <label className="mb-1 block text-[10px] text-text-muted">URL</label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && url.trim()) mutation.mutate() }}
          placeholder="https://..."
          className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
      </div>
      <button
        onClick={() => mutation.mutate()}
        disabled={!url.trim() || mutation.isPending}
        className="rounded-lg bg-accent/20 px-3 py-1.5 text-xs text-accent hover:bg-accent/30 disabled:opacity-40"
      >
        Add
      </button>
      <button onClick={onDone} className="text-xs text-text-muted hover:text-text-secondary">Cancel</button>
    </div>
  )
}

/* ── Recent Captures ──────────────────────────────────────────────────── */

function RecentCaptures({ performerId, onViewAll }: { performerId: number; onViewAll: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["performer-screenshots-preview", performerId],
    queryFn: () => api.browseScreenshots({ performer_id: performerId, limit: 6, offset: 0 }),
    staleTime: 30_000,
  })

  if (isLoading) return (
    <div className="grid grid-cols-6 gap-1.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="aspect-square rounded-lg bg-white/5 animate-pulse" />
      ))}
    </div>
  )

  const shots = data?.screenshots ?? []
  if (shots.length === 0) return (
    <p className="text-xs text-text-muted italic">No captured shots yet — use Capture to get started.</p>
  )

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-6 gap-1.5">
        {shots.map((shot: Screenshot) => {
          const src = getScreenshotMediaSrc(shot)
          if (!src) return null
          const isVid = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(src)
          return isVid ? (
            <video
              key={shot.id}
              src={src}
              muted
              playsInline
              preload="metadata"
              className="aspect-square w-full rounded-lg object-cover bg-black/20"
            />
          ) : (
            <img
              key={shot.id}
              src={src}
              alt=""
              loading="lazy"
              className="aspect-square w-full rounded-lg object-cover bg-black/20"
            />
          )
        })}
      </div>
      {(data?.total ?? 0) > 0 && (
        <button
          type="button"
          onClick={onViewAll}
          className="text-xs text-accent hover:underline"
        >
          View all {data?.total} captured shots →
        </button>
      )}
    </div>
  )
}

/* ── Capture Activity Sparkline ──────────────────────────────────────── */
function CaptureActivitySparkline({ performerId }: { performerId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["performer-activity", performerId],
    queryFn: () => api.performerActivity(performerId),
    staleTime: 60_000,
  })

  if (isLoading) return <div className="h-10 animate-pulse rounded-lg bg-white/5" />

  const buckets = data?.weeks ?? []
  if (buckets.length === 0 || buckets.every((bucket) => bucket.count === 0)) return null

  const maxVal = Math.max(...buckets.map((bucket) => bucket.count), 1)
  const total = data?.total ?? buckets.reduce((sum, bucket) => sum + bucket.count, 0)
  const avgPerWeek = (total / Math.max(buckets.length, 1)).toFixed(1)

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] text-text-muted">Activity — last 12 weeks</span>
        <span className="text-[10px] text-text-muted">{total} total · {avgPerWeek}/wk</span>
      </div>
      <div className="flex h-10 items-end gap-px">
        {buckets.map((bucket, i) => {
          const count = bucket.count
          const isRecent = i >= buckets.length - 4
          return (
            <div key={i} className="relative flex-1" style={{ height: "100%" }}>
              <div
                className={cn(
                  "absolute bottom-0 w-full rounded-t-sm transition-colors",
                  count === 0
                    ? "bg-white/5"
                    : isRecent
                    ? "bg-accent/60 hover:bg-accent/80"
                    : "bg-accent/35 hover:bg-accent/55"
                )}
                style={{ height: count > 0 ? `${Math.max((count / maxVal) * 100, 10)}%` : "2px" }}
                title={`${bucket.week}: ${count} capture${count !== 1 ? "s" : ""}`}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Media Gallery ────────────────────────────────────────────────────── */

type MediaFilter = "all" | "photo" | "video"
type ProfileSection = "overview" | "media"

function MediaGallery({
  performerId,
  onOpenLightbox,
}: {
  performerId: number
  onOpenLightbox: (media: PerformerMedia[], idx: number) => void
}) {
  const [filter, setFilter] = useState<MediaFilter>("all")

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["performer-media-infinite", performerId, filter],
    queryFn: ({ pageParam = 0 }) =>
      api.browsePerformerMedia(performerId, {
        limit: MEDIA_PAGE_SIZE,
        offset: pageParam as number,
        ...(filter !== "all" ? { media_type: filter } : {}),
      }),
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.offset + lastPage.items.length : undefined,
    initialPageParam: 0,
    staleTime: 30_000,
  })

  const allMedia = data?.pages.flatMap((p) => p.items) ?? []
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Infinite scroll observer
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1, rootMargin: "400px 0px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const total = data?.pages[0]?.total ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-xl border border-white/8 bg-white/[0.02] p-1">
          {(["all", "photo", "video"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs transition-colors capitalize",
                filter === f
                  ? "bg-white/10 text-text-primary font-medium"
                  : "text-text-muted hover:text-text-secondary"
              )}
            >
              {f === "all" ? `All (${total})` : f}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} variant="image" height="120px" />
          ))}
        </div>
      ) : allMedia.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-white/8 bg-white/[0.02] py-10">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-2 text-text-muted">
            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
          </svg>
          <p className="text-xs text-text-muted">No media found</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {allMedia.map((m, i) => {
            const src = getPerformerMediaSrc(m)
            const previewSrc = getPerformerMediaPreviewSrc(m)
            const isVid = m.media_type === "video" || (src ? isVideo(src) : false)
            const key = `${m.source_kind ?? "m"}-${m.id}`
            return (
              <button
                key={key}
                onClick={() => onOpenLightbox(allMedia, i)}
                className="group relative aspect-square overflow-hidden rounded-lg bg-white/5 transition-all hover:ring-2 hover:ring-accent/50"
              >
                {src ? (
                  isVid ? (
                    previewSrc && previewSrc !== src ? (
                      <img
                        src={previewSrc}
                        alt={m.caption ?? ""}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          const img = e.currentTarget
                          if (!img.dataset.retried) {
                            img.dataset.retried = "1"
                            img.src = withCacheBust(previewSrc)
                          } else {
                            img.style.visibility = "hidden"
                          }
                        }}
                      />
                    ) : (
                      <video
                        src={src}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          const v = e.currentTarget
                          if (!v.dataset.retried) {
                            v.dataset.retried = "1"
                            v.src = withCacheBust(src)
                            v.load()
                          }
                        }}
                      />
                    )
                  ) : (
                    <img
                      src={src}
                      alt={m.caption ?? ""}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        const img = e.currentTarget
                        if (!img.dataset.retried) {
                          img.dataset.retried = "1"
                          img.src = withCacheBust(src)
                        } else {
                          img.style.visibility = "hidden"
                        }
                      }}
                    />
                  )
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-text-muted">
                    {isVid ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                    )}
                  </div>
                )}
                {isVid && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="rounded-full bg-black/60 p-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-white"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                    </div>
                  </div>
                )}
                {m.is_favorite === 1 && (
                  <div className="absolute top-1 right-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-rose-400">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                    </svg>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />
              </button>
            )
          })}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-4" />
      {isFetchingNextPage && (
        <div className="flex justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      )}
    </div>
  )
}

/* ── Simple Media Lightbox for performer media ────────────────────────── */

function PerformerMediaLightbox({
  media,
  idx,
  onClose,
  onNavigate,
}: {
  media: PerformerMedia[]
  idx: number
  onClose: () => void
  onNavigate: (idx: number) => void
}) {
  const item = media[idx]
  const src = getPerformerMediaSrc(item)
  const currentIsVideo = item.media_type === "video" || (src ? isVideo(src) : false)

  const onCloseRef = useRef(onClose)
  const onNavigateRef = useRef(onNavigate)
  const idxRef = useRef(idx)
  const lenRef = useRef(media.length)

  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => { onNavigateRef.current = onNavigate }, [onNavigate])
  useEffect(() => { idxRef.current = idx }, [idx])
  useEffect(() => { lenRef.current = media.length }, [media.length])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current()
      else if (e.key === "ArrowLeft" && idxRef.current > 0) onNavigateRef.current(idxRef.current - 1)
      else if (e.key === "ArrowRight" && idxRef.current < lenRef.current - 1) onNavigateRef.current(idxRef.current + 1)
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Media lightbox"
      className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-lg flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-30 rounded-full bg-white/10 p-2 text-white/60 transition-colors hover:text-white"
        aria-label="Close"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>

      {/* Counter */}
      <span className="absolute top-5 left-5 z-30 text-xs font-mono text-white/40">{idx + 1} / {media.length}</span>

      {/* Nav */}
      {idx > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(idx - 1) }}
          className="absolute left-4 z-30 rounded-full bg-white/10 p-2 text-white/60 hover:text-white"
          aria-label="Previous"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
      )}
      {idx < media.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(idx + 1) }}
          className="absolute right-4 z-30 rounded-full bg-white/10 p-2 text-white/60 hover:text-white"
          aria-label="Next"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      )}

      {/* Media */}
      <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] max-w-[95vw]">
        {currentIsVideo ? (
          <video
            key={src}
            src={src ?? undefined}
            autoPlay
            loop
            playsInline
            controls
            className="max-h-[90vh] max-w-[95vw] object-contain rounded-lg"
            onError={(e) => {
              const v = e.currentTarget
              if (!v.dataset.retried && src) {
                v.dataset.retried = "1"
                v.src = withCacheBust(src)
                v.load()
              }
            }}
          />
        ) : (
          <img
            key={src}
            src={src ?? ""}
            alt={item.caption ?? ""}
            className="max-h-[90vh] max-w-[95vw] object-contain rounded-lg select-none"
            draggable={false}
            onError={(e) => {
              const img = e.currentTarget
              if (!img.dataset.retried && src) {
                img.dataset.retried = "1"
                img.src = withCacheBust(src)
              }
            }}
          />
        )}
      </div>

      {/* Caption */}
      {item.caption && (
        <div className="absolute bottom-6 inset-x-0 flex justify-center px-6">
          <p className="max-w-xl rounded-lg bg-black/60 backdrop-blur-md px-4 py-2 text-sm text-white/70 line-clamp-3">
            {item.caption}
          </p>
        </div>
      )}
    </div>,
    document.body
  )
}

/* ── Main Profile Component ───────────────────────────────────────────── */

interface PerformerProfileProps {
  performerId: number
  onClose: () => void
  onNavigate?: (id: number) => void
}

export function PerformerProfile({ performerId, onClose, onNavigate }: PerformerProfileProps) {
  const qc = useQueryClient()
  const addToast = useAppStore((s) => s.addToast)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setMediaCreator = useAppStore((s) => s.setMediaCreator)

  // Fetch full performer detail
  const { data: performer, isLoading } = useQuery({
    queryKey: ["performer", performerId],
    queryFn: () => api.getPerformer(performerId),
    staleTime: 15_000,
  })

  // Editing states
  const [editing, setEditing] = useState(false)
  const [editDisplayName, setEditDisplayName] = useState("")
  const [editBio, setEditBio] = useState("")
  const [notes, setNotes] = useState("")
  const [showAddLink, setShowAddLink] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [profileSection, setProfileSection] = useState<ProfileSection>("overview")

  // Lightbox
  const [lightbox, setLightbox] = useState<{ media: PerformerMedia[]; idx: number } | null>(null)

  // Auto-save notes debounce
  const notesTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const notesInitializedRef = useRef(false)

  // Sync state when performer loads
  useEffect(() => {
    if (!performer) return
    setEditDisplayName(performer.display_name ?? "")
    setEditBio(performer.bio ?? "")
    if (!notesInitializedRef.current) {
      setNotes(performer.notes ?? "")
      notesInitializedRef.current = true
    }
  }, [performer])

  // Notes auto-save
  useEffect(() => {
    if (!notesInitializedRef.current || !performer) return
    if (notes === (performer.notes ?? "")) return

    if (notesTimerRef.current) clearTimeout(notesTimerRef.current)
    notesTimerRef.current = setTimeout(() => {
      api.updatePerformer(performer.id, { notes }).then(() => {
        qc.invalidateQueries({ queryKey: ["performer", performerId] })
      })
    }, 500)
    return () => { if (notesTimerRef.current) clearTimeout(notesTimerRef.current) }
  }, [notes, performer, performerId, qc])

  // Mutations
  const updateMutation = useMutation({
    mutationFn: (updates: Parameters<typeof api.updatePerformer>[1]) =>
      api.updatePerformer(performerId, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["performer", performerId] })
      qc.invalidateQueries({ queryKey: ["performers"] })
      addToast("Updated", "success")
    },
    onError: () => addToast("Update failed", "error"),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.deletePerformer(performerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["performers"] })
      qc.invalidateQueries({ queryKey: ["performer-stats"] })
      addToast("Creator deleted", "success")
      onClose()
    },
    onError: () => addToast("Failed to delete", "error"),
  })

  const deleteLinkMutation = useMutation({
    mutationFn: (linkId: number) => api.deletePerformerLink(performerId, linkId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["performer", performerId] })
      addToast("Link removed", "success")
    },
  })

  const favMutation = useMutation({
    mutationFn: () => api.updatePerformer(performerId, { is_favorite: performer?.is_favorite ? 0 : 1 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["performer", performerId] })
      qc.invalidateQueries({ queryKey: ["performers"] })
      qc.invalidateQueries({ queryKey: ["performer-stats"] })
    },
  })

  // Save edits
  const saveEdits = useCallback(() => {
    if (!performer) return
    updateMutation.mutate({
      display_name: editDisplayName.trim() || null,
      bio: editBio.trim() || null,
    })
    setEditing(false)
  }, [performer, editDisplayName, editBio, updateMutation])

  // Update tags
  const handleTagUpdate = useCallback(
    (newTags: string[]) => {
      updateMutation.mutate({ tags: JSON.stringify(newTags) } as Parameters<typeof api.updatePerformer>[1])
    },
    [updateMutation]
  )

  // Export as JSON
  const handleExport = useCallback(() => {
    if (!performer) return
    const blob = new Blob([JSON.stringify(performer, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${performer.username}_${performer.platform}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [performer])

  // Keyboard close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !lightbox) onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose, lightbox])

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = "" }
  }, [])

  if (isLoading || !performer) {
    return createPortal(
      <div className="fixed inset-0 z-50 bg-[#0a1628]/95 backdrop-blur-lg flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>,
      document.body
    )
  }

  const tags = parseTags(performer.tags)
  const platformClass = PLATFORM_COLORS[performer.platform] ?? "bg-white/10 text-text-secondary border-white/10"
  const statusClass = STATUS_COLORS[performer.status] ?? STATUS_COLORS.inactive
  const capturedCount = performer.media_count_actual ?? performer.media_count ?? 0
  const renewalSummary = (() => {
    try {
      if (performer.is_subscribed !== 1 || !performer.subscription_renewed_at) return null
      const renewed = new Date(performer.subscription_renewed_at)
      if (Number.isNaN(renewed.getTime())) return null
      const nextRenewal = new Date(renewed.getTime() + 30 * 24 * 60 * 60 * 1000)
      const daysUntil = Math.round((nextRenewal.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      return { nextRenewal, daysUntil }
    } catch {
      return null
    }
  })()
  const renewalText = renewalSummary
    ? renewalSummary.daysUntil < 0 ? `Subscription overdue by ${Math.abs(renewalSummary.daysUntil)}d`
      : renewalSummary.daysUntil === 0 ? "Renews today"
      : renewalSummary.daysUntil <= 7 ? `Renews in ${renewalSummary.daysUntil}d`
      : `Next renewal ${renewalSummary.nextRenewal.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : performer.is_subscribed === 1 ? "Subscribed and tracked" : "Not subscribed"
  const profileSnapshot = [
    capturedCount > 0 ? `${capturedCount.toLocaleString()} media captured` : "No captured media yet",
    performer.last_checked_at
      ? `Last checked ${(() => {
          const days = Math.floor((Date.now() - new Date(performer.last_checked_at).getTime()) / 86_400_000)
          return days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`
        })()}`
      : "Never checked",
    renewalText,
  ].join(" · ")

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0a1628]/98 backdrop-blur-lg">
      {/* Top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-white/8 bg-[#0a1628]/80 backdrop-blur-lg px-6 py-3">
        <button
          onClick={onClose}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
          Back
        </button>
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary"
          aria-label="Close profile"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-8 space-y-8">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="hero-surface rounded-[28px] px-5 py-5 sm:px-6 sm:py-6">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          {/* Avatar */}
          <div className="relative h-32 w-32 shrink-0 overflow-hidden rounded-full bg-white/10 ring-4 ring-white/5">
            {getPerformerAvatarSrc(performer) ? (
              <>
                <img
                  src={getPerformerAvatarSrc(performer)}
                  alt={performer.username}
                  className="h-full w-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = "none"; const sib = e.currentTarget.nextElementSibling as HTMLElement; if (sib) sib.style.display = "flex" }}
                />
                <div className="h-full w-full items-center justify-center text-4xl font-bold text-text-muted" style={{ display: "none" }}>
                  {performer.username.charAt(0).toUpperCase()}
                </div>
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-4xl font-bold text-text-muted">
                {performer.username.charAt(0).toUpperCase()}
              </div>
            )}
            {performer.status === "active" && (
              <span className="absolute bottom-2 right-2 h-4 w-4 rounded-full border-2 border-[#0a1628] bg-emerald-400" title="Active" />
            )}
          </div>

          {/* Info */}
          <div className="flex-1 text-center sm:text-left space-y-3">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <span className="ui-chip ui-chip-active !px-2.5 !py-1">Profile overview</span>
              <span className="ui-chip !px-2.5 !py-1">{performer.platform}</span>
              <span className="ui-chip !px-2.5 !py-1">{performer.status}</span>
              {performer.last_checked_at && (
                <span className="ui-chip !px-2.5 !py-1">
                  Checked {(() => {
                    const days = Math.floor(
                      (Date.now() - new Date(performer.last_checked_at).getTime()) / 86_400_000
                    )
                    return days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`
                  })()}
                </span>
              )}
            </div>
            <div>
              {editing ? (
                <div className="space-y-2">
                  <input
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-lg font-semibold text-text-primary focus:border-accent focus:outline-none"
                    placeholder="Display name"
                  />
                </div>
              ) : (
                <>
                  <h1 className="text-2xl font-bold text-text-primary">@{performer.username}</h1>
                  {performer.display_name && (
                    <p className="text-sm text-text-secondary">{performer.display_name}</p>
                  )}
                </>
              )}
            </div>
            <p className="max-w-2xl text-sm leading-6 text-slate-300">
              Manage the creator, keep capture links fresh, and review recent media without losing the bigger context around this profile.
            </p>

            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Profile snapshot</p>
              <p className="mt-1 text-sm leading-6 text-slate-200">{profileSnapshot}</p>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap items-center gap-2 justify-center sm:justify-start">
              <span className={cn("rounded-full border px-3 py-1 text-xs font-medium", platformClass)}>
                {performer.platform}
              </span>
              <select
                value={performer.status}
                onChange={(e) => updateMutation.mutate({ status: e.target.value } as Parameters<typeof api.updatePerformer>[1])}
                className={cn("rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider bg-transparent cursor-pointer focus:outline-none", statusClass)}
                title="Change status"
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="pending">pending</option>
                <option value="private">private</option>
              </select>
              {performer.is_verified === 1 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[10px] text-accent">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" /></svg>
                  Verified
                </span>
              )}
              {performer.is_subscribed === 1 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] text-emerald-400">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" /></svg>
                  {performer.subscription_price != null ? `Subscribed · $${performer.subscription_price}/mo` : "Subscribed"}
                </span>
              )}
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4 justify-center sm:justify-start">
              {performer.follower_count != null && (
                <div className="text-center">
                  <p className="text-lg font-semibold text-text-primary">{performer.follower_count.toLocaleString()}</p>
                  <p className="text-[10px] text-text-muted uppercase tracking-wider">Followers</p>
                </div>
              )}
              {performer.media_count != null && (
                <div className="text-center">
                  <p className="text-lg font-semibold text-text-primary">{performer.media_count.toLocaleString()}</p>
                  <p className="text-[10px] text-text-muted uppercase tracking-wider">Media</p>
                </div>
              )}
              {performer.media_total != null && (
                <div className="text-center">
                  <p className="text-lg font-semibold text-text-primary">{performer.media_total.toLocaleString()}</p>
                  <p className="text-[10px] text-text-muted uppercase tracking-wider">Captured</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 justify-center sm:justify-start">
              <button
                onClick={() => favMutation.mutate()}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                  performer.is_favorite
                    ? "bg-rose-500/15 text-rose-400 hover:bg-rose-500/25"
                    : "border border-white/10 text-text-secondary hover:bg-white/5 hover:text-text-primary"
                )}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={performer.is_favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.75">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                {performer.is_favorite ? "Favorited" : "Favorite"}
              </button>
              <CaptureButton performerId={performerId} />
              <AutoLinkButton performerId={performerId} />
              <RefreshAvatarButton performerId={performerId} />
              <button
                onClick={() => {
                  if (editing) saveEdits()
                  else setEditing(true)
                }}
                className="flex items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                {editing ? "Save" : "Edit"}
              </button>
              {performer.profile_url && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(performer.profile_url!)
                    addToast("URL copied", "success")
                  }}
                  className="flex items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
                  title="Copy profile URL to clipboard"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy URL
                </button>
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {(["overview", "media"] as const).map((section) => (
                <button
                  key={section}
                  onClick={() => setProfileSection(section)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors",
                    profileSection === section
                      ? "border-accent/30 bg-accent/10 text-accent"
                      : "border-white/10 bg-white/5 text-text-muted hover:text-text-primary hover:bg-white/10"
                  )}
                >
                  {section === "overview" ? "Overview" : "Media"}
                </button>
              ))}
            </div>
          </div>
        </div>
        </div>

        {profileSection === "overview" ? (
          <div className="space-y-8">
            <section>
              <h2 className="mb-2 text-[11px] font-medium text-text-muted uppercase tracking-wider">Quick Stats</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
                  <p className="text-[10px] text-text-muted">Total Media</p>
                  <p className="mt-1 text-lg font-semibold text-text-primary">
                    {performer.media_count_actual ?? performer.media_count ?? 0}
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
                  <p className="text-[10px] text-text-muted">Captured Shots</p>
                  <p className="mt-1 text-lg font-semibold text-text-primary">
                    {performer.screenshots_count ?? 0}
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
                  <p className="text-[10px] text-text-muted">First Tracked</p>
                  <p className="mt-1 text-sm font-medium text-text-primary">
                    {performer.first_seen_at
                      ? new Date(performer.first_seen_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                      : "--"}
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
                  <p className="text-[10px] text-text-muted">Last Checked</p>
                  <p className="mt-1 text-sm font-medium text-text-primary">
                    {performer.last_checked_at
                      ? (() => {
                          const days = Math.floor(
                            (Date.now() - new Date(performer.last_checked_at).getTime()) / 86_400_000
                          )
                          return days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days}d ago`
                        })()
                      : "Never"}
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
                  <p className="text-[10px] text-text-muted">Platform Links</p>
                  <p className="mt-1 text-lg font-semibold text-text-primary">
                    {(performer.link_count ?? performer.links?.length ?? 0) + (performer.profile_url ? 1 : 0)}
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[11px] font-medium text-text-muted uppercase tracking-wider">Activity</h2>
              <CaptureActivitySparkline performerId={performer.id} />
            </section>

            <section>
              <h2 className="mb-2 text-[11px] font-medium text-text-muted uppercase tracking-wider">Tags</h2>
              <TagsRow tags={tags} onUpdate={handleTagUpdate} disabled={false} />
            </section>

            <section>
              <h2 className="mb-2 text-[11px] font-medium text-text-muted uppercase tracking-wider">Bio</h2>
              {editing ? (
                <textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none resize-none"
                  placeholder="Bio..."
                />
              ) : performer.bio ? (
                <p className="text-sm leading-relaxed text-text-secondary whitespace-pre-wrap">{performer.bio}</p>
              ) : (
                <p className="text-sm text-text-muted italic">No bio</p>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Platform Links</h2>
                <button
                  onClick={() => setShowAddLink(true)}
                  className="rounded-lg border border-dashed border-white/15 px-2.5 py-1 text-[10px] text-text-muted transition-colors hover:border-accent hover:text-accent"
                >
                  + Add link
                </button>
              </div>

              {performer.profile_url && (
                <a
                  href={performer.profile_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-2 flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-sm text-accent transition-colors hover:bg-white/5"
                >
                  <PlatformIcon platform={performer.platform} />
                  <span className="truncate">{performer.profile_url}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-text-muted">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              )}

              {performer.links && performer.links.length > 0 && (
                <div className="space-y-1.5">
                  {performer.links.map((link: PerformerLink) => (
                    <div key={link.id} className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
                      <PlatformIcon platform={link.platform} />
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 truncate text-sm text-accent hover:underline"
                      >
                        {link.username ? `@${link.username}` : link.url}
                      </a>
                      <span className="text-[10px] text-text-muted">{link.platform}</span>
                      <button
                        onClick={() => deleteLinkMutation.mutate(link.id)}
                        className="rounded p-1 text-text-muted transition-colors hover:text-red-400"
                        aria-label="Remove link"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showAddLink && (
                <div className="mt-2">
                  <AddLinkForm performerId={performer.id} onDone={() => setShowAddLink(false)} />
                </div>
              )}

              {!performer.profile_url && (!performer.links || performer.links.length === 0) && !showAddLink && (
                <p className="text-sm text-text-muted italic">No links</p>
              )}
            </section>

            <section>
              <h2 className="mb-2 text-[11px] font-medium text-text-muted uppercase tracking-wider">Notes</h2>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none resize-none"
                placeholder="Private notes... (auto-saves)"
              />
              <p className="mt-1 text-[10px] text-text-muted">Auto-saves after 500ms</p>
            </section>

            <section>
              <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Subscription</h3>
                <div className="flex flex-wrap gap-3">
                  <label className="flex flex-col gap-1 text-[10px] text-text-muted">
                    Price ($/mo)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={performer.subscription_price ?? ""}
                      onBlur={(e) => {
                        const val = e.target.value === "" ? null : parseFloat(e.target.value)
                        updateMutation.mutate({ subscription_price: val } as Parameters<typeof api.updatePerformer>[1])
                      }}
                      className="w-24 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-text-primary"
                      placeholder="e.g. 9.99"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[10px] text-text-muted">
                    Status
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="checkbox"
                        defaultChecked={performer.is_subscribed === 1}
                        onChange={(e) => updateMutation.mutate({ is_subscribed: e.target.checked ? 1 : 0 } as Parameters<typeof api.updatePerformer>[1])}
                        className="h-4 w-4 rounded accent-accent"
                      />
                      <span className="text-xs text-text-secondary">Subscribed</span>
                    </div>
                  </label>
                  <div className="flex flex-col gap-1 text-[10px] text-text-muted">
                    Last renewed
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-text-secondary">
                        {performer.subscription_renewed_at
                          ? new Date(performer.subscription_renewed_at).toLocaleDateString()
                          : <span className="italic text-text-muted">not set</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateMutation.mutate({ subscription_renewed_at: new Date().toISOString() } as Parameters<typeof api.updatePerformer>[1])}
                        className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                      >
                        Set today
                      </button>
                      {performer.subscription_renewed_at && (() => {
                        const renewed = new Date(performer.subscription_renewed_at)
                        const nextRenewal = new Date(renewed.getTime() + 30 * 24 * 60 * 60 * 1000)
                        const daysUntil = Math.round((nextRenewal.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                        if (daysUntil < 0) return (
                          <span className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-medium text-red-400">
                            overdue {Math.abs(daysUntil)}d
                          </span>
                        )
                        if (daysUntil <= 7) return (
                          <span className="rounded border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 text-[9px] font-medium text-orange-400">
                            renews in {daysUntil}d
                          </span>
                        )
                        return (
                          <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] text-text-muted">
                            next: {nextRenewal.toLocaleDateString()}
                          </span>
                        )
                      })()}
                    </div>
                  </div>
                  <label className="flex flex-col gap-1 text-[10px] text-text-muted">
                    Reddit username
                    <input
                      type="text"
                      defaultValue={performer.reddit_username ?? ""}
                      onBlur={(e) => { if (e.target.value !== (performer.reddit_username ?? "")) updateMutation.mutate({ reddit_username: e.target.value || null } as Parameters<typeof api.updatePerformer>[1]) }}
                      className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-text-primary"
                      placeholder="u/username"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[10px] text-text-muted">
                    Twitter/X handle
                    <input
                      type="text"
                      defaultValue={performer.twitter_username ?? ""}
                      onBlur={(e) => { if (e.target.value !== (performer.twitter_username ?? "")) updateMutation.mutate({ twitter_username: e.target.value || null } as Parameters<typeof api.updatePerformer>[1]) }}
                      className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-text-primary"
                      placeholder="@handle"
                    />
                  </label>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <div className="space-y-8">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Recent Captures</h2>
              </div>
              <div className="space-y-3">
                <CaptureActivitySparkline performerId={performer.id} />
                <RecentCaptures
                  performerId={performer.id}
                  onViewAll={() => {
                    setMediaCreator(performer.id, performer.username)
                    setActiveView("images")
                  }}
                />
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-[11px] font-medium text-text-muted uppercase tracking-wider">Similar Creators</h2>
              <SimilarCreators
                performerId={performer.id}
                onSelect={(id) => onNavigate ? onNavigate(id) : undefined}
              />
            </section>

            <section>
              <h2 className="mb-3 text-[11px] font-medium text-text-muted uppercase tracking-wider">Media</h2>
              <MediaGallery
                performerId={performer.id}
                onOpenLightbox={(media, idx) => setLightbox({ media, idx })}
              />
            </section>
          </div>
        )}

        {/* ── Action Bar ──────────────────────────────────────────────── */}
        <section className="flex items-center gap-3 border-t border-white/8 pt-6">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-red-400">Are you sure?</span>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="rounded-xl bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30"
              >
                {deleteMutation.isPending ? "Deleting..." : "Yes, delete"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-text-secondary"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/20"
            >
              Delete Creator
            </button>
          )}
          <button
            onClick={handleExport}
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
          >
            Export JSON
          </button>
        </section>

        {/* Bottom spacer */}
        <div className="h-8" />
      </div>

      {/* Lightbox */}
      {lightbox && (
        <PerformerMediaLightbox
          media={lightbox.media}
          idx={lightbox.idx}
          onClose={() => setLightbox(null)}
          onNavigate={(idx) => setLightbox((prev) => prev ? { ...prev, idx } : null)}
        />
      )}
    </div>,
    document.body
  )
}
