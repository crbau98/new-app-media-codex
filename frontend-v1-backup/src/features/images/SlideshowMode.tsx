import { useState, useEffect, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import type { Screenshot } from "@/lib/api"
import { cn } from "@/lib/cn"
import { getBestAvailableMediaSrc, getBestAvailablePreviewSrc, getMediaDebugLabel, useResolvedScreenshotMedia } from "@/lib/media"
import { attachMediaSource, isArchiverVideoSource, isCoomerWaterfallActive } from "@/lib/hlsAttach"

function isVideoPath(url: string): boolean {
  if (!url) return false
  return /\.(mp4|webm|mov|avi|mkv|m3u8)/i.test(url) || /m3u8/i.test(url)
}

type SlideshowSpeed = 3 | 5 | 8 | 15

interface SlideshowModeProps {
  shots: Screenshot[]
  startIdx?: number
  onClose: () => void
}

export function SlideshowMode({ shots, startIdx = 0, onClose }: SlideshowModeProps) {
  const [idx, setIdx] = useState(startIdx)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState<SlideshowSpeed>(5)
  const [shuffle, setShuffle] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [transitioning, setTransitioning] = useState(false)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [videoLoadFailed, setVideoLoadFailed] = useState(false)
  const [previewLoadFailed, setPreviewLoadFailed] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stable refs for keyboard/timer handlers
  const idxRef = useRef(idx)
  const playingRef = useRef(playing)
  const speedRef = useRef(speed)
  const shuffleRef = useRef(shuffle)
  const shotsRef = useRef(shots)
  const onCloseRef = useRef(onClose)

  useEffect(() => { idxRef.current = idx }, [idx])
  useEffect(() => { playingRef.current = playing }, [playing])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { shuffleRef.current = shuffle }, [shuffle])
  useEffect(() => { shotsRef.current = shots }, [shots])
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  const shot = shots[idx]
  const { mediaSrc: resolvedSrc, previewSrc, isVideo: currentIsVideo, markMediaBroken, markPreviewBroken } = useResolvedScreenshotMedia(shot)
  const src = shot ? resolvedSrc : ""
  const mediaLabel = shot ? getMediaDebugLabel(shot) : "missing-slide"

  useEffect(() => {
    setVideoLoadFailed(false)
    setPreviewLoadFailed(false)
  }, [src])

  const [inlineFallback, setInlineFallback] = useState(false)
  useEffect(() => { setInlineFallback(false) }, [src])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !currentIsVideo || !src || videoLoadFailed || inlineFallback) return
    const isArchiver = isArchiverVideoSource(shot?.source)
    return attachMediaSource(v, src, {
      tryAutoplay: true,
      onFatalError: () => {
        if (isArchiver && shot?.source_url?.startsWith("http")) {
          setInlineFallback(true)
          return
        }
        markMediaBroken()
      },
      shotId: shot?.id,
      shotSource: shot?.source,
    })
  }, [currentIsVideo, src, videoLoadFailed, inlineFallback, shot?.id, shot?.source, shot?.source_url, markMediaBroken])

  // Preload next image
  const nextIdx = shuffle
    ? Math.floor(Math.random() * shots.length)
    : Math.min(idx + 1, shots.length - 1)
  const nextShot = shots[nextIdx]
  const nextSrc = nextShot ? getBestAvailablePreviewSrc(nextShot) : ""

  useEffect(() => {
    if (!nextSrc || isVideoPath(nextSrc)) return
    const img = new Image()
    img.src = nextSrc
  }, [nextSrc])

  // Fullscreen API
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {})
    }
    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {})
      }
    }
  }, [])

  // Listen for fullscreen exit
  useEffect(() => {
    function onFsChange() {
      if (!document.fullscreenElement) {
        onCloseRef.current()
      }
    }
    document.addEventListener("fullscreenchange", onFsChange)
    return () => document.removeEventListener("fullscreenchange", onFsChange)
  }, [])

  // Advance logic
  const advance = useCallback(() => {
    setTransitioning(true)
    setTimeout(() => {
      if (shuffleRef.current) {
        setIdx(Math.floor(Math.random() * shotsRef.current.length))
      } else {
        setIdx((prev) => {
          if (prev >= shotsRef.current.length - 1) {
            setPlaying(false)
            return prev
          }
          return prev + 1
        })
      }
      setTransitioning(false)
    }, 200)
  }, [])

  // Auto-advance timer
  useEffect(() => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current)
    if (!playing) return

    const shotSrc = shots[idx] ? getBestAvailableMediaSrc(shots[idx]) : ""
    if (isVideoPath(shotSrc)) {
      // For videos, wait for them to end
      return
    }

    advanceTimerRef.current = setTimeout(() => {
      advance()
    }, speed * 1000)

    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current)
    }
  }, [playing, idx, speed, shots, advance])

  // Video ended handler
  const handleVideoEnded = useCallback(() => {
    if (playingRef.current) {
      advance()
    }
  }, [advance])

  // Auto-hide controls
  const resetControlsTimer = useCallback(() => {
    setShowControls(true)
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000)
  }, [])

  useEffect(() => {
    resetControlsTimer()
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    }
  }, [resetControlsTimer])

  // Mouse move shows controls
  const handleMouseMove = useCallback(() => {
    resetControlsTimer()
  }, [resetControlsTimer])

  // Keyboard
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current()
      } else if (e.key === " ") {
        e.preventDefault()
        setPlaying((v) => !v)
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        setIdx((prev) => Math.max(0, prev - 1))
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        advance()
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [advance])

  const speeds: SlideshowSpeed[] = [3, 5, 8, 15]

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[60] bg-black flex items-center justify-center cursor-none"
      onMouseMove={handleMouseMove}
      onClick={() => resetControlsTimer()}
      style={{ cursor: showControls ? "default" : "none" }}
    >
      {/* Current slide with crossfade */}
      <div
        className="absolute inset-0 flex items-center justify-center transition-opacity duration-200"
        style={{ opacity: transitioning ? 0 : 1 }}
      >
        {currentIsVideo && src && !videoLoadFailed ? (
          inlineFallback && shot?.source_url?.startsWith("http") ? (
            <video
              key={`inline-${shot.id}`}
              src={shot.source_url}
              playsInline
              muted
              autoPlay
              loop
              controls
              onEnded={handleVideoEnded}
              className="max-h-[90vh] max-w-[95vw] object-contain"
            />
          ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            onEnded={handleVideoEnded}
            onError={(e) => {
              if (isCoomerWaterfallActive(e.currentTarget)) return
              markMediaBroken(); setVideoLoadFailed(true)
            }}
            className="max-h-[90vh] max-w-[95vw] object-contain"
          />
          )
        ) : previewSrc && !previewLoadFailed ? (
          <img
            key={previewSrc}
            src={previewSrc}
            alt={shot?.term ?? ""}
            draggable={false}
            onError={() => { markPreviewBroken(); setPreviewLoadFailed(true) }}
            className="max-h-[90vh] max-w-[95vw] object-contain select-none"
          />
        ) : (
          <div className="flex max-h-[90vh] w-[min(95vw,56rem)] flex-col items-center justify-center gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-8 py-10 text-center">
            <div className="rounded-full border border-amber-300/30 bg-amber-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-100">
              Slide unavailable
            </div>
            <p className="text-lg font-medium text-white/85">{shot?.term ?? "Missing media"}</p>
            <p className="max-w-full truncate text-sm text-amber-100/70" title={mediaLabel}>{mediaLabel}</p>
          </div>
        )}
      </div>

      {/* Controls overlay */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-10 transition-opacity duration-300",
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        {/* Progress bar */}
        <div className="mx-8 mb-2 h-1 rounded-full bg-white/20 overflow-hidden">
          <div
            className="h-full bg-[var(--color-accent)] transition-all duration-300"
            style={{ width: `${((idx + 1) / shots.length) * 100}%` }}
          />
        </div>

        <div className="flex items-center justify-between px-8 pb-6 pt-2 bg-gradient-to-t from-black/80 to-transparent">
          {/* Left: position */}
          <span className="text-sm font-mono text-white/60 min-w-[80px]">
            {idx + 1} / {shots.length}
          </span>

          {/* Center: transport controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); setIdx((prev) => Math.max(0, prev - 1)) }}
              className="rounded-full p-2 text-white/70 hover:text-white transition-colors"
              aria-label="Previous"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="19 20 9 12 19 4 19 20" fill="currentColor" />
                <line x1="5" y1="19" x2="5" y2="5" />
              </svg>
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); setPlaying((v) => !v) }}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6 3 20 12 6 21 6 3" />
                </svg>
              )}
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); advance() }}
              className="rounded-full p-2 text-white/70 hover:text-white transition-colors"
              aria-label="Next"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" />
                <line x1="19" y1="5" x2="19" y2="19" />
              </svg>
            </button>
          </div>

          {/* Right: speed, shuffle, exit */}
          <div className="flex items-center gap-2 min-w-[80px] justify-end">
            {/* Speed selector */}
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowSpeedMenu((v) => !v) }}
                className="rounded-full px-2 py-1 text-xs font-mono text-white/60 hover:text-white transition-colors"
                aria-label="Change speed"
              >
                {speed}s
              </button>
              {showSpeedMenu && (
                <div className="absolute bottom-full mb-2 right-0 rounded-lg border border-white/10 bg-black/90 backdrop-blur-lg p-1 shadow-xl">
                  {speeds.map((s) => (
                    <button
                      key={s}
                      onClick={(e) => { e.stopPropagation(); setSpeed(s); setShowSpeedMenu(false) }}
                      className={cn(
                        "block w-full rounded px-3 py-1.5 text-xs font-mono text-left transition-colors",
                        s === speed ? "bg-white/10 text-white" : "text-white/60 hover:text-white hover:bg-white/5"
                      )}
                    >
                      {s}s
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Shuffle */}
            <button
              onClick={(e) => { e.stopPropagation(); setShuffle((v) => !v) }}
              className={cn(
                "rounded-full p-2 transition-colors",
                shuffle ? "text-[var(--color-accent)]" : "text-white/40 hover:text-white/70"
              )}
              aria-label={shuffle ? "Disable shuffle" : "Enable shuffle"}
              title={shuffle ? "Shuffle on" : "Shuffle off"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 3 21 3 21 8" />
                <line x1="4" y1="20" x2="21" y2="3" />
                <polyline points="21 16 21 21 16 21" />
                <line x1="15" y1="15" x2="21" y2="21" />
                <line x1="4" y1="4" x2="9" y2="9" />
              </svg>
            </button>

            {/* Exit */}
            <button
              onClick={(e) => { e.stopPropagation(); onClose() }}
              className="rounded-full p-2 text-white/60 hover:text-white transition-colors"
              aria-label="Exit slideshow"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="4" x2="16" y2="16" />
                <line x1="16" y1="4" x2="4" y2="16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Term label (top-left, fades with controls) */}
      <div
        className={cn(
          "absolute top-4 left-4 z-10 transition-opacity duration-300",
          showControls ? "opacity-100" : "opacity-0"
        )}
      >
        <p className="text-sm text-white/60">{shot?.term}</p>
      </div>
    </div>,
    document.body
  )
}
