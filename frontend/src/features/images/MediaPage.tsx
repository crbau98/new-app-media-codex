import { useState, useCallback, useRef, useMemo, useEffect, memo, lazy, Suspense, useDeferredValue, startTransition } from "react"
import { createPortal } from "react-dom"
import { useWindowVirtualizer } from "@tanstack/react-virtual"
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, type Screenshot, type ScreenshotTerm, type Performer, type Playlist, type MediaStatsPayload, type UserTagCount, type DiscoveredCreator } from "@/lib/api"

import { useAppStore } from "@/store"
import { Spinner } from "@/components/Spinner"
import { SkeletonGrid } from "@/components/Skeleton"
import { EmptyState } from "@/components/EmptyState"
import { StarRating } from "@/components/StarRating"
import { cn } from "@/lib/cn"
import { getPerformerAvatarSrc } from "@/lib/performer"
import { getBestAvailablePreviewSrc, getMediaDebugLabel, getScreenshotMediaSrc, isVideoShot, useResolvedScreenshotMedia } from "@/lib/media"
import { consumeNavigationIntent } from "@/components/TopBar"

const MEDIA_NAVIGATION_EVENT = "codex:media-navigation"

const loadMediaAnalyticsDashboard = () =>
  import("./MediaAnalyticsDashboard").then((m) => ({ default: m.MediaAnalyticsDashboard }))
const MediaAnalyticsDashboard = lazy(loadMediaAnalyticsDashboard)
const preloadMediaLightbox = () => import("./ScreenshotLightbox")
const preloadInlineVideoPlayer = () => import("./InlineVideoPlayer")
const preloadPlaylistPanel = () => import("./PlaylistPanel")
const preloadSlideshowMode = () => import("./SlideshowMode")
const preloadMediaContextMenu = () => import("./MediaContextMenu")
const preloadVideoFeed = () => import("./VideoFeed")
const preloadMediaCreatorsPanel = () => import("./MediaCreatorsPanel")
const MediaDiscoveryPanel = lazy(() => import("./MediaDiscoveryPanel").then((m) => ({ default: m.MediaDiscoveryPanel })))
const MediaCreatorsPanel = lazy(() => import("./MediaCreatorsPanel").then((m) => ({ default: m.MediaCreatorsPanel })))
const ScreenshotLightbox = lazy(() => import("./ScreenshotLightbox").then((m) => ({ default: m.ScreenshotLightbox })))
const InlineVideoPlayer = lazy(() => import("./InlineVideoPlayer").then((m) => ({ default: m.InlineVideoPlayer })))
const PlaylistDropdown = lazy(() => import("./PlaylistPanel").then((m) => ({ default: m.PlaylistDropdown })))
const AddToPlaylistDropdown = lazy(() => import("./PlaylistPanel").then((m) => ({ default: m.AddToPlaylistDropdown })))
const CreatePlaylistModal = lazy(() => import("./PlaylistPanel").then((m) => ({ default: m.CreatePlaylistModal })))
const PlaylistHeader = lazy(() => import("./PlaylistPanel").then((m) => ({ default: m.PlaylistHeader })))
const SlideshowMode = lazy(() => import("./SlideshowMode").then((m) => ({ default: m.SlideshowMode })))
const MediaContextMenu = lazy(() => import("./MediaContextMenu").then((m) => ({ default: m.MediaContextMenu })))
const MediaListItem = lazy(() => import("./MediaListItem").then((m) => ({ default: m.MediaListItem })))
const VideoFeed = lazy(() => import("./VideoFeed").then((m) => ({ default: m.VideoFeed })))

// ── Helpers ──────────────────────────────────────────────────────────────────

function readTermFromHash(): string | null {
  const hash = window.location.hash
  const qIdx = hash.indexOf("?")
  if (qIdx === -1) return null
  return new URLSearchParams(hash.slice(qIdx + 1)).get("term") || null
}

function writeTermToHash(term: string | null) {
  const basePath = window.location.hash.split("?")[0] || "#/media"
  if (term) window.location.hash = `${basePath}?term=${encodeURIComponent(term)}`
  else window.location.hash = basePath
}

function consumeMediaNavigationIntent(): { query?: string; term?: string; tag?: string } | null {
  return consumeNavigationIntent()
}

function clearMediaNavigationIntent() {
  // No-op: intent is consumed on first read from module-level variable
}

type ShotClientMeta = {
  isVideo: boolean
  searchText: string
}

function buildShotClientMeta(shot: Screenshot): ShotClientMeta {
  const src = getScreenshotMediaSrc(shot)
  return {
    isVideo: isVideoShot(shot),
    searchText: [shot.term, shot.source, shot.page_url, shot.ai_summary ?? ""].join(" ").toLowerCase(),
  }
}


function isVideo(src: string) {
  return /\.(mp4|webm|mov)/i.test(src)
}

function isGif(src: string) {
  return /\.gif$/i.test(src)
}


function sourceLabel(s: string) {
  if (s === "ddg") return "DDG"
  if (s === "redgifs") return "Redgifs"
  if (s === "x") return "X"
  if (s === "ytdlp") return "Tube"
  if (s === "telegram") return "Telegram"
  return s
}

function parseUserTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : []
  } catch { return [] }
}

function parseAiTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    const result: string[] = []
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      for (const v of Object.values(parsed)) {
        if (typeof v === "string") result.push(v)
        else if (Array.isArray(v)) {
          for (const x of v) { if (typeof x === "string") result.push(x) }
        }
      }
    } else if (Array.isArray(parsed)) {
      for (const x of parsed) { if (typeof x === "string") result.push(x) }
    }
    return result
  } catch { return [] }
}

type SortOrder = "newest" | "oldest" | "az" | "rating" | "random"
type TabFilter = "all" | "ddg" | "redgifs" | "tube" | "favorites" | "videos" | "images" | "creators" | "rated"
type GridDensity = "compact" | "normal" | "spacious"
type ViewMode = "grid" | "list" | "timeline" | "feed" | "mosaic"
// Simplified defaults
const DEFAULT_GRID_DENSITY: GridDensity = "normal"
const SIMPLIFIED_VIEW_MODES: ViewMode[] = ["grid", "feed"]
type SearchSuggestion =
  | { type: "term"; value: string; meta?: string }
  | { type: "tag"; value: string; meta?: string }
  | { type: "creator"; value: string; meta?: string }


function getTimelineGroup(dateStr: string | undefined): string {
  if (!dateStr) return "Older"
  const d = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)
  const monthAgo = new Date(today)
  monthAgo.setMonth(monthAgo.getMonth() - 1)

  if (d >= today) return "Today"
  if (d >= yesterday) return "Yesterday"
  if (d >= weekAgo) return "This Week"
  if (d >= monthAgo) return "This Month"
  return "Older"
}

const GRID_CLASSES: Record<GridDensity, string> = {
  compact: "grid-cols-4 sm:grid-cols-5 lg:grid-cols-7 gap-0.5",
  normal: "grid-cols-3 sm:grid-cols-4 lg:grid-cols-4 gap-1",
  spacious: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2",
}

const GRID_COLS: Record<GridDensity, number> = {
  compact: 7,
  normal: 4,
  spacious: 4,
}

const GRID_ROW_SIZE_ESTIMATE: Record<GridDensity, number> = {
  compact: 128,
  normal: 168,
  spacious: 208,
}
const MOSAIC_BATCH_SIZE = 24

function getInitialMosaicVisibleCount() {
  if (typeof window === "undefined") return MOSAIC_BATCH_SIZE
  const width = window.innerWidth
  const height = window.innerHeight
  const columns = width >= 1400 ? 5 : width >= 1025 ? 4 : width >= 641 ? 3 : 2
  const estimatedRows = Math.max(3, Math.ceil(height / 220) + 2)
  return Math.max(MOSAIC_BATCH_SIZE, columns * estimatedRows * 2)
}

function estimateGridSectionHeight(itemCount: number, colCount: number, density: GridDensity) {
  const rows = Math.max(1, Math.ceil(itemCount / Math.max(colCount, 1)))
  return 56 + rows * GRID_ROW_SIZE_ESTIMATE[density]
}


function MediaUnavailableTile({
  title,
  detail,
  statusLabel = "Media unavailable",
  className,
}: {
  title: string
  detail: string
  statusLabel?: string
  className?: string
}) {
  return (
    <div className={cn("flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg bg-white/[0.06] px-3 text-center", className)}>
      <div className="rounded-full border border-amber-400/30 bg-amber-500/15 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.22em] text-amber-200">
        {statusLabel}
      </div>
      <div className="max-w-full space-y-1">
        <p className="text-xs font-medium text-white/80">{title}</p>
        <p className="truncate text-[10px] text-amber-100/70" title={detail}>{detail}</p>
      </div>
    </div>
  )
}

function InlineLoadingFallback({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <div className={cn("flex items-center justify-center rounded-2xl border border-white/10 bg-black/20 px-4 py-8 text-sm text-slate-400", className)}>
      <Spinner />
      <span className="ml-2">{label}</span>
    </div>
  )
}

// ── View History ──────────────────────────────────────────────────────────────


// ── MediaStatsBar ────────────────────────────────────────────────────────────

function MediaStatsBar({ stats }: { stats: MediaStatsPayload | undefined }) {
  if (!stats) return null
  return null // Stats moved to sidebar; keeping component for API compatibility
}

// ── TermBrowser ──────────────────────────────────────────────────────────────

