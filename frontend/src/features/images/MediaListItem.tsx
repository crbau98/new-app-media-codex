import { useState, memo, useMemo } from "react"
import type { Screenshot } from "@/lib/api"
import { cn } from "@/lib/cn"
import { StarRating } from "@/components/StarRating"
import { getMediaDebugLabel, getScreenshotMediaSrc, getScreenshotPreviewSrc } from "@/lib/media"

function isVideo(src: string): boolean {
  return /\.(mp4|webm|mov)$/i.test(src)
}

function sourceLabel(s: string) {
  return s === "ddg" ? "DDG" : s === "redgifs" ? "Redgifs" : s === "x" ? "X" : s
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return ""
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

interface MediaListItemProps {
  shot: Screenshot
  onClick: () => void
  favorite: boolean
  onToggleFavorite: () => void
  onRate: (rating: number) => void
  onHover?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export const MediaListItem = memo(function MediaListItem({ shot, onClick, favorite, onToggleFavorite, onRate, onHover, onContextMenu }: MediaListItemProps) {
  const mediaSrc = useMemo(() => getScreenshotMediaSrc(shot), [shot])
  const previewSrc = useMemo(() => getScreenshotPreviewSrc(shot), [shot])
  const mediaLabel = getMediaDebugLabel(shot)
  const vid = isVideo(mediaSrc)
  const [broken, setBroken] = useState(false)
  const previewPending = vid && !!mediaSrc

  return (
    <button
      onClick={onClick}
      onMouseEnter={onHover}
      onFocus={onHover}
      onContextMenu={onContextMenu}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/[0.04] border border-transparent hover:border-white/8"
      style={{ contentVisibility: "auto", containIntrinsicSize: "72px" }}
    >
      {/* Thumbnail */}
      <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-black/30">
        {!previewSrc || broken ? (
          vid && mediaSrc && !broken ? (
            <video
              src={mediaSrc}
              muted
              playsInline
              preload="none"
              decoding="async"
              onError={() => setBroken(true)}
              className="h-full w-full object-cover"
            />
          ) : previewPending ? (
            <div className="flex h-full w-full items-center justify-center bg-sky-500/10 text-[8px] font-medium uppercase tracking-[0.18em] text-sky-300">
              Wait
            </div>
          ) : (
          <div className="flex h-full w-full items-center justify-center bg-amber-500/10 text-[8px] font-medium uppercase tracking-[0.18em] text-amber-300">
            Error
          </div>
          )
        ) : (
          <img
            src={previewSrc}
            alt={shot.term}
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            onError={() => setBroken(true)}
            className="h-full w-full object-cover"
          />
        )}
        {vid && (
          <div className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-0.5 text-[7px] text-white/80">
            <svg width="6" height="6" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,0 10,5 2,10" /></svg>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">{shot.term}</span>
          <span className={cn(
            "flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
            shot.source === "ddg" ? "bg-blue-500/15 text-blue-400" :
            shot.source === "redgifs" ? "bg-red-500/15 text-red-400" :
            "bg-white/10 text-white/60"
          )}>
            {sourceLabel(shot.source)}
          </span>
          {favorite && <span className="text-red-400 text-xs">&#9829;</span>}
          {shot.performer_username && (
            <span className="flex-shrink-0 rounded-full border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-400">
              @{shot.performer_username}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {!previewSrc || broken ? (
            vid && mediaSrc && !broken ? (
              shot.ai_summary ? (
                <p className="text-[11px] text-[var(--color-text-muted)] truncate max-w-sm">{shot.ai_summary}</p>
              ) : (
                <p className="text-[11px] text-white/20 italic">No description</p>
              )
            ) : previewPending ? (
              <p className="text-[11px] text-sky-300/80 truncate max-w-sm">
                Loading preview: {mediaLabel}
              </p>
            ) : (
              <p className="text-[11px] text-amber-300/80 truncate max-w-sm">
                Media unavailable: {mediaLabel}
              </p>
            )
          ) : shot.ai_summary ? (
            <p className="text-[11px] text-[var(--color-text-muted)] truncate max-w-sm">{shot.ai_summary}</p>
          ) : (
            <p className="text-[11px] text-white/20 italic">No description</p>
          )}
        </div>
      </div>

      {/* Rating */}
      <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        <StarRating value={shot.rating ?? 0} onChange={onRate} compact />
      </div>

      {/* Date */}
      <span className="flex-shrink-0 text-[11px] text-[var(--color-text-muted)] w-20 text-right">
        {formatDate(shot.captured_at)}
      </span>

      {/* Quick favorite toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
        className={cn(
          "flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full",
          favorite ? "text-red-400" : "text-white/30 hover:text-red-300"
        )}
        title={favorite ? "Unfavorite" : "Favorite"}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </button>
    </button>
  )
})
