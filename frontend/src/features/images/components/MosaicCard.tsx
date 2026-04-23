import { memo } from "react"
import type { Screenshot } from "@/lib/api"
import { cn } from "@/lib/cn"
import { getMediaDebugLabel, useResolvedScreenshotMedia } from "@/lib/media"
import { isHlsUrl } from "@/lib/hlsAttach"
import { sourceLabel, MediaUnavailableTile } from "../mediaHelpers"

export const MosaicCard = memo(function MosaicCard({
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
      <div style={{ contentVisibility: "auto", containIntrinsicSize: "220px" }} className="relative">
        {/* Gradient fallback for video items (shows play icon when poster isn't ready) */}
        {vid && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)", minHeight: "10rem" }}
          >
            <div className="rounded-full bg-white/10 p-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white" opacity="0.5"><polygon points="5,3 19,12 5,21" /></svg>
            </div>
          </div>
        )}
        {!previewSrc ? (
          vid && src ? (
            isHlsUrl(src) ? (
              <div className="relative z-[1] flex min-h-[10rem] w-full flex-col items-center justify-center gap-1 bg-black/45 px-2 text-center">
                <span className="rounded bg-amber-500/85 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow">HLS</span>
                <span className="text-[10px] leading-tight text-white/60">Open for playback</span>
              </div>
            ) : (
              <video
                src={src}
                muted
                playsInline
                preload="metadata"
                onError={markMediaBroken}
                className="relative z-[1] w-full transition-[filter] duration-200 group-hover:brightness-110"
                style={{ display: "block" }}
              />
            )
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
            onLoad={(e) => {
              const img = e.target as HTMLImageElement
              // Hide tiny placeholders; show 320×180 posters (and larger)
              if (vid && img.naturalWidth < 320 && img.naturalHeight < 180) {
                img.style.opacity = '0'
              }
            }}
            onError={(e) => {
              const img = e.currentTarget
              const isSrc = img.src || ''
              if (isSrc.includes('/video-poster/')) {
                const posterRetries = parseInt(img.dataset.posterRetries || '0')
                if (posterRetries < 3) {
                  img.dataset.posterRetries = String(posterRetries + 1)
                  const delay = (posterRetries + 1) * 3000 + Math.random() * 2000
                  setTimeout(() => {
                    if (img.isConnected) {
                      img.src = isSrc + (isSrc.includes('?') ? '&' : '?') + `_r=${posterRetries + 1}`
                    }
                  }, delay)
                  return
                }
              }
              if (vid) {
                img.style.opacity = '0'
                markPreviewBroken()
                return
              }
              markPreviewBroken()
            }}
            className="relative z-[1] w-full transition-[filter,opacity] duration-200 group-hover:brightness-110"
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