const TermBrowser = memo(function TermBrowser({
  terms,
  activeTerm,
  onSelect,
}: {
  terms: { term: string; count: number }[]
  activeTerm: string | null
  onSelect: (term: string | null) => void
}) {
  const [termSearch, setTermSearch] = useState("")
  const [expanded, setExpanded] = useState(false)
  const [sectionOpen, setSectionOpen] = useState(false)
  const deferredTermSearch = useDeferredValue(termSearch)

  if (terms.length === 0) return null

  const lc = deferredTermSearch.toLowerCase()
  const filtered = lc ? terms.filter((t) => t.term.toLowerCase().includes(lc)) : terms
  const visible = expanded ? filtered : filtered.slice(0, 60)
  const hasMore = filtered.length > 60 && !expanded

  return (
    <div className="border-b border-white/5 px-4 py-1.5">
      <button
        onClick={() => setSectionOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cn("transition-transform", sectionOpen ? "rotate-0" : "-rotate-90")}>
          <path d="M6 9l6 6 6-6" />
        </svg>
        Categories ({terms.length})
      </button>
      {sectionOpen && (
        <div className="mt-1.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                value={termSearch}
                onChange={(e) => setTermSearch(e.target.value)}
                placeholder="Search categories…"
                className="h-6 w-36 rounded-full border border-white/10 bg-black/20 px-2.5 text-[10px] text-[var(--color-text-primary)] placeholder:text-white/25 focus:outline-none focus:border-white/25"
              />
              {termSearch && (
                <button
                  onClick={() => setTermSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 text-[10px]"
                >
                  ×
                </button>
              )}
            </div>
            {activeTerm && (
              <button
                onClick={() => onSelect(null)}
                className="shrink-0 rounded-full bg-[var(--color-accent)]/20 px-2.5 py-0.5 text-[10px] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 transition-colors"
              >
                Clear ×
              </button>
            )}
            <span className="ml-auto text-[10px] text-white/20">{filtered.length} categories</span>
          </div>
          <div className="hide-scrollbar flex flex-wrap gap-1">
            {visible.map(({ term, count }) => (
              <button
                key={term}
                onClick={() => onSelect(activeTerm === term ? null : term)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] transition-colors",
                  activeTerm === term
                    ? "bg-[var(--color-accent)]/25 text-[var(--color-accent)] border border-[var(--color-accent)]/40"
                    : "bg-white/5 text-[var(--color-text-muted)] hover:bg-white/10 hover:text-[var(--color-text-secondary)] border border-transparent"
                )}
              >
                {term}
                <span className="ml-1 text-white/30">({count})</span>
              </button>
            ))}
            {hasMore && (
              <button
                onClick={() => setExpanded(true)}
                className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60 border border-transparent transition-colors"
              >
                +{filtered.length - 60} more…
              </button>
            )}
            {expanded && !lc && (
              <button
                onClick={() => setExpanded(false)}
                className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60 border border-transparent transition-colors"
              >
                Show less
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

const PLATFORM_BADGE_COLORS: Record<string, string> = {
  OnlyFans: "bg-sky-500/80",
  "Twitter/X": "bg-neutral-500/80",
  Instagram: "bg-pink-500/80",
  Reddit: "bg-orange-500/80",
  Fansly: "bg-violet-500/80",
}

// ── CreatorCard ──────────────────────────────────────────────────────────────

const CreatorCard = memo(function CreatorCard({
  performer,
  onClick,
  onCapture,
  onFavorite,
  onHover,
}: {
  performer: Performer
  onClick: () => void
  onCapture?: (e: React.MouseEvent) => void
  onFavorite?: (e: React.MouseEvent) => void
  onHover?: () => void
}) {
  const avatarSrc = getPerformerAvatarSrc(performer)
  const platformColor = PLATFORM_BADGE_COLORS[performer.platform] ?? "bg-white/20"
  const isFav = Boolean(performer.is_favorite)

  return (
    <div
      className="group relative flex flex-col items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.06] hover:border-white/15"
      onMouseEnter={onHover}
      onFocus={onHover}
      style={{  }}
    >
      <button onClick={onClick} className="flex flex-col items-center gap-2 w-full">
        <div className="relative h-16 w-16 overflow-hidden rounded-full bg-white/10">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={performer.display_name ?? performer.username}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
              fetchPriority="low"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xl text-white/40">
              {(performer.display_name ?? performer.username).charAt(0).toUpperCase()}
            </div>
          )}
          <span className={cn("absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-[#0a1020]", platformColor)} />
        </div>
        <p className="max-w-full truncate text-xs font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)]">
          {performer.display_name ?? performer.username}
        </p>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {(performer.screenshots_count ?? performer.media_count ?? performer.media_total ?? 0).toLocaleString()} shots
        </span>
      </button>
      {onFavorite && (
        <button
          onClick={onFavorite}
          title={isFav ? "Remove from favorites" : "Add to favorites"}
          className={cn(
            "absolute top-2 left-2 h-6 w-6 items-center justify-center rounded-full transition-colors text-[11px]",
            isFav ? "flex text-yellow-400 bg-yellow-500/15 hover:bg-yellow-500/25" : "hidden group-hover:flex text-white/25 hover:text-yellow-400 bg-white/5 hover:bg-yellow-500/15"
          )}
        >
          {isFav ? "★" : "☆"}
        </button>
      )}
      {onCapture && (
        <button
          onClick={onCapture}
          title="Queue content capture for this creator"
          className="absolute top-2 right-2 hidden group-hover:flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/20 text-sky-300 hover:bg-sky-500/40 transition-colors text-[10px]"
        >
          ⬇
        </button>
      )}
    </div>
  )
}, (prev, next) =>
  prev.performer.id === next.performer.id &&
  prev.performer.is_favorite === next.performer.is_favorite &&
  prev.performer.username === next.performer.username &&
  prev.performer.display_name === next.performer.display_name &&
  prev.performer.platform === next.performer.platform &&
  prev.performer.profile_url === next.performer.profile_url &&
  prev.performer.is_verified === next.performer.is_verified &&
  prev.performer.tags === next.performer.tags &&
  prev.performer.avatar_url === next.performer.avatar_url &&
  prev.performer.screenshots_count === next.performer.screenshots_count &&
  prev.performer.media_count === next.performer.media_count
)

// ── MediaCard ────────────────────────────────────────────────────────────────

const MediaCard = memo(function MediaCard({
  shot,
  index = 0,
  onClick,
  batchMode,
  selected,
  onSelect,
  onHover,
  favorite,
  onToggleFavorite,
  onDescribe,
  onRate,
  onContextMenu,
  onNavigateToPerformer,
}: {
  shot: Screenshot
  index?: number
  onClick: () => void
  onHover?: () => void
  batchMode: boolean
  selected: boolean
  onSelect: () => void
  favorite: boolean
  onToggleFavorite: () => void
  onDescribe: () => void
  onRate: (rating: number) => void
  onContextMenu?: (e: React.MouseEvent) => void
  onNavigateToPerformer?: (performerId: number, username: string) => void
}) {
  const { mediaSrc: src, previewSrc, isVideo: vid, isGif: gif, markMediaBroken, markPreviewBroken } = useResolvedScreenshotMedia(shot)
  const mediaLabel = getMediaDebugLabel(shot)
  const [imgLoaded, setImgLoaded] = useState(false)
  const isAboveFold = index <= 8

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => (batchMode ? onSelect() : onClick())}
      onMouseEnter={onHover}
      onFocus={onHover}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); batchMode ? onSelect() : onClick() } }}
      onContextMenu={onContextMenu}
      className={cn(
        "group content-card content-card-interactive relative aspect-square cursor-pointer overflow-hidden rounded-[24px] border border-white/10 bg-black/25 shadow-[0_12px_32px_rgba(0,0,0,0.18)] hover:scale-[1.02] transition-transform duration-200",
        selected && "ring-2 ring-blue-500"
      )}
      style={index <= 20 ? { animationDelay: `${index * 30}ms` } : undefined}
    >
      <div style={{ contentVisibility: "auto", containIntrinsicSize: "160px 160px" }}>
        {!imgLoaded && previewSrc && (
          <div className="absolute inset-0 shimmer z-[1]" aria-hidden="true" />
        )}
        {!previewSrc ? (
          vid && src ? (
            <>
              <video
                src={src}
                muted
                playsInline
                preload="metadata"
                onError={markMediaBroken}
                className="h-full w-full object-cover transition-[filter] duration-200 group-hover:brightness-110"
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="rounded-full bg-black/50 p-3 backdrop-blur-sm">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21" /></svg>
                </div>
              </div>
            </>
          ) : (
            <MediaUnavailableTile
              title={shot.term}
              detail={mediaLabel}
              statusLabel="Media unavailable"
            />
          )
        ) : (
          <img
            src={previewSrc}
            alt={shot.ai_summary || `${vid ? "Video" : "Screenshot"}: ${shot.term} from ${sourceLabel(shot.source)}`}
            loading={isAboveFold ? "eager" : "lazy"}
            decoding={isAboveFold ? "sync" : "async"}
            fetchPriority={isAboveFold ? "high" : "low"}
            onError={(e) => {
              const img = e.currentTarget
              const retries = parseInt(img.dataset.retries || '0')
              if (retries < 1) {
                img.dataset.retries = '1'
                img.src = img.src + (img.src.includes('?') ? '&_r=1' : '?_r=1')
              } else {
                markPreviewBroken()
              }
            }}
            onLoad={() => setImgLoaded(true)}
            className="h-full w-full object-cover transition-[filter] duration-200 group-hover:brightness-110"
          />
        )}

        <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
          <div className="flex gap-1">
            {gif && (
              <span className="rounded bg-emerald-500/80 px-1 py-0.5 text-[9px] font-bold leading-none text-white shadow">
                GIF
              </span>
            )}
            {vid && (
              <span className="rounded bg-amber-500/85 px-1 py-0.5 text-[9px] font-bold leading-none text-white shadow">
                VIDEO
              </span>
            )}
          </div>
          {shot.performer_username && shot.performer_id && onNavigateToPerformer && (
            <button
              type="button"
              className="max-w-[110px] truncate rounded bg-sky-500/85 px-1.5 py-0.5 text-[9px] font-medium leading-none text-white shadow transition-colors hover:bg-sky-400/90"
              onClick={(e) => { e.stopPropagation(); onNavigateToPerformer(shot.performer_id!, shot.performer_username!) }}
              title={`View @${shot.performer_username}'s profile`}
            >
              @{shot.performer_username}
            </button>
          )}
          {shot.performer_username && (!shot.performer_id || !onNavigateToPerformer) && (
            <span className="max-w-[110px] truncate rounded bg-sky-500/85 px-1.5 py-0.5 text-[9px] font-medium leading-none text-white shadow">
              @{shot.performer_username}
            </span>
          )}
        </div>

        {Array.isArray(shot.ai_tags) && shot.ai_tags.length > 0 && (
          <div className="absolute bottom-8 left-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-wrap gap-0.5 overflow-hidden max-h-6">
            {shot.ai_tags.slice(0, 4).map((tag: string) => (
              <span key={tag} className="rounded bg-purple-500/75 px-1 py-0.5 text-[8px] font-medium leading-none text-white shadow truncate max-w-[70px]">
                {tag}
              </span>
            ))}
          </div>
        )}

        {vid && !batchMode && (
          <div className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white group-hover:hidden">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,0 10,5 2,10" /></svg>
          </div>
        )}

        {favorite && (
          <div className="absolute top-1.5 right-1.5 text-sm text-red-400 drop-shadow">&#9829;</div>
        )}

        {(shot.rating ?? 0) > 0 ? (
          <div className="absolute bottom-1.5 left-1.5 z-10" onClick={(e) => e.stopPropagation()}>
            <StarRating value={shot.rating ?? 0} onChange={onRate} compact />
          </div>
        ) : (
          !batchMode && (
            <div className="absolute bottom-1.5 left-1.5 z-10 hidden group-hover:block" onClick={(e) => e.stopPropagation()}>
              <StarRating value={0} onChange={onRate} compact />
            </div>
          )
        )}

        {batchMode && (
          <div className={cn(
            "absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded border text-[10px]",
            selected ? "border-blue-500 bg-blue-500 text-white" : "border-white/40 bg-black/50 text-transparent"
          )}>
            {selected && "✓"}
          </div>
        )}

        {!batchMode && (
          <div className="absolute bottom-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 transition-colors hover:text-red-400"
              title={favorite ? "Unfavorite" : "Favorite"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDescribe() }}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 transition-colors hover:text-purple-400"
              title="AI Describe"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
                <path d="M18 15l.75 2.25L21 18l-2.25.75L18 21l-.75-2.25L15 18l2.25-.75z" />
              </svg>
            </button>
            {shot.page_url && (
              <a
                href={shot.page_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 transition-colors hover:text-blue-400"
                title="Open source"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            )}
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2.5 pb-2.5 pt-8">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold text-white">{shot.term}</p>
              <p className="truncate text-[10px] text-white/65">
                {shot.performer_username ? `@${shot.performer_username} · ${sourceLabel(shot.source)}` : sourceLabel(shot.source)}
              </p>
            </div>
            {vid && !batchMode && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,0 10,5 2,10" /></svg>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}, (prev, next) =>
  prev.shot.id === next.shot.id &&
  prev.shot.local_url === next.shot.local_url &&
  prev.favorite === next.favorite &&
  prev.selected === next.selected &&
  prev.batchMode === next.batchMode
)

// ── MosaicCard ───────────────────────────────────────────────────────────────

const MosaicCard = memo(function MosaicCard({
  shot,
  onClick,
  onHover,
  favorite,
  onToggleFavorite,
  onContextMenu,
}: {
  shot: Screenshot
  onClick: () => void
  onHover?: () => void
  favorite: boolean
  onToggleFavorite: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const { mediaSrc: src, previewSrc, isVideo: vid, isGif: gif, markMediaBroken, markPreviewBroken } = useResolvedScreenshotMedia(shot)
  const mediaLabel = getMediaDebugLabel(shot)

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onClick}
      onMouseEnter={onHover}
      onFocus={onHover}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick() } }}
      onContextMenu={onContextMenu}
      className="group relative mb-1 cursor-pointer overflow-hidden rounded-lg bg-white/5 break-inside-avoid"
      style={{ breakInside: "avoid" }}
    >
      <div style={{ contentVisibility: "auto", containIntrinsicSize: "220px" }}>
        {!previewSrc ? (
          vid && src ? (
            <video
              src={src}
              muted
              playsInline
              preload="metadata"
              onError={markMediaBroken}
              className="w-full transition-[filter] duration-200 group-hover:brightness-110"
              style={{ display: "block" }}
            />
          ) : (
            <MediaUnavailableTile
              title={shot.term}
              detail={mediaLabel}
              statusLabel="Media unavailable"
              className="min-h-[10rem]"
            />
          )
        ) : (
          <img
            src={previewSrc}
            alt={shot.ai_summary || `${shot.term} — ${sourceLabel(shot.source)}`}
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            onError={markPreviewBroken}
            className="w-full transition-[filter] duration-200 group-hover:brightness-110"
            style={{ display: "block" }}
          />
        )}

        <div className="absolute top-1.5 left-1.5 flex gap-1">
          {gif && <span className="rounded bg-emerald-500/80 px-1 py-0.5 text-[9px] font-bold leading-none text-white">GIF</span>}
          {vid && <span className="rounded bg-purple-500/80 px-1 py-0.5 text-[9px] font-bold leading-none text-white">VIDEO</span>}
        </div>

        {favorite && (
          <div className="absolute top-1.5 right-1.5 text-sm text-red-400 drop-shadow">&#9829;</div>
        )}

        {(shot.rating ?? 0) > 0 && (
          <div className="absolute bottom-8 left-1.5 z-10" onClick={(e) => e.stopPropagation()}>
            <span className="text-[10px] text-yellow-400">{"★".repeat(shot.rating ?? 0)}</span>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-8 opacity-0 transition-opacity group-hover:opacity-100">
          <p className="truncate text-xs font-medium text-white">{shot.term}</p>
          <p className="text-[10px] text-white/60">{sourceLabel(shot.source)}</p>
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
          className={cn(
            "absolute bottom-1.5 right-1.5 hidden h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 transition-colors group-hover:flex",
            favorite ? "text-red-400" : "hover:text-red-300",
          )}
          title={favorite ? "Unfavorite" : "Favorite"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
      </div>
    </article>
  )
}, (prev, next) =>
  prev.shot.id === next.shot.id &&
  prev.shot.rating === next.shot.rating &&
  prev.shot.local_url === next.shot.local_url &&
  prev.favorite === next.favorite
)

// ── AI Described Section ──────────────────────────────────────────────────────

const AIDescribedSection = memo(function AIDescribedSection({
  shots,
  onClickShot,
  onFilterDescribed,
}: {
  shots: Screenshot[]
  onClickShot: (shot: Screenshot) => void
  onFilterDescribed: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const described = useMemo(() => shots.filter((s) => s.ai_summary).slice(0, 20), [shots])

  if (described.length === 0) return null

  return (
    <div className="border-b border-white/10 px-4 py-3" style={{  }}>
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={cn("transition-transform", collapsed ? "-rotate-90" : "rotate-0")}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          AI Described
          <span className="text-xs text-[var(--color-text-muted)]">({described.length})</span>
        </button>
        <button
          onClick={onFilterDescribed}
          className="text-xs text-[var(--color-accent)] hover:underline"
        >
          View all described
        </button>
      </div>
      {!collapsed && (
        <div className="hide-scrollbar mt-2 flex gap-3 overflow-x-auto pb-1">
          {described.map((shot) => {
            const src = getBestAvailablePreviewSrc(shot)
            if (!src) return null
            return (
              <button
                key={shot.id}
                onClick={() => onClickShot(shot)}
                className="group flex-shrink-0"
              >
                <div className="h-20 w-20 overflow-hidden rounded-lg bg-black/20">
                  <img src={src} alt="" loading="lazy" decoding="async" fetchPriority="low" className="h-full w-full object-cover" />
                </div>
                <p className="mt-1 w-20 truncate text-[10px] text-[var(--color-text-muted)] group-hover:text-[var(--color-text-primary)]">
                  {shot.ai_summary}
                </p>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
})

// ── Grid Density Control ──────────────────────────────────────────────────────

function GridDensityControl({ density, onChange }: { density: GridDensity; onChange: (d: GridDensity) => void }) {
  const options: { key: GridDensity; icon: React.ReactNode; label: string }[] = [
    {
      key: "compact",
      label: "Compact",
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="0" y="0" width="3" height="3" rx="0.5" />
          <rect x="4" y="0" width="3" height="3" rx="0.5" />
          <rect x="8" y="0" width="3" height="3" rx="0.5" />
          <rect x="0" y="4" width="3" height="3" rx="0.5" />
          <rect x="4" y="4" width="3" height="3" rx="0.5" />
          <rect x="8" y="4" width="3" height="3" rx="0.5" />
          <rect x="0" y="8" width="3" height="3" rx="0.5" />
          <rect x="4" y="8" width="3" height="3" rx="0.5" />
          <rect x="8" y="8" width="3" height="3" rx="0.5" />
        </svg>
      ),
    },
    {
      key: "normal",
      label: "Normal",
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="0" y="0" width="4" height="4" rx="0.5" />
          <rect x="5" y="0" width="4" height="4" rx="0.5" />
          <rect x="10" y="0" width="4" height="4" rx="0.5" />
          <rect x="0" y="5" width="4" height="4" rx="0.5" />
          <rect x="5" y="5" width="4" height="4" rx="0.5" />
          <rect x="10" y="5" width="4" height="4" rx="0.5" />
        </svg>
      ),
    },
    {
      key: "spacious",
      label: "Spacious",
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="0" y="0" width="6" height="6" rx="1" />
          <rect x="8" y="0" width="6" height="6" rx="1" />
          <rect x="0" y="8" width="6" height="6" rx="1" />
          <rect x="8" y="8" width="6" height="6" rx="1" />
        </svg>
      ),
    },
  ]

  return (
    <div className="flex rounded-lg border border-white/10 bg-black/20 overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          title={opt.label}
          className={cn(
            "flex items-center justify-center px-2 py-2 transition-colors",
            density === opt.key
              ? "bg-white/10 text-[var(--color-text-primary)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          )}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  )
}

// ── AdvancedSearchPanel ──────────────────────────────────────────────────────

interface AdvancedFilters {
  source: string
  minRating: number
  tags: string[]
  dateFrom: string
  dateTo: string
  hasDescription: boolean | null
  hasPerformer: boolean | null
  mediaType: "any" | "photo" | "video"
}

const EMPTY_FILTERS: AdvancedFilters = {
  source: "",
  minRating: 0,
  tags: [],
  dateFrom: "",
  dateTo: "",
  hasDescription: null,
  hasPerformer: null,
  mediaType: "any",
}


function AdvancedSearchPanel({
  filters,
  onChange,
  onClear,
  sources,
  allTags,
}: {
  filters: AdvancedFilters
  onChange: (f: AdvancedFilters) => void
  onClear: () => void
  sources: { source: string; count: number }[]
  allTags: UserTagCount[]
}) {
  const activeCount = [
    filters.source,
    filters.minRating > 0,
    filters.tags.length > 0,
    filters.dateFrom,
    filters.dateTo,
    filters.hasDescription !== null,
    filters.hasPerformer !== null,
    filters.mediaType !== "any",
  ].filter(Boolean).length

  return (
    <div className="border-b border-white/10 bg-white/[0.02] px-4 py-3">
      <div className="flex flex-wrap gap-3 items-end">
        {/* Source */}
        <label className="flex flex-col gap-1 text-[10px] text-[var(--color-text-muted)]">
          Source
          <select
            value={filters.source}
            onChange={(e) => onChange({ ...filters, source: e.target.value })}
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-[var(--color-text-secondary)]"
          >
            <option value="">Any</option>
            {sources.map((s) => (
              <option key={s.source} value={s.source}>{s.source} ({s.count})</option>
            ))}
          </select>
        </label>

        {/* Min rating */}
        <label className="flex flex-col gap-1 text-[10px] text-[var(--color-text-muted)]">
          Min Rating
          <select
            value={filters.minRating}
            onChange={(e) => onChange({ ...filters, minRating: Number(e.target.value) })}
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-[var(--color-text-secondary)]"
          >
            <option value={0}>Any</option>
            {[1, 2, 3, 4, 5].map((r) => (
              <option key={r} value={r}>{"★".repeat(r)} ({r}+)</option>
            ))}
          </select>
        </label>

        {/* Tags multi-select */}
        <label className="flex flex-col gap-1 text-[10px] text-[var(--color-text-muted)]">
          Tags
          <div className="flex flex-wrap items-center gap-1">
            {filters.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] text-blue-300">
                {t}
                <button
                  onClick={() => onChange({ ...filters, tags: filters.tags.filter((x) => x !== t) })}
                  className="hover:text-white"
                >&times;</button>
              </span>
            ))}
            <select
              value=""
              onChange={(e) => {
                const v = e.target.value
                if (v && !filters.tags.includes(v)) onChange({ ...filters, tags: [...filters.tags, v] })
              }}
              className="rounded border border-white/10 bg-black/30 px-1 py-1 text-xs text-[var(--color-text-secondary)]"
            >
              <option value="">+ Add tag</option>
              {allTags.filter((t) => !filters.tags.includes(t.tag)).map((t) => (
                <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>
              ))}
            </select>
          </div>
        </label>

        {/* Date range */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--color-text-muted)]">Date range</span>
          <div className="flex items-center gap-1.5">
            <div className="flex gap-1">
              {(["Today", "7d", "30d", "90d"] as const).map((preset) => {
                const days = preset === "Today" ? 0 : parseInt(preset)
                const d = new Date()
                d.setDate(d.getDate() - days)
                const val = d.toISOString().slice(0, 10)
                const active = filters.dateFrom === val && !filters.dateTo
                return (
                  <button
                    key={preset}
                    onClick={() => onChange({ ...filters, dateFrom: active ? "" : val, dateTo: "" })}
                    className={cn(
                      "rounded px-1.5 py-1 text-[10px] border transition-colors",
                      active
                        ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                        : "border-white/10 bg-black/20 text-white/40 hover:text-white/70 hover:border-white/20"
                    )}
                  >
                    {preset}
                  </button>
                )
              })}
            </div>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
              className="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-[var(--color-text-secondary)]"
            />
            <span className="text-[10px] text-white/30">–</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
              className="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-[var(--color-text-secondary)]"
            />
          </div>
        </div>

        {/* Has description */}
        <label className="flex flex-col gap-1 text-[10px] text-[var(--color-text-muted)]">
          Description
          <select
            value={filters.hasDescription === null ? "" : filters.hasDescription ? "yes" : "no"}
            onChange={(e) => onChange({ ...filters, hasDescription: e.target.value === "" ? null : e.target.value === "yes" })}
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-[var(--color-text-secondary)]"
          >
            <option value="">Any</option>
            <option value="yes">Has description</option>
            <option value="no">No description</option>
          </select>
        </label>

        {/* Has performer */}
        <label className="flex flex-col gap-1 text-[10px] text-[var(--color-text-muted)]">
          Performer
          <select
            value={filters.hasPerformer === null ? "" : filters.hasPerformer ? "yes" : "no"}
            onChange={(e) => onChange({ ...filters, hasPerformer: e.target.value === "" ? null : e.target.value === "yes" })}
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-[var(--color-text-secondary)]"
          >
            <option value="">Any</option>
            <option value="yes">Has performer</option>
            <option value="no">No performer</option>
          </select>
        </label>

        {/* Media type */}
        <label className="flex flex-col gap-1 text-[10px] text-[var(--color-text-muted)]">
          Type
          <select
            value={filters.mediaType}
            onChange={(e) => onChange({ ...filters, mediaType: e.target.value as AdvancedFilters["mediaType"] })}
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-[var(--color-text-secondary)]"
          >
            <option value="any">Any</option>
            <option value="photo">Photos</option>
            <option value="video">Videos</option>
          </select>
        </label>

        {/* Clear */}
        {activeCount > 0 && (
          <button
            onClick={onClear}
            className="rounded px-2 py-1 text-xs text-red-400 hover:text-red-300"
          >
            Clear ({activeCount})
          </button>
        )}
      </div>
    </div>
  )
}

// ── MediaPage ────────────────────────────────────────────────────────────────

export function MediaPage() {
  const [term, setTerm] = useState<string | null>(() => readTermFromHash())
  const [tab, setTab] = useState<TabFilter>("all")
  const [search, setSearch] = useState("")
  const [searchFocused, setSearchFocused] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest")
  const [expandedVideoId, setExpandedVideoId] = useState<number | null>(null)
  const [expandedVideoShot, setExpandedVideoShot] = useState<Screenshot | null>(null)
  const [lightboxShotId, setLightboxShotId] = useState<number | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [favorites, setFavorites] = useState<Set<number>>(new Set())
  const [ftsResults, setFtsResults] = useState<Screenshot[] | null>(null)
  const [ftsSearching, setFtsSearching] = useState(false)
  const [autoDescribe, setAutoDescribe] = useState(false)
  const [describeProgress, setDescribeProgress] = useState<{ done: number; total: number } | null>(null)
  const [gridDensity, setGridDensity] = useState<GridDensity>("normal")
  const [filterDescribed, setFilterDescribed] = useState(false)
  const [playlistDropdownOpen, setPlaylistDropdownOpen] = useState(false)
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false)
  const [activePlaylistId, setActivePlaylistId] = useState<number | null>(null)
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false)
  const [createPlaylistWithIds, setCreatePlaylistWithIds] = useState<number[] | undefined>(undefined)

  const [viewHistory, setViewHistory] = useState<number[]>([])
  const [recentlyViewedCollapsed, setRecentlyViewedCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [slideshowActive, setSlideshowActive] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; shot: Screenshot } | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [mediaStatsEnabled, setMediaStatsEnabled] = useState(false)
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(EMPTY_FILTERS)
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null)
  const [urlInputOpen, setUrlInputOpen] = useState(false)
  const [urlInput, setUrlInput] = useState("")
  const [urlTerm, setUrlTerm] = useState("")
  const [urlCapturing, setUrlCapturing] = useState(false)
  const [autoTagging, setAutoTagging] = useState(false)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [creatorSearch, setCreatorSearch] = useState("")
  const [creatorPlatformFilter, setCreatorPlatformFilter] = useState("all")
  const [creatorSort, setCreatorSort] = useState<"shots" | "name">("shots")
  const [creatorFavoritesOnly, setCreatorFavoritesOnly] = useState(false)
  const [capturingAll, setCapturingAll] = useState(false)
  const [discoveryOpen, setDiscoveryOpen] = useState(false)
  const [discoveryQuery, setDiscoveryQuery] = useState("")
  const [discoveryPlatform, setDiscoveryPlatform] = useState("all")
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveredCreator[]>([])
  const [discoveredUsernames, setDiscoveredUsernames] = useState<Set<string>>(new Set())
  const [onlyUnlinked, setOnlyUnlinked] = useState(false)
  const [onlyUnrated, setOnlyUnrated] = useState(false)
  const [onlyRecent, setOnlyRecent] = useState(false)
  const [mosaicVisibleCount, setMosaicVisibleCount] = useState(() => getInitialMosaicVisibleCount())
  const trimmedSearch = search.trim()
  const deferredTrimmedSearch = useDeferredValue(trimmedSearch)
  const showSearchSuggestions = searchFocused && deferredTrimmedSearch.length >= 3
  const showTermBrowser = tab !== "creators" && !term && !trimmedSearch && !advancedOpen && !discoveryOpen
  const shouldLoadTermData = tab !== "creators" && (showTermBrowser || showSearchSuggestions)

  useEffect(() => {
    if (mediaStatsEnabled) return
    let cancelled = false
    let timeoutId: number | null = null
    const win = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    const enable = () => {
      if (!cancelled) setMediaStatsEnabled(true)
    }
    if (typeof win.requestIdleCallback === "function") {
      const idleId = win.requestIdleCallback(enable, { timeout: 1500 })
      return () => {
        cancelled = true
        if (typeof win.cancelIdleCallback === "function") win.cancelIdleCallback(idleId)
      }
    }
    timeoutId = window.setTimeout(enable, 900)
    return () => {
      cancelled = true
      if (timeoutId != null) window.clearTimeout(timeoutId)
    }
  }, [mediaStatsEnabled])
  const deferredSearch = useDeferredValue(search)
  const deferredCreatorSearch = useDeferredValue(creatorSearch)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const virtualizerContainerRef = useRef<HTMLDivElement>(null)

  const addToast = useAppStore((s) => s.addToast)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const mediaCreatorId = useAppStore((s) => s.mediaCreatorId)
  const mediaCreatorName = useAppStore((s) => s.mediaCreatorName)
  const setMediaCreator = useAppStore((s) => s.setMediaCreator)
  const setPendingPerformer = useAppStore((s) => s.setPendingPerformer)
  const screenshotRunning = useAppStore((s) => s.screenshotRunning)
  const [statusPollingEnabled, setStatusPollingEnabled] = useState(true)
  const qc = useQueryClient()

  const applyMediaNavigationIntent = useCallback((intent: { query?: string; term?: string; tag?: string }) => {
    const nextQuery = intent.query?.trim() ?? ""
    const nextTerm = intent.term?.trim() ?? ""
    const nextTag = intent.tag?.trim() ?? ""
    if (!nextQuery && !nextTerm && !nextTag) return

    setSearch(nextQuery)
    setTerm(nextTerm || null)
    setActiveTagFilter(nextTag || null)
    setTab("all")
    setAdvancedFilters(EMPTY_FILTERS)
    setAdvancedOpen(false)
    setDiscoveryOpen(false)
    setActivePlaylistId(null)
    setFilterDescribed(false)
    setOnlyUnlinked(false)
    setOnlyUnrated(false)
    setOnlyRecent(false)
    setMediaCreator(null)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }, [setMediaCreator])

  useEffect(() => {
    const pendingIntent = consumeMediaNavigationIntent()
    if (pendingIntent) applyMediaNavigationIntent(pendingIntent)

    const listener: EventListener = (event) => {
      applyMediaNavigationIntent((event as CustomEvent<{ query?: string; term?: string; tag?: string }>).detail ?? {})
      clearMediaNavigationIntent()
    }

    window.addEventListener(MEDIA_NAVIGATION_EVENT, listener)
    return () => window.removeEventListener(MEDIA_NAVIGATION_EVENT, listener)
  }, [applyMediaNavigationIntent])

  // On mount: if the global store has a pending date filter (set from heatmap click),
  // pre-populate advancedFilters and open the panel, then clear the store filters.
  useEffect(() => {
    const { filters, resetFilters } = useAppStore.getState()
    if (filters.dateFrom || filters.dateTo) {
      setAdvancedFilters((prev) => ({
        ...prev,
        dateFrom: filters.dateFrom ?? "",
        dateTo: filters.dateTo ?? "",
      }))
      setAdvancedOpen(true)
      resetFilters()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync term to hash
  useEffect(() => { writeTermToHash(term) }, [term])

  useEffect(() => {
    const base = "Codex Media"
    if (term) {
      document.title = `${term} — ${base}`
    } else if (tab === "favorites") {
      document.title = `Favorites — ${base}`
    } else if (tab === "videos") {
      document.title = `Videos — ${base}`
    } else {
      document.title = base
    }
  }, [term, tab])

  useEffect(() => {
    if (mediaCreatorId != null) {
      setDiscoveryOpen(true)
      setDiscoveryQuery((prev) => prev || `Creators similar to @${mediaCreatorName ?? "this creator"}`)
      return
    }
    if (term) {
      setDiscoveryQuery((prev) => prev || `Creators related to ${term}`)
    }
  }, [mediaCreatorId, mediaCreatorName, term])

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: statusData } = useQuery({
    queryKey: ["screenshot-status"],
    queryFn: api.screenshotStatus,
    enabled: statusPollingEnabled,
    refetchInterval: (q) => (q.state.data?.running ? 5_000 : false),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    initialData: typeof window !== "undefined" && (window as any).__INITIAL_DATA__?.status
      ? (window as any).__INITIAL_DATA__.status
      : undefined,
  })
  const capturing = statusData?.running ?? false

  useEffect(() => {
    if (screenshotRunning) {
      setStatusPollingEnabled(true)
    }
  }, [screenshotRunning])

  useEffect(() => {
    if (!statusPollingEnabled) return
    if (statusData && !statusData.running && !screenshotRunning) {
      setStatusPollingEnabled(false)
    }
  }, [statusData, screenshotRunning, statusPollingEnabled])

  // Notify on capture finish
  const prevCap = useRef(false)
  useEffect(() => {
    if (prevCap.current && !capturing) {
      addToast("Capture complete", "success", {
        label: "View new",
        onClick: () => {
          setSortOrder("newest")
          setTerm(null)
          setTab("all")
          window.scrollTo({ top: 0, behavior: "smooth" })
        },
      })
      qc.invalidateQueries({ queryKey: ["screenshots"] })
      qc.invalidateQueries({ queryKey: ["screenshot-terms"] })
      qc.invalidateQueries({ queryKey: ["screenshot-sources"] })
      qc.invalidateQueries({ queryKey: ["media-stats"] })
    }
    prevCap.current = capturing
  }, [capturing, addToast, qc])

  const { data: screenshotTermsData } = useQuery<ScreenshotTerm[]>({
    queryKey: ["screenshot-terms"],
    queryFn: api.screenshotTerms,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    enabled: shouldLoadTermData,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const termBrowserItems = useMemo(() => {
    const hasCyrillic = (s: string) => /[\u0400-\u04FF]/.test(s)
    const emojiRatio = (s: string) => {
      const emojis = (s.match(/\p{Emoji}/gu) ?? []).length
      return emojis / Math.max(s.length, 1)
    }
    return (screenshotTermsData ?? [])
      .filter((t) =>
        t.term.length <= 40 &&
        !hasCyrillic(t.term) &&
        emojiRatio(t.term) < 0.3
      )
      .map((t) => ({ term: t.term, count: t.count }))
      .slice(0, 80)
  }, [screenshotTermsData])
  const { data: sourceData } = useQuery({
    queryKey: ["screenshot-sources"],
    queryFn: api.screenshotSources,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    enabled: advancedOpen,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const sources = sourceData ?? []

  const { data: allUserTags } = useQuery<UserTagCount[]>({
    queryKey: ["screenshot-all-tags"],
    queryFn: api.screenshotAllTags,
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    enabled: advancedOpen || showSearchSuggestions,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const userTags = allUserTags ?? []

  const { data: mediaStatsData } = useQuery({
    queryKey: ["media-stats"],
    queryFn: api.mediaStats,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    enabled: mediaStatsEnabled,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const sourceForQuery = tab === "ddg" ? "ddg" : tab === "redgifs" ? "redgifs" : tab === "tube" ? "ytdlp" : (advancedFilters.source || undefined)

  // Build advanced query params
  const advQueryParams = useMemo(() => {
    const p: Record<string, string | number | boolean> = {}
    if (advancedFilters.minRating > 0) p.min_rating = advancedFilters.minRating
    if (advancedFilters.tags.length > 0) p.tag = advancedFilters.tags[0] // server supports one tag at a time
    if (advancedFilters.dateFrom) p.date_from = advancedFilters.dateFrom
    if (advancedFilters.dateTo) p.date_to = advancedFilters.dateTo
    if (advancedFilters.hasDescription !== null) p.has_description = advancedFilters.hasDescription
    if (advancedFilters.hasPerformer !== null) p.has_performer = advancedFilters.hasPerformer
    if (advancedFilters.mediaType === "photo") p.media_type = "image"
    else if (advancedFilters.mediaType === "video") p.media_type = "video"
    if (activeTagFilter) p.tag = activeTagFilter
    return p
  }, [advancedFilters, activeTagFilter])

  // Use server-embedded initial data only for the default unfiltered first page
  const _canUseEmbeddedData = !term && !sourceForQuery && mediaCreatorId == null
    && Object.keys(advQueryParams).length === 0
    && (tab === "all" || tab == null)
    && typeof window !== "undefined" && (window as any).__INITIAL_DATA__?.screenshots

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error: mediaError, refetch: mediaRefetch } = useInfiniteQuery({
    queryKey: ["screenshots", term, sourceForQuery, advQueryParams, mediaCreatorId, tab],
    queryFn: ({ pageParam = 0, signal }) =>
      api.browseScreenshots({
        ...(term ? { term } : {}),
        ...(sourceForQuery ? { source: sourceForQuery } : {}),
        ...advQueryParams,
        ...(mediaCreatorId != null ? { performer_id: mediaCreatorId } : {}),
        ...(tab === "videos" ? { media_type: "video" } : {}),
        ...(tab === "images" ? { media_type: "image" } : {}),
        limit: 18,
        offset: pageParam as number,
      }, { signal }),
    getNextPageParam: (last) => (last.has_more ? (last.next_offset ?? (last.offset + last.screenshots.length)) : undefined),
    initialPageParam: 0,
    initialData: _canUseEmbeddedData
      ? { pages: [(window as any).__INITIAL_DATA__.screenshots], pageParams: [0] }
      : undefined,
    enabled: tab !== "creators",
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    maxPages: 6,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })

  const allShots = useMemo(() => data?.pages.flatMap((p) => p.screenshots) ?? [], [data])
  const shotById = useMemo(
    () => new Map(allShots.map((shot) => [shot.id, shot])),
    [allShots],
  )
  const allShotMeta = useMemo(
    () => new Map(allShots.map((shot) => [shot.id, buildShotClientMeta(shot)])),
    [allShots],
  )
  const recentShotIds = useMemo(() => {
    if (!onlyRecent) return new Set<number>()
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    return new Set(
      allShots
        .filter((shot) => {
          const ts = shot.captured_at ? new Date(shot.captured_at).getTime() : 0
          return Number.isFinite(ts) && ts >= cutoff
        })
        .map((shot) => shot.id),
    )
  }, [allShots, onlyRecent])

  // ── Playlist queries ──────────────────────────────────────────────────────
  const { data: playlistDetail } = useQuery({
    queryKey: ["playlist-detail", activePlaylistId],
    queryFn: () => api.getPlaylist(activePlaylistId!, { limit: 250 }),
    enabled: activePlaylistId != null,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const populateMutation = useMutation({
    mutationFn: (id: number) => api.populatePlaylist(id),
    onSuccess: (res) => {
      addToast(`Populated ${res.populated} items`, "success")
      qc.invalidateQueries({ queryKey: ["playlist-detail", activePlaylistId] })
      qc.invalidateQueries({ queryKey: ["playlists"] })
    },
  })

  const deletePlaylistMutation = useMutation({
    mutationFn: (id: number) => api.deletePlaylist(id),
    onSuccess: () => {
      addToast("Playlist deleted", "success")
      setActivePlaylistId(null)
      qc.invalidateQueries({ queryKey: ["playlists"] })
    },
  })

  // Playlists for context menu
  const { data: playlistsData } = useQuery({
    queryKey: ["playlists"],
    queryFn: api.playlists,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    enabled: playlistDropdownOpen || addToPlaylistOpen || activePlaylistId != null || contextMenu != null,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const allPlaylists: Playlist[] = playlistsData ?? []

  // Creators query — only when tab is "creators"
  const { data: creatorsData, isLoading: creatorsLoading } = useQuery({
    queryKey: ["performers-for-media"],
    queryFn: () => api.browsePerformers({ limit: 18, sort: "screenshots_count", compact: true }),
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    enabled: tab === "creators" || discoveryOpen || showSearchSuggestions,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })

  const { data: similarCreators = [] } = useQuery<Performer[]>({
    queryKey: ["similar-performers", mediaCreatorId],
    queryFn: () => api.similarPerformers(mediaCreatorId!, 3),
    staleTime: 5 * 60_000,
    enabled: mediaCreatorId != null,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })

  const discoverCreatorsMutation = useMutation({
    mutationFn: () =>
      api.discoverPerformers(
        discoveryQuery.trim(),
        discoveryPlatform === "all" ? undefined : discoveryPlatform,
        {
          seed_performer_id: mediaCreatorId ?? undefined,
          seed_term: term ?? undefined,
          limit: 10,
        },
      ),
    onSuccess: (results) => {
      setDiscoveryResults(results)
      setDiscoveryOpen(true)
    },
    onError: () => addToast("AI discovery failed", "error"),
  })

  const importDiscoveredMutation = useMutation({
    mutationFn: (creators: DiscoveredCreator[]) => api.importDiscoveredPerformers(creators, true),
    onSuccess: (result, creators) => {
      setDiscoveredUsernames((prev) => {
        const next = new Set(prev)
        creators.forEach((creator) => next.add(creator.username.toLowerCase()))
        return next
      })
      qc.invalidateQueries({ queryKey: ["performers"] })
      qc.invalidateQueries({ queryKey: ["performers-for-media"] })
      qc.invalidateQueries({ queryKey: ["capture-queue"] })
      qc.invalidateQueries({ queryKey: ["similar-performers", mediaCreatorId] })
      const created = result.created
      const existing = result.existing
      addToast(
        created > 0 || existing > 0
          ? `Queued capture for ${created} new and ${existing} existing creator${created + existing === 1 ? "" : "s"}`
          : "No new creators were added",
        created > 0 || existing > 0 ? "success" : "info",
      )
    },
    onError: () => addToast("Could not import AI suggestions", "error"),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.screenshotDelete(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["screenshots"] })
      qc.invalidateQueries({ queryKey: ["screenshot-sources"] })
      qc.invalidateQueries({ queryKey: ["media-stats"] })
      setSelectedIds((p) => { const n = new Set(p); n.delete(id); return n })
      setFavorites((p) => { const n = new Set(p); n.delete(id); return n })
      addToast("Deleted", "success")
    },
    onError: () => addToast("Delete failed", "error"),
  })

  const rateMutation = useMutation({
    mutationFn: ({ id, rating }: { id: number; rating: number }) => api.rateScreenshot(id, rating),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["screenshots"] })
      qc.invalidateQueries({ queryKey: ["top-rated-screenshots"] })
      qc.invalidateQueries({ queryKey: ["media-stats"] })
    },
  })

  const tagMutation = useMutation({
    mutationFn: ({ id, tags }: { id: number; tags: string[] }) => api.updateScreenshotTags(id, tags),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["screenshots"] })
      qc.invalidateQueries({ queryKey: ["screenshot-all-tags"] })
    },
  })

  const favoriteCreatorMutation = useMutation({
    mutationFn: ({ id, isFav }: { id: number; isFav: boolean }) =>
      api.updatePerformer(id, { is_favorite: isFav ? 1 : 0 } as Partial<Performer>),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["performers"] }),
  })

  function handleAddTag(shotId: number, tag: string) {
    const shot = shotById.get(shotId)
    if (!shot) return
    const existing = parseUserTags(shot.user_tags)
    if (!existing.includes(tag.toLowerCase())) {
      tagMutation.mutate({ id: shotId, tags: [...existing, tag.toLowerCase()] })
    }
  }

  function handleRemoveTag(shotId: number, tag: string) {
    const shot = shotById.get(shotId)
    if (!shot) return
    const existing = parseUserTags(shot.user_tags)
    tagMutation.mutate({ id: shotId, tags: existing.filter((t) => t !== tag) })
  }

  // ── Smart search with FTS fallback ───────────────────────────────────────

  // Save search to recent history
  useEffect(() => {
    if (!deferredSearch.trim() || deferredSearch.trim().length < 2) return
    const timer = setTimeout(() => {
      setRecentSearches((prev) => {
        const trimmed = deferredSearch.trim()
        const updated = [trimmed, ...prev.filter((s) => s !== trimmed)].slice(0, 8)
        return updated
      })
    }, 1500)
    return () => clearTimeout(timer)
  }, [deferredSearch])

  useEffect(() => {
    if (!deferredSearch.trim()) {
      setFtsSearching(false)
      startTransition(() => setFtsResults(null))
      return
    }
    const words = deferredSearch.trim().split(/\s+/)
    if (words.length < 3) {
      setFtsSearching(false)
      startTransition(() => setFtsResults(null))
      return
    }

    // Check local match count
    const lc = deferredSearch.toLowerCase()
    const localCount = allShots.filter((s) => {
      const meta = allShotMeta.get(s.id)
      return (meta?.searchText ?? buildShotClientMeta(s).searchText).includes(lc)
    }).length
    if (localCount >= 5) {
      setFtsSearching(false)
      startTransition(() => setFtsResults(null))
      return
    }

    setFtsSearching(true)
    const timer = setTimeout(async () => {
      try {
        const results = await api.searchScreenshots(deferredSearch.trim())
        startTransition(() => setFtsResults(results))
      } catch {
        startTransition(() => setFtsResults([]))
      }
      finally { setFtsSearching(false) }
    }, 400)
    return () => clearTimeout(timer)
  }, [deferredSearch, allShots, allShotMeta])

  // ── Derived data ─────────────────────────────────────────────────────────

  const sortedShots = useMemo(() => {
    const base = ftsResults ?? allShots
    const copy = [...base]
    if (sortOrder === "random") {
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]]
      }
      return copy
    }
    copy.sort((a, b) => {
      if (sortOrder === "newest") return (b.captured_at ?? "").localeCompare(a.captured_at ?? "")
      if (sortOrder === "oldest") return (a.captured_at ?? "").localeCompare(b.captured_at ?? "")
      if (sortOrder === "rating") return (b.rating ?? 0) - (a.rating ?? 0) || (b.captured_at ?? "").localeCompare(a.captured_at ?? "")
      return a.term.localeCompare(b.term)
    })
    return copy
  }, [ftsResults, allShots, sortOrder])

  const playlistShots = useMemo<Screenshot[]>(() => {
    if (!playlistDetail?.screenshots) return []
    return playlistDetail.screenshots.map((s) => ({
      id: s.id,
      term: s.term,
      source: s.source,
      page_url: s.page_url,
      local_path: s.local_path,
      local_url: s.local_url ?? null,
      captured_at: s.captured_at,
      ai_summary: s.ai_summary ?? null,
      ai_tags: s.ai_tags ?? null,
    }))
  }, [playlistDetail])

  const visibleShots = useMemo(() => {
    // When viewing a playlist, show playlist items instead
    if (activePlaylistId != null) return playlistShots
    const lc = deferredSearch.toLowerCase()
    return sortedShots.filter((s) => {
      const meta = allShotMeta.get(s.id) ?? buildShotClientMeta(s)
      if (tab === "favorites" && !favorites.has(s.id)) return false
      if (tab === "rated" && !(s.rating && s.rating > 0)) return false
      if (tab === "videos" && !meta.isVideo) return false
      if (tab === "images" && meta.isVideo) return false
      if (filterDescribed && !s.ai_summary) return false
      if (onlyUnlinked && s.performer_id != null) return false
      if (onlyUnrated && (s.rating ?? 0) > 0) return false
      if (onlyRecent && !recentShotIds.has(s.id)) return false
      if (lc && !ftsResults) {
        if (!meta.searchText.includes(lc)) return false
      }
      return true
    })
  }, [sortedShots, tab, favorites, deferredSearch, ftsResults, filterDescribed, activePlaylistId, playlistShots, allShotMeta, onlyUnlinked, onlyUnrated, onlyRecent, recentShotIds])

  const showGrouped = term === null && !trimmedSearch && tab === "all" && !filterDescribed

  async function handleSurpriseMe() {
    let pool = visibleShots
    try {
      const topRatedPool = await qc.fetchQuery({
        queryKey: ["top-rated-screenshots"],
        queryFn: api.topRatedScreenshots,
        staleTime: 5 * 60_000,
      })
      if (topRatedPool.length > 0) pool = topRatedPool
    } catch {
      // Fall back to the current visible pool if the optional fetch fails.
    }
    if (pool.length === 0) return
    const pick = pool[Math.floor(Math.random() * pool.length)]
    setLightboxShotId(pick.id)
  }

  const grouped = useMemo<Map<string, Screenshot[]>>(() => {
    if (!showGrouped) return new Map()
    const m = new Map<string, Screenshot[]>()
    for (const s of visibleShots) {
      const arr = m.get(s.term)
      if (arr) arr.push(s)
      else m.set(s.term, [s])
    }
    return m
  }, [showGrouped, visibleShots])

  const groupedSections = useMemo(
    () => [...grouped.entries()].map(([label, shots]) => ({ label, shots })),
    [grouped]
  )

  // Group shots into rows for the virtual flat grid
  const colCount = GRID_COLS[gridDensity]
  const flatGridRows = useMemo(() => {
    if (viewMode !== "grid" || showGrouped) return []
    const rows: Screenshot[][] = []
    for (let i = 0; i < visibleShots.length; i += colCount) {
      rows.push(visibleShots.slice(i, i + colCount))
    }
    return rows
  }, [visibleShots, viewMode, showGrouped, colCount])

  const [scrollMargin, setScrollMargin] = useState(0)
  useEffect(() => {
    const el = virtualizerContainerRef.current
    if (el) {
      const measure = () => setScrollMargin(el.offsetTop)
      measure()
      // Re-measure after layout settles
      const raf = requestAnimationFrame(measure)
      return () => cancelAnimationFrame(raf)
    }
  }, [visibleShots.length, viewMode, tab])

  const flatGridVirtualizer = useWindowVirtualizer({
    count: flatGridRows.length,
    estimateSize: () => GRID_ROW_SIZE_ESTIMATE[gridDensity],
    overscan: 6,
    scrollMargin,
    scrollPaddingStart: 8,
  })

  // ── Tab counts ───────────────────────────────────────────────────────────

  const sourceCounts = useMemo(() => {
    if (sources.length > 0) {
      let total = 0
      let ddg = 0
      let redgifs = 0
      let ytdlp = 0
      for (const source of sources) {
        total += source.count
        if (source.source === "ddg") ddg = source.count
        else if (source.source === "redgifs") redgifs = source.count
        else if (source.source === "ytdlp") ytdlp = source.count
      }
      return { total, ddg, redgifs, ytdlp }
    }

    let total = 0
    let ddg = 0
    let redgifs = 0
    let ytdlp = 0
    for (const shot of allShots) {
      total += 1
      if (shot.source === "ddg") ddg += 1
      else if (shot.source === "redgifs") redgifs += 1
      else if (shot.source === "ytdlp") ytdlp += 1
    }
    return { total, ddg, redgifs, ytdlp }
  }, [allShots, sources])
  const ddgCount = sourceCounts.ddg
  const redgifsCount = sourceCounts.redgifs
  const tubeCount = sourceCounts.ytdlp
  const totalCount = sourceCounts.total
  const favCount = favorites.size

  // ── Favorites ────────────────────────────────────────────────────────────

  function toggleFavorite(id: number) {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Single describe ──────────────────────────────────────────────────────

  async function handleSingleDescribe(id: number) {
    try {
      addToast("Describing...", "info")
      await api.summarizeScreenshot(id)
      qc.invalidateQueries({ queryKey: ["screenshots"] })
      qc.invalidateQueries({ queryKey: ["media-stats"] })
      addToast("Description complete", "success")
    } catch {
      addToast("Describe failed", "error")
    }
  }

  // ── Batch ────────────────────────────────────────────────────────────────

  function toggleSelect(id: number) {
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  function selectShots(ids: number[]) {
    setSelectedIds(new Set(ids))
    setBatchMode(true)
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds]
    try {
      const res = await api.bulkDeleteScreenshots(ids)
      qc.invalidateQueries({ queryKey: ["screenshots"] })
      qc.invalidateQueries({ queryKey: ["screenshot-sources"] })
      qc.invalidateQueries({ queryKey: ["media-stats"] })
      setSelectedIds(new Set())
      setBatchMode(false)
      addToast(res.deleted ? `Deleted ${res.deleted}` : "Nothing to delete", res.deleted ? "success" : "error")
    } catch {
      addToast("Delete failed", "error")
    }
  }

  async function handleBulkFavorite() {
    setFavorites((prev) => {
      const next = new Set(prev)
      selectedIds.forEach((id) => next.add(id))
      return next
    })
    addToast(`${selectedIds.size} favorited`, "success")
    setSelectedIds(new Set())
    setBatchMode(false)
  }

  async function handleBatchDescribe() {
    const ids = [...selectedIds]
    setDescribeProgress({ done: 0, total: ids.length })
    try {
      const res = await api.batchDescribeScreenshots(ids)
      setDescribeProgress(null)
      qc.invalidateQueries({ queryKey: ["screenshots"] })
      qc.invalidateQueries({ queryKey: ["media-stats"] })
      addToast(`Described ${res.processed} screenshot${res.processed !== 1 ? "s" : ""}${res.failed ? `, ${res.failed} failed` : ""}`, res.processed ? "success" : "error")
      setSelectedIds(new Set())
      setBatchMode(false)
    } catch {
      setDescribeProgress(null)
      addToast("Batch describe failed", "error")
    }
  }

  // Auto-describe after capture completes
  const prevCapForAuto = useRef(false)
  useEffect(() => {
    if (prevCapForAuto.current && !capturing && autoDescribe) {
      // Describe undescribed screenshots from latest batch
      const undescribed = allShots.filter((s) => !s.ai_summary).map((s) => s.id).slice(0, 10)
      if (undescribed.length > 0) {
        api.batchDescribeScreenshots(undescribed).then((res) => {
          qc.invalidateQueries({ queryKey: ["screenshots"] })
          qc.invalidateQueries({ queryKey: ["media-stats"] })
          addToast(`Auto-described ${res.processed} new screenshot${res.processed !== 1 ? "s" : ""}`, "success")
        }).catch(() => {})
      }
    }
    prevCapForAuto.current = capturing
  }, [capturing, autoDescribe, allShots, qc, addToast])

  // ── Capture ──────────────────────────────────────────────────────────────

  async function handleCapture() {
    try {
      const res = await api.triggerCapture()
      qc.invalidateQueries({ queryKey: ["screenshot-status"] })
      addToast(res.status === "already_running" ? "Already running" : "Capture started", "success")
    } catch { addToast("Failed to start capture", "error") }
  }

  async function handleCaptureVideos() {
    try {
      const res = await api.captureVideos()
      addToast(`Video capture started for ${res.terms} terms`, "success")
    } catch { addToast("Video capture failed", "error") }
  }

  async function handlePurgeWomen() {
    if (!window.confirm("Scan all stored media, including local video frames, and delete anything that appears to include women? This runs in the background.")) return
    try {
      const res = await api.purgeWomen()
      addToast(`Purge started — scanning ${res.to_scan} assets`, "success")
    } catch (e: any) {
      addToast(e?.message?.includes("503") ? "Vision API key not configured" : "Purge failed", "error")
    }
  }

  async function handleAutoTag() {
    setAutoTagging(true)
    try {
      const res = await api.autoTagScreenshots(100)
      qc.invalidateQueries({ queryKey: ["screenshots"] })
      qc.invalidateQueries({ queryKey: ["screenshot-all-tags"] })
      addToast(res.tagged > 0 ? `Tagged ${res.tagged} item${res.tagged !== 1 ? "s" : ""}` : "Nothing to tag", res.tagged > 0 ? "success" : "info")
    } catch {
      addToast("Auto-tag failed", "error")
    } finally {
      setAutoTagging(false)
    }
  }

  async function handleCaptureAllCreators() {
    setCapturingAll(true)
    try {
      const res = await api.captureAllPerformers()
      addToast(`Queued capture for ${res.queued} creators`, "success")
      qc.invalidateQueries({ queryKey: ["performers-for-media"] })
    } catch {
      addToast("Failed to queue captures", "error")
    } finally {
      setCapturingAll(false)
    }
  }

  async function handleBackfillPerformers() {
    try {
      const res = await api.backfillPerformerLinks()
      addToast(`Linked ${res.linked} unlinked shot${res.linked !== 1 ? "s" : ""} to creators`, res.linked > 0 ? "success" : "info")
      qc.invalidateQueries({ queryKey: ["screenshots"] })
      qc.invalidateQueries({ queryKey: ["performers-for-media"] })
      qc.invalidateQueries({ queryKey: ["media-stats"] })
    } catch {
      addToast("Backfill failed", "error")
    }
  }

  async function handleCaptureUrl() {
    const url = urlInput.trim()
    if (!url) return
    setUrlCapturing(true)
    try {
      const shot = await api.captureFromUrl(url, urlTerm.trim() || undefined)
      qc.invalidateQueries({ queryKey: ["screenshots"] })
      qc.invalidateQueries({ queryKey: ["screenshot-sources"] })
      qc.invalidateQueries({ queryKey: ["media-stats"] })
      addToast("Media captured", "success")
      setUrlInput("")
      setUrlTerm("")
      setUrlInputOpen(false)
      openMedia(shot)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Capture failed"
      addToast(msg, "error")
    } finally {
      setUrlCapturing(false)
    }
  }

  function handleRunDiscovery() {
    if (!discoveryQuery.trim() && mediaCreatorId == null && !term) {
      setDiscoveryOpen(true)
      addToast("Enter a discovery prompt or open Media from a creator first", "info")
      return
    }
    discoverCreatorsMutation.mutate()
  }

  function handleImportSuggestedCreator(creator: DiscoveredCreator) {
    importDiscoveredMutation.mutate([creator])
  }

  function handleImportAllSuggestedCreators() {
    if (discoveryCandidates.length === 0) return
    importDiscoveredMutation.mutate(discoveryCandidates)
  }

  function clearMediaFilters() {
    setSearch("")
    setTerm(null)
    setTab("all")
    setFilterDescribed(false)
    setOnlyUnlinked(false)
    setOnlyUnrated(false)
    setOnlyRecent(false)
    setAdvancedFilters(EMPTY_FILTERS)
    setActiveTagFilter(null)
    setActivePlaylistId(null)
    setMediaCreator(null)
  }

  function applySearchSuggestion(suggestion: SearchSuggestion) {
    if (suggestion.type === "term") {
      setTerm(suggestion.value)
      setSearch("")
      return
    }
    if (suggestion.type === "tag") {
      setActiveTagFilter(suggestion.value)
      setSearch("")
      setAdvancedOpen(true)
      return
    }
    const match = (creatorsData?.performers ?? []).find((creator) => creator.username.toLowerCase() === suggestion.value.toLowerCase())
    if (match) {
      setMediaCreator(match.id, match.username)
      setTab("all")
    }
    setSearch("")
  }

  // ── Keyboard shortcuts help overlay ──────────────────────────────────────

  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [heroCollapsed, setHeroCollapsed] = useState(true)
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false)
  const [filtersVisible, setFiltersVisible] = useState(false)

  // ── Keyboard ─────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        setShortcutsOpen((v) => !v)
        return
      }
      if (e.key === "Escape") {
        setShortcutsOpen(false)
        return
      }
      if (shortcutsOpen) return
      if (e.key === "m" && !e.metaKey && !e.ctrlKey) {
        setBatchMode((v) => { if (v) setSelectedIds(new Set()); return !v })
      }
      if (e.key === "r" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        handleSurpriseMe()
      }
      if (e.key === "p" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setAdvancedFilters((f) => ({ ...f, hasPerformer: f.hasPerformer === true ? null : true }))
      }
      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) handleViewModeChange("grid")
      if (e.key === "l" && !e.metaKey && !e.ctrlKey && !e.altKey) handleViewModeChange("list")
      if (e.key === "t" && !e.metaKey && !e.ctrlKey && !e.altKey) handleViewModeChange("timeline")
      if (e.key === "v" && !e.metaKey && !e.ctrlKey && !e.altKey) handleViewModeChange("feed")
      if (e.key === "o" && !e.metaKey && !e.ctrlKey && !e.altKey) handleViewModeChange("mosaic")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcutsOpen])

  // ── Infinite scroll sentinel ─────────────────────────────────────────────

  const observerRef = useRef<IntersectionObserver | null>(null)
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) observerRef.current.disconnect()
    if (!node) return
    observerRef.current = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    }, { rootMargin: "1200px 0px" })
    observerRef.current.observe(node)
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  // Prefetch next page when user reaches 80% scroll depth
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return
    const onScroll = () => {
      const scrolled = window.scrollY + window.innerHeight
      const total = document.documentElement.scrollHeight
      if (total > 0 && scrolled / total >= 0.8) {
        void fetchNextPage()
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const mosaicObserverRef = useRef<IntersectionObserver | null>(null)
  const mosaicSentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (mosaicObserverRef.current) mosaicObserverRef.current.disconnect()
    if (!node || viewMode !== "mosaic" || mosaicVisibleCount >= visibleShots.length) return
    mosaicObserverRef.current = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      startTransition(() => {
        setMosaicVisibleCount((count) => Math.min(count + MOSAIC_BATCH_SIZE, visibleShots.length))
      })
    }, { rootMargin: "1000px 0px" })
    mosaicObserverRef.current.observe(node)
  }, [mosaicVisibleCount, viewMode, visibleShots.length])

  useEffect(() => {
    if (viewMode !== "mosaic") return
    setMosaicVisibleCount((count) => {
      const baseline = getInitialMosaicVisibleCount()
      const next = Math.min(Math.max(count, baseline), visibleShots.length || baseline)
      return next === count ? count : next
    })
  }, [term, tab, viewMode, sortOrder, advancedFilters, filterDescribed, onlyUnlinked, onlyUnrated, onlyRecent, visibleShots.length])

  // ── Lightbox ─────────────────────────────────────────────────────────────

  const lightboxShot = lightboxShotId != null ? (shotById.get(lightboxShotId) ?? null) : null
  const lightboxIdx = lightboxShotId != null ? visibleShots.findIndex((s) => s.id === lightboxShotId) : -1

  // ── Tabs config ──────────────────────────────────────────────────────────

  const ratedCount = useMemo(() => allShots.filter((s) => (s.rating ?? 0) > 0).length, [allShots])

  const tabs: { key: TabFilter; label: string; count?: number }[] = [
    { key: "all", label: "All", count: totalCount },
    { key: "videos", label: "Videos" },
    { key: "images", label: "Images" },
    { key: "favorites", label: "Favorites", count: favCount },
  ]

  // ── Grid density handler ─────────────────────────────────────────────────

  function handleDensityChange(d: GridDensity) {
    startTransition(() => setGridDensity(d))
  }

  function handleViewModeChange(mode: ViewMode) {
    startTransition(() => setViewMode(mode))
  }

  const filteredCreators = useMemo(() => {
    const lc = deferredCreatorSearch.toLowerCase()
    return (creatorsData?.performers ?? [])
      .filter((p) => {
        if (creatorPlatformFilter !== "all" && p.platform !== creatorPlatformFilter) return false
        if (creatorFavoritesOnly && !p.is_favorite) return false
        if (lc && !`${p.username} ${p.display_name ?? ""}`.toLowerCase().includes(lc)) return false
        return true
      })
      .sort((a, b) =>
        creatorSort === "shots"
          ? (b.screenshots_count ?? 0) - (a.screenshots_count ?? 0)
          : (a.display_name ?? a.username).localeCompare(b.display_name ?? b.username)
      )
  }, [creatorsData, creatorPlatformFilter, creatorFavoritesOnly, deferredCreatorSearch, creatorSort])

  const discoverySeedLabel = mediaCreatorName
    ? `@${mediaCreatorName}`
    : term
    ? term
    : activeTagFilter
    ? `#${activeTagFilter}`
    : "your media library"

  const discoveryPrompt = discoveryQuery.trim()
    || (mediaCreatorName
      ? `Creators similar to @${mediaCreatorName}`
      : term
      ? `Creators related to ${term}`
      : "Find creators similar to your current media")
  const showDescribedRail = tab !== "creators" && !filterDescribed && !trimmedSearch && !discoveryOpen && !analyticsOpen
  const showRecentRail = tab !== "creators" && !trimmedSearch && !filterDescribed && !discoveryOpen && viewHistory.length > 0

  const activeFilterPills = useMemo(() => {
    const pills: string[] = []
    if (term) pills.push(`Term: ${term}`)
    if (trimmedSearch) pills.push(`Search: ${trimmedSearch}`)
    if (tab !== "all") pills.push(`Tab: ${tabs.find((item) => item.key === tab)?.label ?? tab}`)
    if (activeTagFilter) pills.push(`#${activeTagFilter}`)
    if (advancedFilters.hasPerformer === true) pills.push("Linked creators")
    if (advancedFilters.mediaType !== "any") pills.push(advancedFilters.mediaType === "photo" ? "Photos" : "Videos")
    if (filterDescribed) pills.push("AI described")
    if (onlyUnlinked) pills.push("Unlinked only")
    if (onlyUnrated) pills.push("Unrated only")
    if (onlyRecent) pills.push("Last 7 days")
    if (activePlaylistId != null && playlistDetail?.playlist?.name) pills.push(`Playlist: ${playlistDetail.playlist.name}`)
    return pills
  }, [term, trimmedSearch, tab, activeTagFilter, advancedFilters.hasPerformer, advancedFilters.mediaType, filterDescribed, onlyUnlinked, onlyUnrated, onlyRecent, activePlaylistId, playlistDetail, tabs])

  const discoveryCandidates = useMemo(
    () =>
      discoveryResults
        .filter((creator) => !discoveredUsernames.has(creator.username.toLowerCase()))
        .sort((a, b) => Number(a.exists) - Number(b.exists) || (b.tags.length - a.tags.length) || a.username.localeCompare(b.username)),
    [discoveryResults, discoveredUsernames],
  )
  const orderedDiscoveryResults = useMemo(
    () => [...discoveryResults].sort((a, b) => Number(a.exists) - Number(b.exists) || (b.tags.length - a.tags.length) || a.username.localeCompare(b.username)),
    [discoveryResults],
  )
  const visibleSummary = useMemo(() => {
    let videos = 0
    let linked = 0
    let described = 0
    let rated = 0
    for (const shot of visibleShots) {
      const meta = allShotMeta.get(shot.id)
      if (meta?.isVideo) videos += 1
      if (shot.performer_id != null) linked += 1
      if (shot.ai_summary) described += 1
      if ((shot.rating ?? 0) > 0) rated += 1
    }
    return {
      total: visibleShots.length,
      videos,
      images: Math.max(visibleShots.length - videos, 0),
      linked,
      described,
      unrated: Math.max(visibleShots.length - rated, 0),
    }
  }, [visibleShots, allShotMeta])
  const creatorCounts = useMemo(() => {
    const performers = creatorsData?.performers ?? []
    let favorites = 0
    let linked = 0
    for (const performer of performers) {
      if (performer.is_favorite) favorites += 1
      if ((performer.screenshots_count ?? performer.media_count ?? performer.media_total ?? 0) > 0) linked += 1
    }
    return {
      total: performers.length,
      favorites,
      linked,
    }
  }, [creatorsData])
  const searchSuggestions = useMemo<SearchSuggestion[]>(() => {
    const lc = deferredTrimmedSearch.toLowerCase()
    if (!lc || lc.length < 3) return []
    const suggestions: SearchSuggestion[] = []
    for (const item of termBrowserItems) {
      if (item.term.toLowerCase().includes(lc)) suggestions.push({ type: "term", value: item.term, meta: `${item.count} shots` })
      if (suggestions.length >= 3) break
    }
    for (const tag of userTags) {
      if (tag.tag.toLowerCase().includes(lc)) suggestions.push({ type: "tag", value: tag.tag, meta: `${tag.count} tagged` })
      if (suggestions.length >= 6) break
    }
    for (const creator of creatorsData?.performers ?? []) {
      const label = `${creator.username} ${creator.display_name ?? ""}`.toLowerCase()
      if (label.includes(lc)) {
        suggestions.push({
          type: "creator",
          value: creator.username,
          meta: `${(creator.screenshots_count ?? creator.media_count ?? creator.media_total ?? 0).toLocaleString()} shots`,
        })
      }
      if (suggestions.length >= 8) break
    }
    return suggestions
  }, [deferredTrimmedSearch, termBrowserItems, userTags, creatorsData])
  const discoveryOverview = useMemo(() => ({
    total: discoveryResults.length,
    newCount: discoveryResults.filter((creator) => !creator.exists).length,
    existingCount: discoveryResults.filter((creator) => creator.exists).length,
  }), [discoveryResults])
  const recentShots = useMemo(() => {
    return viewHistory
      .map((id) => shotById.get(id))
      .filter((shot): shot is Screenshot => shot != null)
  }, [viewHistory, shotById])

  // Timeline groups
  const timelineGroups = useMemo(() => {
    if (viewMode !== "timeline") return new Map<string, Screenshot[]>()
    const m = new Map<string, Screenshot[]>()
    const order = ["Today", "Yesterday", "This Week", "This Month", "Older"]
    for (const label of order) m.set(label, [])
    for (const s of visibleShots) {
      const group = getTimelineGroup(s.captured_at)
      const arr = m.get(group)
      if (arr) arr.push(s)
    }
    // Remove empty groups
    for (const [key, val] of m) {
      if (val.length === 0) m.delete(key)
    }
    return m
  }, [viewMode, visibleShots])

  const timelineSections = useMemo(
    () => [...timelineGroups.entries()].map(([label, shots]) => ({ label, shots })),
    [timelineGroups]
  )

  const activeSectionEntries = useMemo(() => {
    if (viewMode === "grid" && showGrouped) return groupedSections
    if (viewMode === "timeline") return timelineSections
    return []
  }, [groupedSections, showGrouped, timelineSections, viewMode])

  const sectionVirtualizer = useWindowVirtualizer({
    count: activeSectionEntries.length,
    estimateSize: (index) =>
      estimateGridSectionHeight(activeSectionEntries[index]?.shots.length ?? 1, colCount, gridDensity),
    overscan: 4,
    scrollMargin,
    scrollPaddingStart: 8,
  })

  const listVirtualizer = useWindowVirtualizer({
    count: viewMode === "list" ? visibleShots.length : 0,
    estimateSize: () => 86,
    overscan: 12,
    scrollMargin,
  })

  const visibleMosaicShots = useMemo(
    () => (viewMode === "mosaic" ? visibleShots.slice(0, mosaicVisibleCount) : []),
    [mosaicVisibleCount, viewMode, visibleShots]
  )
  const hasMoreMosaicShots = visibleMosaicShots.length < visibleShots.length

  // Context menu handlers
  function handleContextMenu(e: React.MouseEvent, shot: Screenshot) {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, shot })
  }

  async function handleContextCopyUrl(shot: Screenshot) {
    const url = shot.page_url || shot.local_url || ""
    try {
      await navigator.clipboard.writeText(url)
      addToast("URL copied", "success")
    } catch {
      addToast("Failed to copy", "error")
    }
  }

  function handleContextAddToPlaylist(shot: Screenshot, playlistId: number) {
    api.addToPlaylist(playlistId, [shot.id]).then(() => {
      addToast("Added to playlist", "success")
      qc.invalidateQueries({ queryKey: ["playlists"] })
    }).catch(() => addToast("Failed", "error"))
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const expandedShot = expandedVideoShot ?? (expandedVideoId != null ? (shotById.get(expandedVideoId) ?? null) : null)
  const gridClass = GRID_CLASSES[gridDensity]

  function openMedia(shot: Screenshot) {
    setViewHistory((prev) => [shot.id, ...prev.filter((h) => h !== shot.id)].slice(0, 20))
    // Use isVideoShot (checks source + URL) as primary; fall back to URL-extension check
    const src = getScreenshotMediaSrc(shot)
    if (isVideoShot(shot) || isVideo(src)) {
      void preloadInlineVideoPlayer()
      setExpandedVideoShot(shot)
      setExpandedVideoId(shot.id)
    } else {
      void preloadMediaLightbox()
      setLightboxShotId(shot.id)
    }
  }

  function renderCard(shot: Screenshot, index = 0) {
    const src = getScreenshotMediaSrc(shot)
    const prefetchViewer = () => {
      if (src && isVideo(src)) void preloadInlineVideoPlayer()
      else void preloadMediaLightbox()
    }
    return (
      <MediaCard
        key={shot.id}
        shot={shot}
        index={index}
        onClick={() => openMedia(shot)}
        onHover={prefetchViewer}
        batchMode={batchMode}
        selected={selectedIds.has(shot.id)}
        onSelect={() => toggleSelect(shot.id)}
        favorite={favorites.has(shot.id)}
        onToggleFavorite={() => toggleFavorite(shot.id)}
        onDescribe={() => handleSingleDescribe(shot.id)}
        onRate={(rating) => rateMutation.mutate({ id: shot.id, rating })}
        onContextMenu={(e) => handleContextMenu(e, shot)}
        onNavigateToPerformer={(performerId) => {
          setPendingPerformer(performerId)
          setActiveView("performers")
        }}
      />
    )
  }

  function renderListItem(shot: Screenshot) {
    const src = getScreenshotMediaSrc(shot)
    const prefetchViewer = () => {
      if (src && isVideo(src)) void preloadInlineVideoPlayer()
      else void preloadMediaLightbox()
    }
    return (
      <Suspense fallback={<InlineLoadingFallback label="Loading item" />}>
        <MediaListItem
          shot={shot}
          onClick={() => openMedia(shot)}
          onHover={prefetchViewer}
          favorite={favorites.has(shot.id)}
          onToggleFavorite={() => toggleFavorite(shot.id)}
          onRate={(rating) => rateMutation.mutate({ id: shot.id, rating })}
          onContextMenu={(e) => handleContextMenu(e, shot)}
        />
      </Suspense>
    )
  }

  function renderGrid(shots: Screenshot[]) {
    const items: React.ReactNode[] = []
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i]
      items.push(renderCard(shot, i))
    }
    return items
  }

  function handleClickDescribedShot(shot: Screenshot) {
    openMedia(shot)
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col">
      {/* ── Capture progress bar ─────────────────────────────────────────── */}
      {statusData?.running && statusData.current_term && (
        <div className="flex items-center gap-3 px-4 py-2">
          <div className="h-1 flex-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-500"
              style={{ width: `${((statusData.terms_done || 0) / (statusData.terms_total || 1)) * 100}%` }}
            />
          </div>
          <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
            {statusData.current_term} ({statusData.items_found || 0} found)
          </span>
        </div>
      )}

      {/* ── Media Stats Bar ──────────────────────────────────────────── */}
      <MediaStatsBar stats={mediaStatsData} />

      {/* ── Playlist Header (when viewing a playlist) ─────────────────── */}
      {activePlaylistId != null && playlistDetail && (
        <Suspense fallback={<InlineLoadingFallback className="mx-4 mt-2" label="Loading playlist" />}>
          <PlaylistHeader
            playlist={playlistDetail.playlist}
            onBack={() => setActivePlaylistId(null)}
            onPopulate={playlistDetail.playlist.is_smart ? () => populateMutation.mutate(activePlaylistId) : undefined}
            onDelete={() => deletePlaylistMutation.mutate(activePlaylistId)}
          />
        </Suspense>
      )}

      <div className="px-4 pb-3">
        <div className="hero-surface rounded-[30px] px-4 py-5 sm:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="eyebrow mb-2">Media Library</p>
              <h1 className="hero-title text-[clamp(1.8rem,3vw,2.8rem)] leading-none text-text-primary">
                {mediaCreatorName ? `@${mediaCreatorName}` : term ? term : "Publish-Ready Stream"}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary sm:text-[15px]">
                {mediaCreatorName
                  ? "A focused creator stream with faster playback, cleaner matching, and fewer dead ends."
                  : term
                  ? "A tighter themed stream tuned for fast scanning, confident creator labels, and smoother playback."
                  : "A faster cross-web stream with creator-aware curation, lighter first paint, and cleaner controls."}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:w-[360px]">
              <button
                onClick={handleCapture}
                disabled={capturing}
                className="rounded-2xl border border-accent/30 bg-accent/12 px-4 py-3 text-left text-sm font-medium text-text-primary transition-colors hover:bg-accent/18 disabled:opacity-50"
              >
                {capturing ? "Capture running" : "Capture new media"}
              </button>
              <button
                onClick={() => handleViewModeChange("feed")}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm font-medium text-text-primary transition-colors hover:bg-white/[0.07]"
              >
                Open video feed
              </button>
              <button
                onClick={() => {
                  setDiscoveryOpen(true)
                  if (!discoveryResults.length) handleRunDiscovery()
                }}
                className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-left text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-400/16"
              >
                Discover similar creators
              </button>
              <button
                onClick={clearMediaFilters}
                disabled={activeFilterPills.length === 0}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm font-medium text-text-secondary transition-colors hover:bg-white/[0.06] disabled:opacity-40"
              >
                Reset current view
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3">
              <p className="eyebrow">Visible now</p>
              <p className="mt-2 text-2xl font-semibold text-text-primary">{(visibleSummary.total ?? 0).toLocaleString()}</p>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3">
              <p className="eyebrow">Creator linked</p>
              <p className="mt-2 text-2xl font-semibold text-text-primary">{(visibleSummary.linked ?? 0).toLocaleString()}</p>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3">
              <p className="eyebrow">Videos</p>
              <p className="mt-2 text-2xl font-semibold text-text-primary">{(visibleSummary.videos ?? 0).toLocaleString()}</p>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3">
              <p className="eyebrow">Needs rating</p>
              <p className="mt-2 text-2xl font-semibold text-text-primary">{(visibleSummary.unrated ?? 0).toLocaleString()}</p>
            </div>
          </div>

          {activeFilterPills.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {activeFilterPills.map((pill) => (
                <span key={pill} className="ui-chip ui-chip-active">
                  {pill}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="sticky top-14 z-20 px-4 py-2 backdrop-blur-lg">
        <div className="section-shell flex items-center gap-2 rounded-[24px] px-3 py-2.5 shadow-[0_10px_26px_rgba(0,0,0,0.2)] backdrop-blur-lg">
          {/* Search input */}
          <div className="relative flex-1 max-w-md">
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              placeholder="Search..."
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                &times;
              </button>
            )}
            {ftsSearching && (
              <div className="absolute right-8 top-1/2 -translate-y-1/2"><Spinner /></div>
            )}
            {/* Recent searches dropdown */}
            {searchFocused && !search && recentSearches.length > 0 && (
              <div className="absolute left-0 top-full mt-1 z-50 w-full rounded-xl border border-white/10 bg-[#0d1526]/95 backdrop-blur-lg shadow-xl overflow-hidden">
                <div className="px-3 py-1.5 border-b border-white/5 flex items-center justify-between">
                  <span className="text-[10px] text-white/30 font-mono uppercase tracking-widest">Recent</span>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); setRecentSearches([]) }}
                    className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
                  >
                    clear
                  </button>
                </div>
                {recentSearches.map((s) => (
                  <button
                    key={s}
                    onMouseDown={(e) => { e.preventDefault(); setSearch(s) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/30 shrink-0">
                      <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.92"/>
                    </svg>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {showSearchSuggestions && searchSuggestions.length > 0 && (
              <div className="absolute left-0 top-full mt-1 z-50 w-full rounded-xl border border-white/10 bg-[#0d1526]/95 backdrop-blur-lg shadow-xl overflow-hidden">
                <div className="px-3 py-1.5 border-b border-white/5">
                  <span className="text-[10px] text-white/30 font-mono uppercase tracking-widest">Jump to</span>
                </div>
                {searchSuggestions.map((suggestion) => (
                  <button
                    key={`${suggestion.type}-${suggestion.value}`}
                    onMouseDown={(e) => { e.preventDefault(); applySearchSuggestion(suggestion) }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors"
                  >
                    <span>
                      <span className="mr-2 rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-white/40">
                        {suggestion.type}
                      </span>
                      {suggestion.value}
                    </span>
                    {suggestion.meta && <span className="text-[10px] text-white/35">{suggestion.meta}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Filters toggle */}
          <button
            onClick={() => setFiltersVisible((v) => !v)}
            className={cn(
              "rounded-xl px-2.5 py-2 text-xs transition-colors whitespace-nowrap",
              filtersVisible || advancedOpen
                ? "bg-blue-500/20 text-blue-400"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            )}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block mr-1">
              <line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" />
            </svg>
            Filters{Object.values(advancedFilters).some((v) => v !== "" && v !== 0 && v !== null && v !== "any" && !(Array.isArray(v) && v.length === 0)) ? " *" : ""}
          </button>

          {/* Sort dropdown */}
          <select
            value={sortOrder}
            onChange={(e) => {
              const v = e.target.value as SortOrder
              setSortOrder(v)
            }}
            className="rounded-xl border border-white/10 bg-black/20 px-2.5 py-2 text-xs text-[var(--color-text-secondary)]"
            aria-label="Sort order"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="rating">Top Rated</option>
            <option value="az">A–Z</option>
            <option value="random">Random</option>
          </select>

          {/* View mode toggle — Grid / Feed */}
          <div className="flex rounded-lg border border-white/10 bg-black/20 overflow-hidden">
            <button
              onClick={() => handleViewModeChange("grid")}
              title="Grid view"
              className={cn(
                "flex items-center justify-center px-2 py-1.5 transition-colors",
                viewMode === "grid" ? "bg-white/10 text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              )}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="0" y="0" width="4" height="4" rx="0.5" />
                <rect x="5" y="0" width="4" height="4" rx="0.5" />
                <rect x="10" y="0" width="4" height="4" rx="0.5" />
                <rect x="0" y="5" width="4" height="4" rx="0.5" />
                <rect x="5" y="5" width="4" height="4" rx="0.5" />
                <rect x="10" y="5" width="4" height="4" rx="0.5" />
              </svg>
            </button>
            <button
              onClick={() => handleViewModeChange("feed")}
              onMouseEnter={() => { void preloadVideoFeed() }}
              onFocus={() => { void preloadVideoFeed() }}
              title="Video feed"
              className={cn(
                "flex items-center justify-center px-2 py-1.5 transition-colors",
                viewMode === "feed" ? "bg-white/10 text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              )}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="1" width="10" height="12" rx="1.5" />
                <polygon points="5.5,4.5 9.5,7 5.5,9.5" fill="currentColor" stroke="none" />
              </svg>
            </button>
          </div>

          {/* Visible count */}
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] text-slate-300 whitespace-nowrap">
            {(visibleShots.length ?? 0).toLocaleString()} items
          </span>

          {/* Overflow menu */}
          <div className="relative ml-auto">
            <button
              onClick={() => setOverflowMenuOpen((v) => !v)}
              className="rounded-lg px-2 py-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/5 transition-colors"
              title="More actions"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
            {overflowMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOverflowMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-xl border border-white/10 bg-[#0d1526]/95 backdrop-blur-lg shadow-xl overflow-hidden">
                  <div className="py-1">
                    <button
                      onClick={() => { setSlideshowActive(true); setOverflowMenuOpen(false) }}
                      onMouseEnter={() => { void preloadSlideshowMode() }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors"
                    >
                      Slideshow
                    </button>
                    <button
                      onClick={() => { handleSurpriseMe(); setOverflowMenuOpen(false) }}
                      title="Pick a random top-rated item"
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors"
                    >
                      Surprise me
                    </button>
                    <button
                      onClick={() => { setBatchMode((v) => { if (v) setSelectedIds(new Set()); return !v }); setOverflowMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors"
                    >
                      {batchMode ? "Cancel select" : "Select"}
                    </button>
                    <div className="border-t border-white/5 my-1" />
                    <button
                      onClick={() => { setPlaylistDropdownOpen((v) => !v); setOverflowMenuOpen(false) }}
                      onMouseEnter={() => { void preloadPlaylistPanel() }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors"
                    >
                      Playlists
                    </button>
                    <button
                      onClick={() => { setAnalyticsOpen((v) => !v); setOverflowMenuOpen(false) }}
                      onMouseEnter={() => { void loadMediaAnalyticsDashboard() }}
                      className={cn("w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/[0.06]", analyticsOpen ? "text-emerald-400" : "text-white/70 hover:text-white")}
                    >
                      Analytics
                    </button>
                    <button
                      onClick={() => { setDiscoveryOpen((v) => !v); setOverflowMenuOpen(false) }}
                      className={cn("w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/[0.06]", discoveryOpen ? "text-emerald-400" : "text-white/70 hover:text-white")}
                    >
                      AI discovery
                    </button>
                    <div className="border-t border-white/5 my-1" />
                    <button
                      onClick={() => { handleCapture(); setOverflowMenuOpen(false) }}
                      disabled={capturing}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-accent)] hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                    >
                      {capturing ? "Capturing..." : "Capture"}
                    </button>
                    <div className="my-1 border-t border-white/10" />
                    <button
                      onClick={() => { handleCaptureVideos(); setOverflowMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-teal-300 hover:bg-white/[0.06] transition-colors"
                    >
                      + Videos
                    </button>
                    <button
                      onClick={() => { setUrlInputOpen((v) => !v); setOverflowMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors"
                    >
                      + URL
                    </button>
                    <div className="border-t border-white/5 my-1" />
                    <button
                      onClick={() => { handleAutoTag(); setOverflowMenuOpen(false) }}
                      disabled={autoTagging}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-purple-300 hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                    >
                      {autoTagging ? "Tagging..." : "Auto-Tag"}
                    </button>
                    <button
                      onClick={() => { setAdvancedFilters((f) => ({ ...f, hasPerformer: f.hasPerformer === true ? null : true })); setOverflowMenuOpen(false) }}
                      className={cn("w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/[0.06]", advancedFilters.hasPerformer === true ? "text-sky-300" : "text-white/70 hover:text-white")}
                    >
                      Creators Only
                    </button>
                    <div className="my-1 border-t border-red-500/20" />
                    <button
                      onClick={() => { handlePurgeWomen(); setOverflowMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-red-400 hover:bg-white/[0.06] transition-colors"
                    >
                      Purge female content
                    </button>
                    <div className="border-t border-white/5 my-1" />
                    <label className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={autoDescribe}
                        onChange={(e) => {
                          setAutoDescribe(e.target.checked)
                        }}
                        className="h-3 w-3 rounded border-white/20 bg-black/30 accent-[var(--color-accent)]"
                      />
                      <span className="text-xs text-[var(--color-text-muted)]">Auto-describe</span>
                    </label>
                    <button
                      onClick={() => { setShortcutsOpen(true); setOverflowMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors"
                    >
                      Keyboard shortcuts
                    </button>
                    <button
                      onClick={() => { setHeroCollapsed((v) => !v); setOverflowMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors"
                    >
                      {heroCollapsed ? "Show stats panel" : "Hide stats panel"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* URL input panel (shown when triggered from overflow menu) */}
        {urlInputOpen && (
          <div className="mt-2 flex flex-col gap-2 rounded-xl border border-white/10 bg-[#1a1a2e]/95 p-3 shadow-xl max-w-sm backdrop-blur">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCaptureUrl() }}
              placeholder="https://... (image, video, Redgifs)"
              autoFocus
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
            />
            <input
              type="text"
              value={urlTerm}
              onChange={(e) => setUrlTerm(e.target.value)}
              placeholder="Term / label (optional)"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCaptureUrl}
                disabled={!urlInput.trim() || urlCapturing}
                className="flex-1 rounded-lg bg-[var(--color-accent)]/80 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 hover:bg-[var(--color-accent)]"
              >
                {urlCapturing ? "Capturing..." : "Capture"}
              </button>
              <button
                onClick={() => setUrlInputOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Playlist dropdown (positioned here since Playlists moved to overflow) */}
        <Suspense fallback={null}>
          <PlaylistDropdown
            open={playlistDropdownOpen}
            onClose={() => setPlaylistDropdownOpen(false)}
            onSelectPlaylist={(id) => setActivePlaylistId(id)}
            onCreateNew={() => { setCreatePlaylistWithIds(undefined); setCreatePlaylistOpen(true) }}
          />
        </Suspense>

        {/* Filters panel -- shown when Filters button is clicked */}
        {filtersVisible && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-[#0a1322]/70 px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
              <span className="ui-chip !px-2 !py-0.5">term</span>
              <span className="ui-chip !px-2 !py-0.5">creator</span>
              <span className="ui-chip !px-2 !py-0.5">URL</span>
              <span className="ui-chip !px-2 !py-0.5">AI description</span>
            </div>
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className={cn(
                "rounded-lg px-2 py-1 text-[11px] transition-colors whitespace-nowrap",
                advancedOpen
                  ? "bg-blue-500/20 text-blue-400"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              )}
            >
              Advanced{Object.values(advancedFilters).some((v) => v !== "" && v !== 0 && v !== null && v !== "any" && !(Array.isArray(v) && v.length === 0)) ? " *" : ""}
            </button>
            {filterDescribed && (
              <button
                onClick={() => setFilterDescribed(false)}
                className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] text-purple-300 hover:bg-purple-500/30"
              >
                Showing described only &times;
              </button>
            )}
            {activeFilterPills.length > 0 && (
              <button
                onClick={clearMediaFilters}
                className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/70 hover:bg-white/10"
              >
                Reset all
              </button>
            )}
          </div>
        )}

        {/* Quick filters -- compact */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1 px-1">
          <button
            onClick={() => setOnlyUnlinked((v) => !v)}
            className={cn("rounded-full px-2.5 py-1 text-[10px] transition-colors", onlyUnlinked ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/50 border border-sky-400/30" : "bg-white/5 text-slate-400 hover:bg-white/10")}
          >
            Unlinked
          </button>
          <button
            onClick={() => setOnlyUnrated((v) => !v)}
            className={cn("rounded-full px-2.5 py-1 text-[10px] transition-colors", onlyUnrated ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/50 border border-amber-400/30" : "bg-white/5 text-slate-400 hover:bg-white/10")}
          >
            Needs rating
          </button>
          <button
            onClick={() => setOnlyRecent((v) => !v)}
            className={cn("rounded-full px-2.5 py-1 text-[10px] transition-colors", onlyRecent ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/50 border border-emerald-400/30" : "bg-white/5 text-slate-400 hover:bg-white/10")}
          >
            7 days
          </button>
          <button
            onClick={() => setFilterDescribed((v) => !v)}
            className={cn("rounded-full px-2.5 py-1 text-[10px] transition-colors", filterDescribed ? "bg-purple-500/20 text-purple-200 ring-1 ring-purple-400/50 border border-purple-400/30" : "bg-white/5 text-slate-400 hover:bg-white/10")}
          >
            Described
          </button>
          <button
            onClick={() => setAdvancedFilters((f) => ({ ...f, hasPerformer: f.hasPerformer === true ? null : true }))}
            className={cn("rounded-full px-2.5 py-1 text-[10px] transition-colors", advancedFilters.hasPerformer === true ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/50 border border-indigo-400/30" : "bg-white/5 text-slate-400 hover:bg-white/10")}
          >
            Creator-linked
          </button>
        </div>
      </div>

      {/* ── Hero stats panel (hidden by default, toggled from overflow menu) ── */}
      {!heroCollapsed && (
        <div className="px-4 pb-2">
          <div className="rounded-xl border border-white/8 bg-black/10 p-3">
            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-2">
                <p className="text-[10px] text-slate-400">Visible</p>
                <p className="text-lg font-semibold text-white">{(visibleSummary.total ?? 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-2">
                <p className="text-[10px] text-slate-400">Images</p>
                <p className="text-lg font-semibold text-white">{(visibleSummary.images ?? 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-2">
                <p className="text-[10px] text-slate-400">Videos</p>
                <p className="text-lg font-semibold text-white">{(visibleSummary.videos ?? 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-2">
                <p className="text-[10px] text-slate-400">Linked</p>
                <p className="text-lg font-semibold text-white">{(visibleSummary.linked ?? 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-2">
                <p className="text-[10px] text-slate-400">Described</p>
                <p className="text-lg font-semibold text-white">{(visibleSummary.described ?? 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-2">
                <p className="text-[10px] text-slate-400">Needs rating</p>
                <p className="text-lg font-semibold text-white">{(visibleSummary.unrated ?? 0).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Advanced Search Panel ──────────────────────────────────────── */}
      {advancedOpen && (
        <AdvancedSearchPanel
          filters={advancedFilters}
          onChange={setAdvancedFilters}
          onClear={() => { setAdvancedFilters(EMPTY_FILTERS); setActiveTagFilter(null) }}
          sources={sources}
          allTags={userTags}
        />
      )}

      {/* ── Analytics Dashboard ──────────────────────────────────────────── */}
      {analyticsOpen && (
        <Suspense fallback={<div className="border-b border-white/10 bg-white/[0.015] px-4 py-8"><div className="flex justify-center"><Spinner /></div></div>}>
          <MediaAnalyticsDashboard onClose={() => setAnalyticsOpen(false)} />
        </Suspense>
      )}

      {(discoveryOpen || mediaCreatorId != null || term) && (
        <Suspense fallback={<InlineLoadingFallback className="mx-4 my-2" label="Loading discovery" />}>
          <MediaDiscoveryPanel
            discoverySeedLabel={discoverySeedLabel}
            mediaCreatorId={mediaCreatorId}
            mediaCreatorName={mediaCreatorName}
            term={term}
            activeTagFilter={activeTagFilter}
            similarCreators={similarCreators}
            onSelectSimilarCreator={(id, username) => setMediaCreator(id, username)}
            onCaptureSimilarCreator={async (creator) => {
              try {
                await api.capturePerformerMedia(creator.id)
                qc.invalidateQueries({ queryKey: ["capture-queue"] })
                addToast(`Capture queued for @${creator.username}`, "success")
              } catch {
                addToast("Capture failed", "error")
              }
            }}
            discoveryQuery={discoveryQuery}
            onDiscoveryQueryChange={setDiscoveryQuery}
            discoveryPrompt={discoveryPrompt}
            discoveryPlatform={discoveryPlatform}
            onDiscoveryPlatformChange={setDiscoveryPlatform}
            onRunDiscovery={handleRunDiscovery}
            discoverPending={discoverCreatorsMutation.isPending}
            discoveryCandidatesLength={discoveryCandidates.length}
            onImportAllSuggestedCreators={handleImportAllSuggestedCreators}
            importPending={importDiscoveredMutation.isPending}
            discoveryOverview={discoveryOverview}
            orderedDiscoveryResults={orderedDiscoveryResults}
            isImportedUsername={(username) => discoveredUsernames.has(username.toLowerCase())}
            onImportSuggestedCreator={handleImportSuggestedCreator}
          />
        </Suspense>
      )}

      {/* ── Creator Filter Banner ────────────────────────────────────────── */}
      {mediaCreatorId != null && (
        <div className="flex items-center gap-2 bg-sky-500/10 border-b border-sky-500/20 px-4 py-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400 shrink-0"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span className="text-xs text-sky-300">Filtered by creator: <strong>@{mediaCreatorName}</strong></span>
          <button
            onClick={() => {
              setDiscoveryOpen(true)
              if (!discoveryResults.length) handleRunDiscovery()
            }}
            className="rounded px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20"
          >
            Find similar →
          </button>
          <button
            onClick={() => { setPendingPerformer(mediaCreatorId); setActiveView("performers") }}
            className="rounded px-2 py-0.5 text-[10px] text-sky-400 hover:bg-sky-500/20"
          >
            View profile →
          </button>
          <button
            onClick={() => setMediaCreator(null)}
            className="ml-auto rounded px-2 py-0.5 text-[10px] text-sky-400 hover:bg-sky-500/20"
          >
            Clear ×
          </button>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="hide-scrollbar flex gap-0 overflow-x-auto border-b border-white/10 px-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            onMouseEnter={() => { if (t.key === "creators") void preloadMediaCreatorsPanel() }}
            onClick={() => {
              startTransition(() => {
                setTab(t.key)
                if (t.key !== "creators") setFilterDescribed(false)
              })
            }}
            className={cn(
              "whitespace-nowrap px-3 py-2 text-sm transition-colors border-b-2",
              tab === t.key
                ? "border-[var(--color-accent)] text-[var(--color-text-primary)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            )}
          >
            {t.label}{t.count != null ? ` (${t.count})` : ""}
          </button>
        ))}
      </div>

      {/* ── Popular tag chips ─────────────────────────────────────────────── */}
      {userTags.length > 0 && tab !== "creators" && (
        <div className="hide-scrollbar flex items-center gap-1.5 overflow-x-auto px-4 py-2 border-b border-white/5">
          <span className="text-[10px] text-[var(--color-text-muted)] mr-1 whitespace-nowrap">Tags:</span>
          {activeTagFilter && (
            <button
              onClick={() => setActiveTagFilter(null)}
              className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)] hover:bg-white/15"
            >
              All
            </button>
          )}
          {userTags.slice(0, 20).map((t) => (
            <button
              key={t.tag}
              onClick={() => setActiveTagFilter(activeTagFilter === t.tag ? null : t.tag)}
              className={cn(
                "whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] transition-colors",
                activeTagFilter === t.tag
                  ? "bg-blue-500/30 text-blue-300"
                  : "bg-white/5 text-[var(--color-text-muted)] hover:bg-white/10 hover:text-[var(--color-text-secondary)]"
              )}
            >
              {t.tag} <span className="text-white/30">({t.count})</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Term Browser ─────────────────────────────────────────────────── */}
      {showTermBrowser && (
        <TermBrowser
          terms={termBrowserItems}
          activeTerm={null}
          onSelect={(t) => setTerm(t)}
        />
      )}

      {/* ── AI Described section ─────────────────────────────────────────── */}
      {showDescribedRail && (
        <AIDescribedSection
          shots={allShots}
          onClickShot={handleClickDescribedShot}
          onFilterDescribed={() => setFilterDescribed(true)}
        />
      )}

      {/* ── Recently Viewed ──────────────────────────────────────────────── */}
      {showRecentRail && (() => {
        if (recentShots.length === 0) return null
        return (
          <div className="border-b border-white/10 px-4 py-3">
            <button
              onClick={() => setRecentlyViewedCollapsed(!recentlyViewedCollapsed)}
              className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)] mb-2"
            >
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={cn("transition-transform", recentlyViewedCollapsed ? "-rotate-90" : "rotate-0")}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
              Recently Viewed
              <span className="text-xs text-[var(--color-text-muted)]">({recentShots.length})</span>
            </button>
            {!recentlyViewedCollapsed && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-white/10">
                {recentShots.map((shot) => {
                  const src = getBestAvailablePreviewSrc(shot)
                  const mediaSrc = getScreenshotMediaSrc(shot)
                  const vid = isVideo(mediaSrc)
                  return (
                    <button
                      key={shot.id}
                      onClick={() => openMedia(shot)}
                      className="group/rv relative flex-shrink-0 h-16 w-16 overflow-hidden rounded-md bg-white/5 transition-[border-color,box-shadow,transform] hover:ring-2 hover:ring-[var(--color-accent)]"
                      title={shot.term}
                    >
                      {src ? (
                        <img src={src} alt={shot.term} className="h-full w-full object-cover" loading="lazy" decoding="async" fetchPriority="low" />
                      ) : vid && mediaSrc ? (
                        <video
                          src={mediaSrc}
                          muted
                          playsInline
                          preload="metadata"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-white/5 text-[8px] uppercase tracking-[0.18em] text-white/40">
                          Media
                        </div>
                      )}
                      {vid && (
                        <div className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[8px] text-white/80">
                          <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,0 10,5 2,10" /></svg>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Creators tab content ─────────────────────────────────────────── */}
      {tab === "creators" && (
        <Suspense fallback={<InlineLoadingFallback className="mx-4 my-4" label="Loading creators" />}>
          <MediaCreatorsPanel
            creatorsLoading={creatorsLoading}
            creators={creatorsData?.performers ?? []}
            filteredCreators={filteredCreators}
            creatorCounts={creatorCounts}
            creatorSearch={creatorSearch}
            onCreatorSearchChange={setCreatorSearch}
            onClearCreatorSearch={() => setCreatorSearch("")}
            creatorPlatformFilter={creatorPlatformFilter}
            onCreatorPlatformFilterChange={setCreatorPlatformFilter}
            creatorFavoritesOnly={creatorFavoritesOnly}
            onToggleCreatorFavoritesOnly={() => setCreatorFavoritesOnly((v) => !v)}
            onClearCreatorFilters={() => {
              setCreatorSearch("")
              setCreatorPlatformFilter("all")
              setCreatorFavoritesOnly(false)
              setCreatorSort("shots")
            }}
            hasCreatorFilters={creatorPlatformFilter !== "all" || creatorFavoritesOnly || creatorSearch.trim().length > 0}
            onBackfillPerformers={handleBackfillPerformers}
            onCaptureAllCreators={handleCaptureAllCreators}
            capturingAll={capturingAll}
            onGoToPerformers={() => setActiveView("performers")}
            creatorSort={creatorSort}
            onCreatorSortChange={setCreatorSort}
            onSelectCreator={(p) => {
              setMediaCreator(p.id, p.username)
              setTab("all")
            }}
            onToggleFavoriteCreator={(p) => favoriteCreatorMutation.mutate({ id: p.id, isFav: !p.is_favorite })}
            onCaptureCreator={async (p) => {
              try {
                await api.capturePerformerMedia(p.id)
                addToast(`Capture queued for @${p.username}`, "success")
                qc.invalidateQueries({ queryKey: ["capture-queue"] })
              } catch {
                addToast("Capture failed", "error")
              }
            }}
            onHoverCreator={(p) => {
              void qc.prefetchQuery({
                queryKey: ["similar-performers", p.id],
                queryFn: () => api.similarPerformers(p.id, 3),
                staleTime: 5 * 60_000,
              })
            }}
          />
        </Suspense>
      )}

      {/* ── Term header (back nav) ───────────────────────────────────────── */}
      {term && tab !== "creators" && (
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            onClick={() => setTerm(null)}
            className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            Back
          </button>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{term}</h2>
        </div>
      )}

      {/* ── Error state ────────────────────────────────────────────────── */}
      {tab !== "creators" && mediaError && (
        <EmptyState
          icon="⚠️"
          eyebrow="Temporary issue"
          title="Couldn't load media"
          description="The server is starting up. Try refreshing in a moment."
          action={{ label: "Retry", onClick: () => mediaRefetch() }}
        />
      )}

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {tab !== "creators" && !mediaError && isLoading && <SkeletonGrid count={10} />}

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {tab !== "creators" && !isLoading && !mediaError && visibleShots.length === 0 && allShots.length === 0 && (
        <EmptyState
          icon="\ud83d\udcf7"
          eyebrow="Ready to capture"
          title="No media yet"
          description="Run a capture or add creators to start collecting media"
          action={{ label: capturing ? "Capturing..." : "Run capture", onClick: handleCapture }}
        />
      )}
      {tab !== "creators" && !isLoading && visibleShots.length === 0 && allShots.length > 0 && (
        <div className="mx-4 my-8 flex flex-col items-center justify-center gap-4 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,16,32,0.92),rgba(8,13,24,0.98))] px-6 py-20 text-center shadow-[0_24px_80px_rgba(0,0,0,0.24)] animate-fade-in">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-2">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-white/30">
              <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-text-primary mb-1">No media found</p>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-slate-400">
            No matches
          </div>
          <p className="max-w-lg text-sm leading-6 text-[var(--color-text-muted)]">
            {filterDescribed
              ? "No AI-described media matched this view."
              : onlyUnlinked
              ? "Everything in this view is already linked to a creator."
              : onlyUnrated
              ? "Everything in this view is already rated."
              : onlyRecent
              ? "No media matched the last-7-days filter."
              : "No media matched the current search and filter mix."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {filterDescribed && (
              <button
                onClick={() => setFilterDescribed(false)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-[var(--color-text-secondary)]"
              >
                Clear described filter
              </button>
            )}
            <button
              onClick={handleCapture}
              disabled={capturing}
              className="rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-4 py-2 text-sm text-[var(--color-text-primary)] disabled:opacity-50"
            >
              {capturing ? "Capturing..." : "Capture now"}
            </button>
            <button
              onClick={() => {
                setDiscoveryOpen(true)
                handleRunDiscovery()
              }}
              className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200"
            >
              Ask AI for similar creators
            </button>
            <button
              onClick={clearMediaFilters}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
            >
              Reset view
            </button>
            {(onlyUnlinked || onlyUnrated || onlyRecent) && (
              <button
                onClick={() => {
                  setOnlyUnlinked(false)
                  setOnlyUnrated(false)
                  setOnlyRecent(false)
                }}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
              >
                Clear quick filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Virtualizer scroll-margin anchor ──────────────────────────── */}
      <div ref={virtualizerContainerRef} />

      {/* ── Grid view: grouped by term ─────────────────────────────────── */}
      {tab !== "creators" && !isLoading && visibleShots.length > 0 && viewMode === "grid" && showGrouped && (
        activeSectionEntries.length <= 20 ? (
          <div className="py-2">
            {activeSectionEntries.map(({ label: groupTerm, shots }) => (
              <section key={groupTerm}>
                <button
                  onClick={() => setTerm(groupTerm)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
                >
                  {groupTerm}
                  <span className="text-xs font-normal text-[var(--color-text-muted)]">{shots.length}</span>
                </button>
                <div className={cn("grid", gridClass)}>
                  {renderGrid(shots)}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div
            className="py-2"
            style={{
              height: `${sectionVirtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {sectionVirtualizer.getVirtualItems().map((virtualSection) => {
              const section = activeSectionEntries[virtualSection.index]
              if (!section) return null
              const { label: groupTerm, shots } = section
              return (
              <section
                key={groupTerm}
                data-index={virtualSection.index}
                ref={sectionVirtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualSection.start - sectionVirtualizer.options.scrollMargin}px)`,
                }}
              >
                <button
                  onClick={() => setTerm(groupTerm)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
                >
                  {groupTerm}
                  <span className="text-xs font-normal text-[var(--color-text-muted)]">{shots.length}</span>
                </button>
                <div className={cn("grid", gridClass)}>
                  {renderGrid(shots)}
                </div>
              </section>
            )})}
          </div>
        )
      )}

      {/* ── Grid view: flat ─────────────────────────────────────────────── */}
      {tab !== "creators" && !isLoading && visibleShots.length > 0 && viewMode === "grid" && !showGrouped && (
        flatGridRows.length <= 30 ? (
          <div className="py-2 space-y-1">
            {flatGridRows.map((rowShots, i) => (
              <div key={i} className={cn("grid", gridClass)}>{renderGrid(rowShots)}</div>
            ))}
          </div>
        ) : (
          <div
            style={{
              height: `${flatGridVirtualizer.getTotalSize()}px`,
              position: "relative",
            }}
            className="py-2"
          >
            {flatGridVirtualizer.getVirtualItems().map((virtualRow) => {
              const rowShots = flatGridRows[virtualRow.index]
              if (!rowShots) return null
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={flatGridVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start - flatGridVirtualizer.options.scrollMargin}px)`,
                  }}
                  className={cn("grid", gridClass)}
                >
                  {renderGrid(rowShots)}
                </div>
              )
            })}
          </div>
        )
      )}

      {/* ── List view ────────────────────────────────────────────────────── */}
      {tab !== "creators" && !isLoading && visibleShots.length > 0 && viewMode === "list" && (
        visibleShots.length <= 100 ? (
          <div className="px-2 py-2 space-y-0.5">
            {visibleShots.map((shot) => (
              <div key={shot.id}>{renderListItem(shot)}</div>
            ))}
          </div>
        ) : (
          <div
            className="px-2 py-2"
            style={{
              height: `${listVirtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {listVirtualizer.getVirtualItems().map((virtualRow) => {
              const shot = visibleShots[virtualRow.index]
              if (!shot) return null
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={listVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start - listVirtualizer.options.scrollMargin}px)`,
                  }}
                >
                  {renderListItem(shot)}
                </div>
              )
            })}
          </div>
        )
      )}

      {/* ── Timeline view ────────────────────────────────────────────────── */}
      {tab !== "creators" && !isLoading && visibleShots.length > 0 && viewMode === "timeline" && (
        <div
          className="py-2"
          style={{
            height: `${sectionVirtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {sectionVirtualizer.getVirtualItems().map((virtualSection) => {
            const section = activeSectionEntries[virtualSection.index]
            if (!section) return null
            const { label: groupLabel, shots } = section
            return (
            <section
              key={groupLabel}
              data-index={virtualSection.index}
              ref={sectionVirtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualSection.start - sectionVirtualizer.options.scrollMargin}px)`,
              }}
            >
              <div className="flex items-center gap-3 px-4 py-2">
                <div className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {groupLabel}
                </h3>
                <span className="text-xs text-[var(--color-text-muted)]">{shots.length}</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>
              <div className={cn("grid", gridClass)}>
                {renderGrid(shots)}
              </div>
            </section>
          )})}
        </div>
      )}

      {/* ── Mosaic view ──────────────────────────────────────────────────── */}
      {tab !== "creators" && !isLoading && visibleShots.length > 0 && viewMode === "mosaic" && (
        <>
          <div
            className="py-2 px-1"
            style={{ columns: "var(--mosaic-cols, 4)", columnGap: "4px" }}
          >
            <style>{`
              @media (max-width: 640px) { :root { --mosaic-cols: 2; } }
              @media (min-width: 641px) and (max-width: 1024px) { :root { --mosaic-cols: 3; } }
              @media (min-width: 1025px) { :root { --mosaic-cols: 4; } }
              @media (min-width: 1400px) { :root { --mosaic-cols: 5; } }
            `}</style>
            {visibleMosaicShots.map((shot) => (
              <MosaicCard
                key={shot.id}
                shot={shot}
                onClick={() => openMedia(shot)}
                favorite={favorites.has(shot.id)}
                onToggleFavorite={() => toggleFavorite(shot.id)}
                onContextMenu={(e) => handleContextMenu(e, shot)}
              />
            ))}
          </div>
          {hasMoreMosaicShots && (
            <>
              <div ref={mosaicSentinelRef} className="h-4" />
              <div className="flex justify-center py-3 text-xs text-[var(--color-text-muted)]">
                Loading more mosaic items...
              </div>
            </>
          )}
        </>
      )}

      {/* ── Infinite scroll sentinel ─────────────────────────────────────── */}
      {tab !== "creators" && (
        <>
          <div ref={sentinelRef} className="h-4" />
          {isFetchingNextPage && <div className="flex justify-center py-4"><Spinner /></div>}
        </>
      )}

      {/* ── Batch action bar ─────────────────────────────────────────────── */}
      {batchMode && selectedIds.size > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between border-t border-white/10 bg-[#0a1020]/95 px-4 py-3 backdrop-blur-lg"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 12px)" }}
        >
          <span className="text-sm text-[var(--color-text-secondary)]">{selectedIds.size} selected</span>
          <div className="flex gap-2">
            <button
              onClick={() => selectShots(visibleShots.map((shot) => shot.id))}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:text-white"
            >
              Select all visible
            </button>
            <button
              onClick={() => selectShots(visibleShots.filter((shot) => (allShotMeta.get(shot.id)?.isVideo ?? false)).map((shot) => shot.id))}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:text-white"
            >
              Videos
            </button>
            <button
              onClick={() => selectShots(visibleShots.filter((shot) => (shot.rating ?? 0) === 0).map((shot) => shot.id))}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:text-white"
            >
              Unrated
            </button>
            <button
              onClick={() => selectShots(visibleShots.filter((shot) => shot.performer_id == null).map((shot) => shot.id))}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:text-white"
            >
              Unlinked
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              Clear
            </button>
            <button
              onClick={handleBatchDescribe}
              disabled={describeProgress !== null}
              className="rounded-lg px-3 py-1.5 text-xs text-purple-400 hover:text-purple-300 disabled:opacity-50"
            >
              {describeProgress
                ? `Describing ${describeProgress.done}/${describeProgress.total}...`
                : `AI Describe (${selectedIds.size})`}
            </button>
            <div className="relative">
              <button
                onClick={() => setAddToPlaylistOpen((v) => !v)}
                className="rounded-lg px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300"
              >
                + Playlist
              </button>
              <Suspense fallback={null}>
                <AddToPlaylistDropdown
                  open={addToPlaylistOpen}
                  onClose={() => setAddToPlaylistOpen(false)}
                  screenshotIds={[...selectedIds]}
                  onDone={() => addToast(`Added ${selectedIds.size} to playlist`, "success")}
                  onCreateNew={() => { setCreatePlaylistWithIds([...selectedIds]); setCreatePlaylistOpen(true) }}
                />
              </Suspense>
            </div>
            <button
              onClick={handleBulkFavorite}
              className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              Favorite
            </button>
            {/* Bulk star rating */}
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    Promise.all([...selectedIds].map((id) => api.rateScreenshot(id, r))).then(() => {
                      qc.invalidateQueries({ queryKey: ["screenshots"] })
                      qc.invalidateQueries({ queryKey: ["top-rated-screenshots"] })
                      qc.invalidateQueries({ queryKey: ["media-stats"] })
                      setSelectedIds(new Set())
                      setBatchMode(false)
                      addToast(`Rated ${selectedIds.size} as ${"★".repeat(r)}`, "success")
                    })
                  }}
                  className="rounded px-1.5 py-1 text-xs text-yellow-400/60 hover:text-yellow-400 transition-colors"
                  title={`Rate all ${r} star${r > 1 ? "s" : ""}`}
                >
                  {"★".repeat(r)}
                </button>
              ))}
            </div>
            <button
              onClick={handleBulkDelete}
              className="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:text-red-300"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* ── Lightbox (images only) ───────────────────────────────────────── */}
      {lightboxShotId != null && lightboxShot != null && (
        <Suspense fallback={<InlineLoadingFallback className="mx-4 my-4" label="Loading viewer" />}>
          <ScreenshotLightbox
            shots={lightboxIdx >= 0 ? visibleShots : [lightboxShot]}
            idx={lightboxIdx >= 0 ? lightboxIdx : 0}
            onClose={() => setLightboxShotId(null)}
            onNavigate={(i) => { const shots = lightboxIdx >= 0 ? visibleShots : [lightboxShot]; setLightboxShotId(shots[i]?.id ?? null) }}
            favorites={favorites}
            onToggleFavorite={(id) => toggleFavorite(id)}
            onRate={(id, rating) => rateMutation.mutate({ id, rating })}
            onAddTag={(id, tag) => handleAddTag(id, tag)}
            onRemoveTag={(id, tag) => handleRemoveTag(id, tag)}
            allTags={userTags.map((t) => t.tag)}
            onViewCreator={(performerId, username) => {
              setMediaCreator(performerId, username)
              setLightboxShotId(null)
              setTab("all")
            }}
          />
        </Suspense>
      )}

      {/* ── Video Player (portal overlay — renders above grid regardless of layout) */}
      {expandedShot != null && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-auto"
          onClick={(e) => { if (e.target === e.currentTarget) { setExpandedVideoId(null); setExpandedVideoShot(null) } }}
          onKeyDown={(e) => { if (e.key === "Escape") { setExpandedVideoId(null); setExpandedVideoShot(null) } }}
        >
          <Suspense fallback={
            <div className="flex h-64 w-full max-w-3xl items-center justify-center rounded-2xl bg-[#0a0e17]">
              <InlineLoadingFallback label="Loading video player" />
            </div>
          }>
            <InlineVideoPlayer
              shot={expandedShot}
              onClose={() => { setExpandedVideoId(null); setExpandedVideoShot(null) }}
              onDelete={() => { deleteMutation.mutate(expandedShot.id); setExpandedVideoId(null); setExpandedVideoShot(null) }}
              favorite={favorites.has(expandedShot.id)}
              onToggleFavorite={() => toggleFavorite(expandedShot.id)}
              onRate={(rating) => rateMutation.mutate({ id: expandedShot.id, rating })}
              onOpenRelated={(rel) => openMedia(rel)}
              userTags={parseUserTags(expandedShot.user_tags)}
              onAddTag={(tag) => handleAddTag(expandedShot.id, tag)}
              onRemoveTag={(tag) => handleRemoveTag(expandedShot.id, tag)}
            />
          </Suspense>
        </div>,
        document.body
      )}

      {/* ── Create Playlist Modal ────────────────────────────────────────── */}
      <Suspense fallback={null}>
        <CreatePlaylistModal
          open={createPlaylistOpen}
          onClose={() => { setCreatePlaylistOpen(false); setCreatePlaylistWithIds(undefined) }}
          initialScreenshotIds={createPlaylistWithIds}
        />
      </Suspense>

      {/* ── Slideshow ─────────────────────────────────────────────────────── */}
      {slideshowActive && visibleShots.length > 0 && (
        <Suspense fallback={<InlineLoadingFallback className="mx-4 my-4" label="Loading slideshow" />}>
          <SlideshowMode
            shots={visibleShots}
            startIdx={0}
            onClose={() => setSlideshowActive(false)}
          />
        </Suspense>
      )}

      {/* ── Video Feed ─────────────────────────────────────────────────────── */}
      {viewMode === "feed" && (
        <div className="fixed inset-0 top-14 z-30 bg-black">
          <Suspense fallback={<InlineLoadingFallback className="m-6" label="Loading feed" />}>
            <VideoFeed
              onExit={() => handleViewModeChange("grid")}
              term={term}
              source={tab === "ddg" ? "ddg" : tab === "redgifs" ? "redgifs" : undefined}
            />
          </Suspense>
        </div>
      )}

      {/* ── Context Menu ──────────────────────────────────────────────────── */}
      {contextMenu && (
        <Suspense fallback={null}>
          <MediaContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            shot={contextMenu.shot}
            playlists={allPlaylists}
            onClose={() => setContextMenu(null)}
            onRate={(rating) => rateMutation.mutate({ id: contextMenu.shot.id, rating })}
            onAddToPlaylist={(plId) => handleContextAddToPlaylist(contextMenu.shot, plId)}
            onCopyUrl={() => handleContextCopyUrl(contextMenu.shot)}
            onDescribe={() => handleSingleDescribe(contextMenu.shot.id)}
            onOpenSource={() => { if (contextMenu.shot.page_url) window.open(contextMenu.shot.page_url, "_blank") }}
            onDelete={() => deleteMutation.mutate(contextMenu.shot.id)}
            userTags={parseUserTags(contextMenu.shot.user_tags)}
            allTags={userTags}
            aiTags={parseAiTags(contextMenu.shot.ai_tags)}
            onAddTag={(tag) => handleAddTag(contextMenu.shot.id, tag)}
            onRemoveTag={(tag) => handleRemoveTag(contextMenu.shot.id, tag)}
            onFilterByCreator={(performerId, username) => {
              setMediaCreator(performerId, username)
              setTab("all")
              setContextMenu(null)
            }}
          />
        </Suspense>
      )}

      {/* ── Keyboard Shortcuts Help Overlay ──────────────────────────────── */}
      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
          onClick={() => setShortcutsOpen(false)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1526]/95 backdrop-blur-lg shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-white/60 font-mono">Keyboard Shortcuts</h2>
              <button
                onClick={() => setShortcutsOpen(false)}
                className="rounded-full p-1.5 text-white/40 hover:text-white/80 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" />
                </svg>
              </button>
            </div>
            <div className="space-y-4 text-sm">
              {[
                { group: "Navigation", items: [
                  { keys: ["M"], desc: "Toggle multi-select mode" },
                  { keys: ["R"], desc: "Surprise me — random top-rated pick" },
                  { keys: ["P"], desc: "Toggle Creators Only filter" },
                  { keys: ["?"], desc: "Show this help" },
                ]},
                { group: "Lightbox", items: [
                  { keys: ["←", "→"], desc: "Previous / next image" },
                  { keys: ["Esc"], desc: "Close lightbox" },
                  { keys: ["Space"], desc: "Play / pause video" },
                  { keys: ["F"], desc: "Toggle favorite" },
                  { keys: ["I"], desc: "Toggle info panel" },
                  { keys: ["C"], desc: "Copy URL to clipboard" },
                  { keys: ["D"], desc: "Download current media" },
                  { keys: ["[", "]"], desc: "Slow down / speed up video" },
                  { keys: ["1–5"], desc: "Rate current image" },
                ]},
              ].map(({ group, items }) => (
                <div key={group}>
                  <p className="text-[10px] uppercase tracking-widest text-white/30 font-mono mb-2">{group}</p>
                  <div className="space-y-1.5">
                    {items.map(({ keys, desc }) => (
                      <div key={desc} className="flex items-center justify-between gap-4">
                        <span className="text-white/50 text-xs">{desc}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {keys.map((k) => (
                            <kbd
                              key={k}
                              className="inline-flex items-center justify-center min-w-[28px] h-6 px-1.5 rounded border border-white/15 bg-white/[0.06] text-[11px] font-mono text-white/70"
                            >
                              {k}
                            </kbd>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-5 text-[10px] text-white/25 font-mono text-center">Press ? to toggle · Esc to close</p>
          </div>
        </div>
      )}
    </div>
  )
}
