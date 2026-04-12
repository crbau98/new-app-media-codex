import { useEffect, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { useQueryClient } from "@tanstack/react-query"
import type { Screenshot } from "@/lib/api"
import { api } from "@/lib/api"
import { cn } from "@/lib/cn"
import { getBestAvailableMediaSrc, getBestAvailablePreviewSrc, getScreenshotMediaSrc, useResolvedScreenshotMedia } from "@/lib/media"
import { attachMediaSource } from "@/lib/hlsAttach"

interface ScreenshotLightboxProps {
  shots: Screenshot[]
  idx: number
  onClose: () => void
  onNavigate: (idx: number) => void
  favorites?: Set<number>
  onToggleFavorite?: (id: number) => void
  onRate?: (id: number, rating: number) => void
  onAddTag?: (id: number, tag: string) => void
  onRemoveTag?: (id: number, tag: string) => void
  allTags?: string[]
  onViewCreator?: (performerId: number, username: string) => void
}

/** Copy text to clipboard, returns true on success */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function isVideo(src: string): boolean {
  return /\.(mp4|webm|mov|m3u8)/i.test(src) || /m3u8/i.test(src)
}

function sourceLabel(source: string) {
  return source === "ddg" ? "DDG" : source === "redgifs" ? "Redgifs" : source === "x" ? "X" : source
}

export function ScreenshotLightbox({ shots, idx, onClose, onNavigate, favorites, onToggleFavorite, onRate, onAddTag, onRemoveTag, allTags, onViewCreator }: ScreenshotLightboxProps) {
  const shot = shots[idx]
  const { mediaSrc: src, previewSrc, posterSrc, isVideo: currentIsVideo, markMediaBroken, markPreviewBroken } = useResolvedScreenshotMedia(shot)

  const qc = useQueryClient()
  const videoRef = useRef<HTMLVideoElement>(null)
  const onCloseRef = useRef(onClose)
  const onNavigateRef = useRef(onNavigate)
  const onRateRef = useRef(onRate)
  const idxRef = useRef(idx)
  const shotsLenRef = useRef(shots.length)
  const shotsRef = useRef(shots)

  const [showInfo, setShowInfo] = useState(false)
  const [slideshowActive, setSlideshowActive] = useState(false)
  const [similar, setSimilar] = useState<Screenshot[]>([])
  const [showSimilar, setShowSimilar] = useState(false)
  const [summary, setSummary] = useState<string | null>(shot.ai_summary ?? null)
  const [tags, setTags] = useState<Record<string, unknown>>(() => {
    try { return shot.ai_tags ? JSON.parse(shot.ai_tags) : {} } catch { return {} }
  })
  const [summarizing, setSummarizing] = useState(false)
  const [refused, setRefused] = useState(false)
  const [refusedMessage, setRefusedMessage] = useState<string | null>(null)

  // Inline tag input state
  const [tagInput, setTagInput] = useState("")
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])

  // User tags derived from shot
  const userTags: string[] = (() => {
    try { return shot.user_tags ? JSON.parse(shot.user_tags) : [] } catch { return [] }
  })()

  // Image natural dimensions
  const [imgDimensions, setImgDimensions] = useState<{ w: number; h: number } | null>(null)

  // Video playback speed
  const [playbackRate, setPlaybackRate] = useState(1)
  const SPEED_STEPS = [0.25, 0.5, 1, 1.5, 2, 3]

  // Share button state
  const [shareToast, setShareToast] = useState<string | null>(null)

  // Rating toast (brief feedback when keyboard-rated)
  const [ratingToast, setRatingToast] = useState<number | null>(null)
  const ratingToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Filmstrip ref for auto-scroll
  const filmstripRef = useRef<HTMLDivElement>(null)

  // Pinch-to-zoom state
  const pinchStartDistRef = useRef<number | null>(null)
  const [zoomScale, setZoomScale] = useState(1)
  const zoomScaleRef = useRef(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const panOffsetRef = useRef({ x: 0, y: 0 })
  const lastTapRef = useRef(0)

  // Mouse drag-to-pan state
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })

  // Touch gesture support
  const touchStartRef = useRef({ x: 0, y: 0 })

  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => { onNavigateRef.current = onNavigate }, [onNavigate])
  useEffect(() => { onRateRef.current = onRate }, [onRate])
  useEffect(() => { idxRef.current = idx }, [idx])
  useEffect(() => { shotsLenRef.current = shots.length }, [shots.length])
  useEffect(() => { shotsRef.current = shots }, [shots])

  useEffect(() => {
    setSummary(shot.ai_summary ?? null)
    try { setTags(shot.ai_tags ? JSON.parse(shot.ai_tags) : {}) } catch { setTags({}) }
    setSummarizing(false)
    setRefused(false)
    setRefusedMessage(null)
    setSimilar([])
    setShowSimilar(false)
    setPlaybackRate(1)
    setImgDimensions(null)
    // Reset zoom/pan on image change
    setZoomScale(1)
    setPanOffset({ x: 0, y: 0 })
    zoomScaleRef.current = 1
    panOffsetRef.current = { x: 0, y: 0 }
  }, [idx, shot.ai_summary, shot.ai_tags])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !currentIsVideo || !src) return
    return attachMediaSource(v, src, { tryAutoplay: true, onFatalError: markMediaBroken })
  }, [currentIsVideo, src, shot.id])

  // Auto-scroll filmstrip to keep current thumbnail visible
  useEffect(() => {
    const strip = filmstripRef.current
    if (!strip) return
    const thumb = strip.children[idx] as HTMLElement | undefined
    if (!thumb) return
    const stripRect = strip.getBoundingClientRect()
    const thumbRect = thumb.getBoundingClientRect()
    const offset = thumbRect.left - stripRect.left - stripRect.width / 2 + thumbRect.width / 2
    strip.scrollBy({ left: offset, behavior: "smooth" })
  }, [idx])

  // Mouse wheel zoom
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY < 0 ? 1.1 : 0.9
      setZoomScale((prev) => {
        const next = Math.max(0.5, Math.min(6, prev * delta))
        zoomScaleRef.current = next
        if (next <= 1) {
          setPanOffset({ x: 0, y: 0 })
          panOffsetRef.current = { x: 0, y: 0 }
        }
        return next
      })
    }
    document.addEventListener("wheel", handler, { passive: false })
    return () => document.removeEventListener("wheel", handler)
  }, [])

  // Mouse drag-to-pan when zoomed
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (zoomScaleRef.current <= 1) return
      isDraggingRef.current = true
      dragStartRef.current = { x: e.clientX - panOffsetRef.current.x, y: e.clientY - panOffsetRef.current.y }
    }
    const onMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      const newOffset = {
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      }
      panOffsetRef.current = newOffset
      setPanOffset(newOffset)
    }
    const onUp = () => { isDraggingRef.current = false }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
  }, [])

  // Clear share toast after 2s
  useEffect(() => {
    if (!shareToast) return
    const t = setTimeout(() => setShareToast(null), 2000)
    return () => clearTimeout(t)
  }, [shareToast])

  // Sync playback rate to video element
  useEffect(() => {
    const v = videoRef.current
    if (v) v.playbackRate = playbackRate
  }, [playbackRate])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return

      const cur = idxRef.current
      const len = shotsLenRef.current

      if (e.key === "Escape") {
        onCloseRef.current()
      } else if (e.key === "ArrowLeft") {
        if (cur > 0) onNavigateRef.current(cur - 1)
      } else if (e.key === "ArrowRight") {
        if (cur < len - 1) onNavigateRef.current(cur + 1)
      } else if (e.key === " ") {
        e.preventDefault()
        const v = videoRef.current
        if (v) v.paused ? v.play() : v.pause()
      } else if (e.key.toLowerCase() === "f") {
        if (onToggleFavorite) onToggleFavorite(shotsRef.current[cur].id)
      } else if (e.key.toLowerCase() === "i") {
        setShowInfo((v) => !v)
      } else if (e.key.toLowerCase() === "d" && !e.metaKey && !e.ctrlKey) {
        // D — download current media
        e.preventDefault()
        const s = shotsRef.current[cur]
        const url = getBestAvailableMediaSrc(s) || getBestAvailablePreviewSrc(s) || s.page_url
        if (url) {
          const a = document.createElement("a")
          a.href = url
          a.download = s.term ? `${s.term.replace(/[^a-z0-9]+/gi, "_")}.${url.split(".").pop() ?? "jpg"}` : ""
          a.click()
          setShareToast("Downloading…")
        }
      } else if (e.key.toLowerCase() === "c" && !e.metaKey && !e.ctrlKey) {
        // C — copy URL to clipboard
        e.preventDefault()
        const s = shotsRef.current[cur]
        const url = getBestAvailableMediaSrc(s) || getBestAvailablePreviewSrc(s) || s.page_url
        if (url) copyToClipboard(url).then((ok) => {
          if (ratingToastTimerRef.current) clearTimeout(ratingToastTimerRef.current)
          setShareToast(ok ? "URL copied" : "Copy failed")
        })
      } else if (e.key.toLowerCase() === "p" && !e.metaKey && !e.ctrlKey) {
        // P — picture-in-picture
        e.preventDefault()
        const v = videoRef.current
        if (v && document.pictureInPictureEnabled) {
          if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(() => {})
          } else {
            v.requestPictureInPicture().catch(() => {})
          }
        }
      } else if (e.key === "]") {
        // ] — speed up
        e.preventDefault()
        setPlaybackRate((prev) => {
          const idx = SPEED_STEPS.indexOf(prev)
          const next = SPEED_STEPS[Math.min(idx + 1, SPEED_STEPS.length - 1)]
          return next
        })
      } else if (e.key === "[") {
        // [ — slow down
        e.preventDefault()
        setPlaybackRate((prev) => {
          const idx = SPEED_STEPS.indexOf(prev)
          const next = SPEED_STEPS[Math.max(idx - 1, 0)]
          return next
        })
      } else if (["1", "2", "3", "4", "5"].includes(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        const rating = parseInt(e.key, 10)
        const shot = shotsRef.current[cur]
        if (shot && onRateRef.current) {
          onRateRef.current(shot.id, rating)
          // Show brief rating toast
          if (ratingToastTimerRef.current) clearTimeout(ratingToastTimerRef.current)
          setRatingToast(rating)
          ratingToastTimerRef.current = setTimeout(() => setRatingToast(null), 1500)
        }
      }
    }

    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onToggleFavorite])

  // Slideshow auto-advance
  useEffect(() => {
    if (!slideshowActive) return
    const timer = setInterval(() => {
      const cur = idxRef.current
      const len = shotsLenRef.current
      if (cur < len - 1) {
        onNavigateRef.current(cur + 1)
      } else {
        setSlideshowActive(false)
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [slideshowActive])

  async function handleMoreLikeThis() {
    try {
      const results = await api.findSimilarScreenshots(shot.id)
      setSimilar(results)
      setShowSimilar(true)
    } catch {
      setSimilar([])
    }
  }

  async function handleSummarize() {
    setSummarizing(true)
    setRefused(false)
    setRefusedMessage(null)
    try {
      const result = await api.summarizeScreenshot(shot.id)
      if (result.refused) {
        setRefused(true)
        setRefusedMessage(result.message ?? "Model refused to describe this image.")
      } else {
        setSummary(result.summary)
        if (result.tags) setTags(result.tags)
        qc.invalidateQueries({ queryKey: ["screenshots"] })
        qc.invalidateQueries({ queryKey: ["media-stats"] })
      }
    } catch {
      setSummary("Failed to generate summary.")
    } finally {
      setSummarizing(false)
    }
  }

  function handleTagInputChange(val: string) {
    setTagInput(val)
    if (!val.trim() || !allTags) {
      setTagSuggestions([])
      return
    }
    const lower = val.toLowerCase()
    setTagSuggestions(
      allTags
        .filter((t) => t.toLowerCase().includes(lower) && !userTags.includes(t))
        .slice(0, 5)
    )
  }

  function handleTagSubmit(tag?: string) {
    const t = (tag ?? tagInput).trim().toLowerCase()
    if (!t || !onAddTag) return
    onAddTag(shot.id, t)
    setTagInput("")
    setTagSuggestions([])
  }

  // Share handler
  const handleShare = useCallback(async () => {
    const shareUrl = src ?? shot.page_url
    if (!shareUrl) return
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: shot.term, url: shareUrl })
      } catch {
        // user cancelled or error
      }
    } else {
      const ok = await copyToClipboard(shareUrl)
      setShareToast(ok ? "Link copied" : "Failed to copy")
    }
  }, [src, shot.page_url, shot.term])

  /** Distance between two touches */
  function touchDist(a: React.Touch, b: React.Touch) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    if (e.touches.length === 2) {
      pinchStartDistRef.current = touchDist(e.touches[0], e.touches[1])
    }
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    // Pinch-to-zoom
    if (e.touches.length === 2 && pinchStartDistRef.current !== null) {
      const dist = touchDist(e.touches[0], e.touches[1])
      const ratio = dist / pinchStartDistRef.current
      setZoomScale((prev) => Math.max(0.5, Math.min(5, prev * ratio)))
      pinchStartDistRef.current = dist
    }
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    // Reset pinch tracking
    if (e.touches.length < 2) pinchStartDistRef.current = null

    // Only process single-touch gestures when no remaining touches
    if (e.touches.length > 0) return

    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y

    // Double-tap detection: toggle between fit and 100%
    const now = Date.now()
    if (now - lastTapRef.current < 300 && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      setZoomScale((prev) => (prev === 1 ? 2 : 1))
      setPanOffset({ x: 0, y: 0 })
      lastTapRef.current = 0
      return
    }
    lastTapRef.current = now

    // Swipe navigation (only when not zoomed)
    if (zoomScale <= 1) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
        if (dx > 0 && idx > 0) onNavigate(idx - 1)
        else if (dx < 0 && idx < shots.length - 1) onNavigate(idx + 1)
      } else if (dy > 80) {
        onClose()
      }
    }
  }, [idx, shots.length, onNavigate, onClose, zoomScale])

  const atFirst = idx === 0
  const atLast = idx === shots.length - 1
  const isFav = favorites?.has(shot.id) ?? false

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot lightbox"
      className="fixed inset-0 z-50 bg-black/95 backdrop-blur-lg"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Floating glass pill controls — top right */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] backdrop-blur-lg px-2 py-1.5">
          <span className="px-2 text-[11px] font-mono text-white/60">
            {idx + 1}/{shots.length}
          </span>
          <div className="h-4 w-px bg-white/10" />
          <button
            onClick={() => setSlideshowActive((v) => !v)}
            title={slideshowActive ? "Pause slideshow" : "Start slideshow"}
            className={cn(
              "rounded-full p-2 text-sm transition-colors",
              slideshowActive ? "text-accent" : "text-white/60 hover:text-white"
            )}
            aria-label={slideshowActive ? "Pause slideshow" : "Start slideshow"}
          >
            {slideshowActive ? "\u23F8" : "\u25B6"}
          </button>
          {onToggleFavorite && (
            <button
              onClick={() => onToggleFavorite(shot.id)}
              title={isFav ? "Remove from favorites" : "Add to favorites"}
              className={cn(
                "rounded-full p-2 text-sm transition-colors",
                isFav ? "text-red-400" : "text-white/60 hover:text-red-300"
              )}
              aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
            >
              {isFav ? "\u2665" : "\u2661"}
            </button>
          )}
          {src && (
            <a
              href={src}
              download={shot.term ? `${shot.term.replace(/[^a-z0-9]+/gi, "_")}.${src.split(".").pop() ?? "jpg"}` : undefined}
              title="Download"
              className="rounded-full p-2 text-sm text-white/60 transition-colors hover:text-white"
              aria-label="Download"
              onClick={(e) => e.stopPropagation()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </a>
          )}
          <button
            onClick={handleShare}
            title="Share or copy link"
            className="rounded-full p-2 text-sm text-white/60 transition-colors hover:text-white"
            aria-label="Share"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
          </button>
          <button
            onClick={() => setShowInfo((v) => !v)}
            title="Toggle info panel (i)"
            className={cn(
              "rounded-full p-2 text-sm transition-colors",
              showInfo ? "text-accent" : "text-white/60 hover:text-white"
            )}
            aria-label="Toggle info panel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          </button>
          <div className="h-4 w-px bg-white/10" />
          <button
            onClick={onClose}
            className="rounded-full p-2 text-white/60 transition-colors hover:text-white"
            aria-label="Close lightbox"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="16" y2="16" />
              <line x1="16" y1="4" x2="4" y2="16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Navigation hit areas — transparent edges */}
      {!atFirst && (
        <button
          onClick={() => onNavigate(idx - 1)}
          className="absolute left-0 top-0 z-20 flex h-full w-20 items-center justify-start pl-4 text-white/0 hover:text-white/60 transition-colors"
          aria-label="Previous"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      )}
      {!atLast && (
        <button
          onClick={() => onNavigate(idx + 1)}
          className="absolute right-0 top-0 z-20 flex h-full w-20 items-center justify-end pr-4 text-white/0 hover:text-white/60 transition-colors"
          aria-label="Next"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      )}

      {/* Main media — centered, with zoom/pan */}
      <div
        className="flex h-full w-full items-center justify-center p-8 pb-24 overflow-hidden"
        style={{ cursor: zoomScale > 1 ? 'grab' : undefined }}
      >
        <div
          style={{
            transform: `scale(${zoomScale}) translate(${panOffset.x}px, ${panOffset.y}px)`,
            transition: zoomScale === 1 ? "transform 0.2s ease" : undefined,
          }}
        >
          {currentIsVideo && src ? (
            <div className="relative inline-block">
              <video
                ref={videoRef}
                poster={posterSrc || undefined}
                preload="auto"
                loop
                playsInline
                muted
                controls
                className="max-h-[80vh] max-w-[95vw] object-contain mx-auto rounded-lg"
                onCanPlay={(e) => { (e.target as HTMLVideoElement).playbackRate = playbackRate }}
                onError={markMediaBroken}
              />
              {/* Speed badge — top-left corner of video */}
              <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5">
                {playbackRate !== 1 && (
                  <span className="rounded-full border border-yellow-400/40 bg-black/70 backdrop-blur px-2 py-0.5 text-[11px] font-mono text-yellow-400">
                    {playbackRate}×
                  </span>
                )}
                {document.pictureInPictureEnabled && (
                  <button
                    onClick={() => {
                      const v = videoRef.current
                      if (!v) return
                      if (document.pictureInPictureElement) {
                        document.exitPictureInPicture().catch(() => {})
                      } else {
                        v.requestPictureInPicture().catch(() => {})
                      }
                    }}
                    title="Picture-in-Picture (P)"
                    className="rounded-full border border-white/20 bg-black/60 backdrop-blur p-1.5 text-white/60 hover:text-white transition-colors"
                    aria-label="Toggle picture-in-picture"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2"/>
                      <rect x="13" y="10" width="9" height="7" rx="1"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ) : previewSrc ? (
            <img
              key={previewSrc}
              src={previewSrc}
              alt={shot.term}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget
                setImgDimensions({ w: el.naturalWidth, h: el.naturalHeight })
              }}
              onError={markPreviewBroken}
              className="max-h-[80vh] max-w-[95vw] object-contain mx-auto select-none rounded-lg"
            />
          ) : (
            <div className="flex w-[min(95vw,56rem)] flex-col items-center justify-center gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-8 py-10 text-center">
              <div className="rounded-full border border-amber-300/30 bg-amber-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-100">
                Media unavailable
              </div>
              <p className="text-lg font-medium text-white/85">{shot.term}</p>
              <p className="max-w-full truncate text-sm text-amber-100/70" title={shot.page_url}>{shot.page_url}</p>
            </div>
          )}
        </div>
      </div>

      {/* Info panel — toggleable bottom overlay */}
      {showInfo && (
        <div className="absolute bottom-0 inset-x-0 z-30 bg-gradient-to-t from-black/90 via-black/70 to-transparent pt-16 pb-6 px-6 fade-in">
          <div className="mx-auto max-w-3xl space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{shot.term}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-white/60">
                  <span>{sourceLabel(shot.source)}</span>
                  <span>{shot.captured_at ? new Date(shot.captured_at).toLocaleString() : "Unknown date"}</span>
                  {imgDimensions && (
                    <span className="font-mono text-xs text-white/40">{imgDimensions.w}×{imgDimensions.h}</span>
                  )}
                </div>
              </div>
              {currentIsVideo && (
                <span className="shrink-0 rounded-full border border-teal/30 bg-teal/10 px-2.5 py-1 text-[11px] font-mono uppercase tracking-widest text-teal">
                  Video
                </span>
              )}
            </div>

            {shot.performer_id != null && shot.performer_username && onViewCreator && (
              <button
                onClick={() => { onViewCreator(shot.performer_id!, shot.performer_username!); onClose() }}
                className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs text-sky-300 hover:bg-sky-500/20 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="7" r="4"/><path d="M2 18c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                View all from @{shot.performer_username}
              </button>
            )}

            {shot.page_url && (
              <a
                href={shot.page_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-sm text-accent hover:text-accent-hover transition-colors"
              >
                {shot.page_url}
              </a>
            )}

            <div className="space-y-2">
              {summary ? (
                <>
                  <p className="text-sm leading-relaxed text-white/70">{summary}</p>
                  {Object.keys(tags).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {Object.entries(tags).map(([key, value]) => {
                        const display = Array.isArray(value) ? value.join(", ") : String(value)
                        return (
                          <span key={key} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/50">
                            <span className="text-white/30">{key.replace(/_/g, " ")}:</span>
                            <span className="text-white/70">{display}</span>
                          </span>
                        )
                      })}
                    </div>
                  )}
                </>
              ) : refused ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  <p className="text-xs text-amber-300">{refusedMessage}</p>
                  <p className="mt-1 text-[11px] text-amber-300/60">Go to Settings to configure an uncensored vision model.</p>
                </div>
              ) : (
                <button
                  onClick={handleSummarize}
                  disabled={summarizing}
                  className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white/60 transition-colors hover:text-white disabled:opacity-50"
                >
                  {summarizing ? "Describing..." : "Describe"}
                </button>
              )}
            </div>

            {/* User tags */}
            <div className="space-y-2">
              {userTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {userTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[11px] text-accent"
                    >
                      {tag}
                      {onRemoveTag && (
                        <button
                          onClick={() => onRemoveTag(shot.id, tag)}
                          className="ml-0.5 text-accent/60 hover:text-accent transition-colors leading-none"
                          aria-label={`Remove tag ${tag}`}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {onAddTag && (
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => handleTagInputChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); handleTagSubmit() }
                        if (e.key === "Escape") { setTagInput(""); setTagSuggestions([]) }
                      }}
                      placeholder="Add tag…"
                      className="w-28 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs text-white/70 placeholder-white/30 outline-none focus:border-accent/50 focus:ring-0 transition-colors"
                    />
                    {tagInput.trim() && (
                      <button
                        onClick={() => handleTagSubmit()}
                        className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs text-white/60 hover:text-white transition-colors"
                      >
                        +
                      </button>
                    )}
                  </div>
                  {tagSuggestions.length > 0 && (
                    <div className="absolute left-0 top-full mt-1 z-50 w-44 rounded-xl border border-white/10 bg-[#0d1526]/95 backdrop-blur-lg shadow-xl overflow-hidden">
                      {tagSuggestions.map((s) => (
                        <button
                          key={s}
                          onMouseDown={(e) => { e.preventDefault(); handleTagSubmit(s) }}
                          className="w-full px-3 py-1.5 text-left text-xs text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleMoreLikeThis}
                className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white/60 transition-colors hover:text-white"
              >
                More like this
              </button>
            </div>

            <div className="flex flex-wrap gap-3 text-[11px] text-white/40 font-mono">
              <span>Esc: close</span>
              <span>← →: navigate</span>
              <span>Space: play/pause</span>
              <span>Scroll: zoom</span>
              <span>F: favorite</span>
              <span>I: info</span>
              <span>C: copy URL</span>
              <span>1–5: rate</span>
              <span>[ ]: speed</span>
              <span>P: PiP</span>
            </div>
          </div>
        </div>
      )}

      {/* AI summary subtle overlay — shown when info panel is closed */}
      {!showInfo && summary && (
        <div className="absolute bottom-[76px] inset-x-0 z-20 pointer-events-none flex justify-center px-6 animate-in fade-in duration-500">
          <p className="max-w-2xl rounded-lg bg-black/60 backdrop-blur-md px-4 py-2 text-sm leading-relaxed text-white/70 line-clamp-2">
            {summary}
          </p>
        </div>
      )}

      {/* Share toast */}
      {shareToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 rounded-full bg-white/10 backdrop-blur-lg border border-white/10 px-4 py-1.5 text-xs text-white/80 animate-in fade-in duration-200">
          {shareToast}
        </div>
      )}

      {/* Rating toast */}
      {ratingToast !== null && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full bg-black/70 backdrop-blur-lg border border-yellow-400/30 px-4 py-2 animate-in fade-in duration-150">
          <span className="text-yellow-400 text-base tracking-wide">
            {"★".repeat(ratingToast)}{"☆".repeat(5 - ratingToast)}
          </span>
          <span className="text-xs text-white/60 font-mono">{ratingToast}/5</span>
        </div>
      )}

      {/* Filmstrip navigation bar */}
      <div className="absolute bottom-0 inset-x-0 z-30 h-[68px] bg-gradient-to-t from-black/80 to-transparent">
        <div
          ref={filmstripRef}
          className="flex items-end gap-1.5 h-full px-4 pb-2 overflow-x-auto hide-scrollbar"
        >
          {shots.map((s, i) => {
            const thumbMediaSrc = getScreenshotMediaSrc(s)
            const thumbPreviewSrc = getBestAvailablePreviewSrc(s)
            const isVideoThumb = thumbMediaSrc ? isVideo(thumbMediaSrc) : false
            return (
              <button
                key={s.id}
                onClick={() => onNavigate(i)}
                className={cn(
                  "flex-none w-12 h-12 rounded overflow-hidden border-2 transition-all duration-150",
                  i === idx
                    ? "border-accent ring-1 ring-accent/40 scale-110"
                    : "border-transparent opacity-50 hover:opacity-80"
                )}
                aria-label={`Go to image ${i + 1}`}
              >
                {isVideoThumb && getBestAvailableMediaSrc(s) ? (
                  <video src={getBestAvailableMediaSrc(s) ?? undefined} className="h-full w-full object-cover" muted />
                ) : (
                  <img src={thumbPreviewSrc || thumbMediaSrc} alt="" className="h-full w-full object-cover" loading="lazy" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {showSimilar && similar.length > 0 && (
        <div className="absolute bottom-[68px] left-0 right-0 z-40 p-3 glass border-t border-white/10">
          <p className="text-xs text-white/50 mb-2">Similar</p>
          <div className="flex gap-2 overflow-x-auto hide-scrollbar">
            {similar.map(s => {
              const simIdx = shots.findIndex(sh => sh.id === s.id)
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    if (simIdx >= 0) onNavigate(simIdx)
                  }}
                  disabled={simIdx < 0}
                  className={cn(
                    "flex-none w-16 h-16 rounded-lg overflow-hidden border border-white/10 transition-colors",
                    simIdx >= 0 ? "hover:border-accent cursor-pointer" : "opacity-50 cursor-default"
                  )}
                >
                  {(() => {
                    const similarSrc = getBestAvailableMediaSrc(s)
                    return similarSrc?.endsWith('.mp4') ? (
                      <video src={similarSrc} className="h-full w-full object-cover" muted />
                    ) : (
                      <img src={similarSrc ?? ''} alt="" className="h-full w-full object-cover" />
                    )
                  })()}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
