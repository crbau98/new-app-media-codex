import { memo, useState, useRef, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import type { Screenshot } from "@/lib/api"
import { cn } from "@/lib/cn"

import { LikeButton } from "@/components/LikeButton"
import { ViewCounter } from "@/components/ViewCounter"
import { getMediaDebugLabel, useResolvedScreenshotMedia } from "@/lib/media"
import { resolvePublicUrl } from "@/lib/backendOrigin"
import { isHlsUrl } from "@/lib/hlsAttach"
import { sourceLabel, isNewShot, MediaUnavailableTile } from "../mediaHelpers"
import { useAppStore } from "@/store"

export const MediaCard = memo(function MediaCard({
  shot,
  index = 0,
  onClick,
  batchMode,
  selected,
  onSelect,
  onHover,
  favorite,
  onToggleFavorite: _onToggleFavorite,
  onDescribe: _onDescribe,
  onRate: _onRate,
  onContextMenu,
  onNavigateToPerformer,
  profileTile,
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
  profileTile?: boolean
}) {
  const { mediaSrc: src, previewSrc, posterSrc, isVideo: vid, isGif: gif, markMediaBroken: _markMediaBroken, markPreviewBroken } = useResolvedScreenshotMedia(shot)
  const mediaLabel = getMediaDebugLabel(shot)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const addToast = useAppStore((s) => s.addToast)
  const isAboveFold = index <= 3
  const legacyVideoPoster =
    resolvePublicUrl(
      (shot.preview_url?.trim())
      || `/api/screenshots/video-poster/${shot.id}`
      || (shot.thumbnail_url ? `/api/screenshots/proxy-media?url=${encodeURIComponent(shot.thumbnail_url)}` : ""),
    )
  const videoPosterSrc = posterSrc || legacyVideoPoster

  const prevSrcRef = useRef("")
  const imgRef = useRef<HTMLImageElement | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [menuOpen])

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (src && src !== prevSrcRef.current) {
      prevSrcRef.current = src
      setImgLoaded(false)
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [src])

  const startPosterPoll = useCallback(() => {
    if (pollTimerRef.current || !imgRef.current) return
    let attempts = 0
    pollTimerRef.current = setInterval(() => {
      attempts += 1
      if (attempts > 30 || !imgRef.current?.isConnected) {
        clearInterval(pollTimerRef.current!)
        pollTimerRef.current = null
        return
      }
      if (imgRef.current) {
        imgRef.current.src = videoPosterSrc + (videoPosterSrc.includes('?') ? '&' : '?') + `_poll=${Date.now()}`
      }
    }, 5000)
  }, [videoPosterSrc])

  const stopPosterPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  return (
    <motion.article
      role="button"
      tabIndex={0}
      onClick={() => (batchMode ? onSelect() : onClick())}
      onMouseEnter={onHover}
      onFocus={onHover}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); batchMode ? onSelect() : onClick() } }}
      onContextMenu={onContextMenu}
      className={cn(
        "group relative cursor-pointer overflow-hidden bg-black/20",
        !profileTile && "content-card content-card-interactive",
        profileTile
          ? "rounded-none border-0 shadow-none hover:brightness-[1.06] active:brightness-95 aspect-square"
          : "rounded-[16px] md:rounded-[24px] border border-white/10 shadow-[0_12px_32px_rgba(0,0,0,0.18)] aspect-square",
        selected && "ring-2 ring-accent"
      )}
      style={index <= 20 ? { animationDelay: `${index * 30}ms` } : undefined}
      whileHover={profileTile ? undefined : { scale: 1.02, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } }}
      whileTap={profileTile ? undefined : { scale: 0.98, transition: { duration: 0.1 } }}
      initial={index <= 20 ? { opacity: 0, y: 20, scale: 0.96 } : false}
      animate={index <= 20 ? { opacity: 1, y: 0, scale: 1 } : false}
      transition={index <= 20 ? { duration: 0.4, delay: index * 0.03, ease: [0.16, 1, 0.3, 1] } : undefined}
    >
      <div className="relative h-full w-full" style={{ contentVisibility: "auto", containIntrinsicSize: "160px 160px" }}>
        {!imgLoaded && (previewSrc || vid) && (
          <div className="absolute inset-0 shimmer z-[1]" aria-hidden="true" />
        )}
        {vid && (
          <div
            className="absolute inset-0 z-[1] flex items-center justify-center"
            style={{ background: "linear-gradient(165deg, #1e1530 0%, #0c0614 55%, #000000 100%)" }}
            aria-hidden="true"
          >
            <div className="rounded-full bg-white/10 p-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white" opacity="0.5"><polygon points="5,3 19,12 5,21" /></svg>
            </div>
          </div>
        )}
        {vid ? (
          <>
            <img
              ref={imgRef}
              src={videoPosterSrc}
              loading={isAboveFold ? "eager" : "lazy"}
              decoding={isAboveFold ? "sync" : "async"}
              fetchPriority={isAboveFold ? "high" : "low"}
              onLoad={(e) => {
                const img = e.target as HTMLImageElement
                const isReal = img.naturalWidth > 320 || img.naturalHeight > 180
                if (isReal) {
                  setImgLoaded(true)
                  stopPosterPoll()
                } else {
                  img.style.opacity = '0'
                  setImgLoaded(true)
                  startPosterPoll()
                }
              }}
              onError={(e) => {
                const img = e.target as HTMLImageElement
                img.style.opacity = '0'
                setImgLoaded(true)
                startPosterPoll()
              }}
              className="relative z-[2] h-full w-full object-cover transition-[filter,opacity] duration-200 group-hover:brightness-110"
              alt=""
            />
            {/* Play icon centered on hover (desktop only) */}
            <div className="absolute inset-0 z-[3] hidden md:flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <motion.div
                initial={{ scale: 0.8 }}
                whileHover={{ scale: 1 }}
                className="rounded-full bg-black/50 backdrop-blur-sm p-3 shadow-lg"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21" /></svg>
              </motion.div>
            </div>
          </>
        ) : !previewSrc ? (
          <MediaUnavailableTile
            title={shot.term}
            detail={mediaLabel}
            statusLabel="Media unavailable"
          />
        ) : (
          <img
            src={previewSrc}
            alt={shot.ai_summary || `${vid ? "Video" : "Screenshot"}: ${shot.term} from ${sourceLabel(shot.source)}`}
            loading={isAboveFold ? "eager" : "lazy"}
            decoding={isAboveFold ? "sync" : "async"}
            fetchPriority={isAboveFold ? "high" : "low"}
            onError={(e) => {
              const img = e.currentTarget
              const isSrc = img.src || ''
              const retries = parseInt(img.dataset.retries || '0')
              if (retries < 1) {
                img.dataset.retries = '1'
                img.src = isSrc + (isSrc.includes('?') ? '&_r=1' : '?_r=1')
              } else {
                markPreviewBroken()
              }
            }}
            onLoad={() => setImgLoaded(true)}
            className="h-full w-full object-cover transition-[filter] duration-200 group-hover:brightness-110"
          />
        )}

        {/* Top-left badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1 z-[4]">
          <div className="flex gap-1">
            {isNewShot(shot) && (
              <span className="rounded-md bg-accent/90 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow">
                NEW
              </span>
            )}
            {gif && (
              <span className="rounded-md bg-emerald-500/80 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow">
                GIF
              </span>
            )}
            {vid && (
              <span className="rounded-md bg-amber-500/85 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow">
                VIDEO
              </span>
            )}
          </div>
          {/* Duration badge top-left for videos (desktop hover) */}
          {vid && (
            <span className="hidden md:inline-block rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white/80 opacity-0 group-hover:opacity-100 transition-opacity">
              ▶
            </span>
          )}
        </div>

        {/* Like button top-right (desktop hover) */}
        {!batchMode && (
          <div className="absolute top-2 right-2 z-[4] hidden md:block opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <LikeButton
              screenshotId={shot.id}
              initialLiked={shot.is_liked ?? false}
              initialCount={shot.likes_count ?? 0}
              size="sm"
              className="h-7 w-7 rounded-full bg-black/60 text-white/80 hover:text-rose-400"
            />
          </div>
        )}

        {/* Favorite indicator */}
        {favorite && (
          <div className="absolute top-2 right-2 z-[4] text-sm text-red-400 drop-shadow md:hidden">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
          </div>
        )}

        {/* Batch mode checkbox */}
        {batchMode && (
          <div className={cn(
            "absolute top-2 left-2 z-[4] flex h-5 w-5 items-center justify-center rounded border text-[10px]",
            selected ? "border-blue-500 bg-blue-500 text-white" : "border-white/40 bg-black/50 text-transparent"
          )}>
            {selected && "✓"}
          </div>
        )}

        {/* Bottom gradient overlay with info */}
        <div className="absolute inset-x-0 bottom-0 z-[4] bg-gradient-to-t from-black/70 via-black/30 to-transparent px-2.5 pb-2 pt-8">
          <div className="flex items-end justify-between gap-2">
            {/* Creator avatar + username */}
            <div className="min-w-0 flex items-center gap-1.5">
              {shot.performer_id && shot.performer_username && onNavigateToPerformer && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onNavigateToPerformer(shot.performer_id!, shot.performer_username!)
                  }}
                  className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
                  title={`View @${shot.performer_username}'s profile`}
                >
                  <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-accent/20 ring-1 ring-white/20">
                    <span className="text-[9px] font-bold text-white">{shot.performer_username.charAt(0).toUpperCase()}</span>
                  </div>
                  <span className="truncate text-[11px] font-medium text-white/90">@{shot.performer_username}</span>
                </button>
              )}
              {shot.performer_username && (!shot.performer_id || !onNavigateToPerformer) && (
                <span className="truncate text-[11px] font-medium text-white/90">@{shot.performer_username}</span>
              )}
              {!shot.performer_username && (
                <span className="truncate text-[11px] font-medium text-white/70">{sourceLabel(shot.source)}</span>
              )}
            </div>

            {/* Right side: like + view count + more actions */}
            <div className="flex items-center gap-1.5 shrink-0">
              {(shot.likes_count ?? 0) > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-white/60">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
                  {shot.likes_count}
                </span>
              )}
              {(shot.views_count ?? 0) > 0 && (
                <span className="text-[10px] text-white/50">
                  <ViewCounter screenshotId={shot.id} count={shot.views_count} className="text-white/50" />
                </span>
              )}
              {!batchMode && (
                <div ref={menuRef} className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen((v) => !v)
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-white/40 hover:text-white/80 transition-colors"
                    aria-label="More actions"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="6" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="12" cy="18" r="2" />
                    </svg>
                  </button>
                  {menuOpen && (
                    <div className="absolute bottom-full right-0 mb-1.5 w-32 rounded-lg border border-white/10 bg-black/80 backdrop-blur-md shadow-xl overflow-hidden z-10">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          const url = shot.page_url || `${window.location.origin}${window.location.pathname}#/media?shot=${shot.id}`
                          if (typeof navigator.share === "function") {
                            void navigator.share({ title: shot.term, url })
                          } else {
                            void navigator.clipboard.writeText(url).then(() => addToast("Link copied", "success"), () => addToast("Copy failed", "error"))
                          }
                          setMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                        Share
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          const url = shot.page_url || `${window.location.origin}${window.location.pathname}#/media?shot=${shot.id}`
                          void navigator.clipboard.writeText(url).then(() => addToast("Link copied", "success"), () => addToast("Copy failed", "error"))
                          setMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        Copy Link
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          addToast("Reported — thanks for the feedback", "success")
                          setMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                        Report
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.article>
  )
}, (prev, next) =>
  prev.shot.id === next.shot.id &&
  prev.shot.local_url === next.shot.local_url &&
  prev.shot.likes_count === next.shot.likes_count &&
  prev.shot.views_count === next.shot.views_count &&
  prev.shot.is_liked === next.shot.is_liked &&
  prev.favorite === next.favorite &&
  prev.selected === next.selected &&
  prev.batchMode === next.batchMode
)

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
  const imgRef = useRef<HTMLImageElement | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [])

  const startPosterPoll = useCallback(() => {
    if (pollTimerRef.current || !imgRef.current) return
    let attempts = 0
    pollTimerRef.current = setInterval(() => {
      attempts += 1
      if (attempts > 30 || !imgRef.current?.isConnected) {
        clearInterval(pollTimerRef.current!)
        pollTimerRef.current = null
        return
      }
      if (imgRef.current) {
        imgRef.current.src = previewSrc + (previewSrc.includes('?') ? '&' : '?') + `_poll=${Date.now()}`
      }
    }, 5000)
  }, [previewSrc])

  const stopPosterPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

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
            ref={imgRef}
            src={previewSrc}
            alt={shot.ai_summary || `${shot.term} — ${sourceLabel(shot.source)}`}
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            onLoad={(e) => {
              const img = e.target as HTMLImageElement
              if (vid && img.naturalWidth <= 320 && img.naturalHeight <= 180) {
                img.style.opacity = '0'
                startPosterPoll()
              } else {
                stopPosterPoll()
              }
            }}
            onError={(e) => {
              const img = e.currentTarget
              const isSrc = img.src || ''
              if (isSrc.includes('/video-poster/')) {
                img.style.opacity = '0'
                startPosterPoll()
                return
              }
              if (vid) { img.style.opacity = '0'; return }
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
