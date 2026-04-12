import { useCallback, useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api, type Screenshot } from "@/lib/api"
import { cn } from "@/lib/cn"
import { StarRating } from "@/components/StarRating"
import { getBestAvailableMediaSrc, getBestAvailablePosterSrc, getBestAvailablePreviewSrc, useResolvedScreenshotMedia } from "@/lib/media"
import { attachMediaSource } from "@/lib/hlsAttach"

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function sourceLabel(source: string) {
  return source === "ddg" ? "DDG" : source === "redgifs" ? "Redgifs" : source === "x" ? "X" : source
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00"
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, "0")}`
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

function isVideoAsset(path: string): boolean {
  return /\.(mp4|webm|mov|avi|mkv)/i.test(path)
}

/* ------------------------------------------------------------------ */
/*  SVG icon components (inline, no external dep)                     */
/* ------------------------------------------------------------------ */

const iconProps = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }

function PlayIcon() { return <svg {...iconProps}><polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" /></svg> }
function PauseIcon() { return <svg {...iconProps}><rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none" /><rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none" /></svg> }
function VolumeHighIcon() { return <svg {...iconProps}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg> }
function VolumeMuteIcon() { return <svg {...iconProps}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg> }
function VolumeLowIcon() { return <svg {...iconProps}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg> }
function MaximizeIcon() { return <svg {...iconProps}><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></svg> }
function MinimizeIcon() { return <svg {...iconProps}><path d="M4 14h6v6" /><path d="M20 10h-6V4" /><path d="M14 10l7-7" /><path d="M3 21l7-7" /></svg> }
function PipIcon() { return <svg {...iconProps}><rect x="2" y="3" width="20" height="14" rx="2" /><rect x="12" y="10" width="8" height="6" rx="1" fill="currentColor" stroke="none" /></svg> }
function RepeatIcon({ active }: { active: boolean }) { return <svg {...iconProps} className={active ? "text-blue-400" : ""}><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg> }
function TheaterIcon() { return <svg {...iconProps}><rect x="1" y="5" width="22" height="14" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg> }
function Rewind10() { return <svg {...iconProps} viewBox="0 0 24 24"><path d="M12.5 8.5l-4 3.5 4 3.5" fill="currentColor" stroke="none" /><text x="15" y="14" fontSize="7" fill="currentColor" fontFamily="monospace">10</text></svg> }
function Forward10() { return <svg {...iconProps} viewBox="0 0 24 24"><path d="M11.5 8.5l4 3.5-4 3.5" fill="currentColor" stroke="none" /><text x="3" y="14" fontSize="7" fill="currentColor" fontFamily="monospace">10</text></svg> }

/* ------------------------------------------------------------------ */
/*  Big center play overlay                                           */
/* ------------------------------------------------------------------ */

function BigPlayButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 transition-opacity hover:bg-black/40">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-transform hover:scale-110">
        <svg width="32" height="32" viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3" fill="white" /></svg>
      </div>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Seek indicator overlay (double-tap rewind/forward)                */
/* ------------------------------------------------------------------ */

function SeekIndicator({ side, visible }: { side: "left" | "right"; visible: boolean }) {
  if (!visible) return null
  return (
    <div className={cn(
      "pointer-events-none absolute top-0 flex h-full w-1/3 items-center justify-center",
      side === "left" ? "left-0" : "right-0",
    )}>
      <div className="animate-ping rounded-full bg-white/30 p-4">
        {side === "left" ? <Rewind10 /> : <Forward10 />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

interface Props {
  shot: Screenshot
  onClose: () => void
  onDelete: () => void
  favorite: boolean
  onToggleFavorite: () => void
  onRate?: (rating: number) => void
  onOpenRelated?: (shot: Screenshot) => void
  userTags?: string[]
  onAddTag?: (tag: string) => void
  onRemoveTag?: (tag: string) => void
}

export function InlineVideoPlayer({ shot, onClose, onDelete, favorite, onToggleFavorite, onRate, onOpenRelated, userTags = [], onAddTag, onRemoveTag }: Props) {
  const { mediaSrc: src, previewSrc, posterSrc, isVideo: currentIsVideo, markMediaBroken, markPreviewBroken } = useResolvedScreenshotMedia(shot)
  const qc = useQueryClient()

  /* refs */
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* playback state */
  const [playing, setPlaying] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [buffering, setBuffering] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [loop, setLoop] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [theater, setTheater] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)

  /* progress bar scrubbing */
  const [scrubbing, setScrubbing] = useState(false)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState(0)

  /* double-click seek overlay */
  const [seekIndicator, setSeekIndicator] = useState<"left" | "right" | null>(null)
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* AI summary */
  const [summarizing, setSummarizing] = useState(false)
  const [summary, setSummary] = useState<string | null>(shot.ai_summary ?? null)

  /* Related media */
  const { data: relatedShots } = useQuery({
    queryKey: ["related-screenshots", shot.id],
    queryFn: () => api.relatedScreenshots(shot.id),
    staleTime: 120_000,
  })

  /* ---------------------------------------------------------------- */
  /*  Video event handlers                                            */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const v = videoRef.current
    if (!v || !currentIsVideo || !src) return
    return attachMediaSource(v, src, { tryAutoplay: true, onFatalError: markMediaBroken })
  }, [currentIsVideo, src])

  const syncTime = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    setCurrentTime(v.currentTime)
    if (v.buffered.length > 0) {
      setBuffered(v.buffered.end(v.buffered.length - 1))
    }
  }, [])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onPlay = () => { setPlaying(true); setHasStarted(true) }
    const onPause = () => setPlaying(false)
    const onMeta = () => setDuration(v.duration)
    const onEnded = () => { if (!loop) setPlaying(false) }
    v.addEventListener("play", onPlay)
    v.addEventListener("pause", onPause)
    v.addEventListener("loadedmetadata", onMeta)
    v.addEventListener("timeupdate", syncTime)
    v.addEventListener("ended", onEnded)
    return () => {
      v.removeEventListener("play", onPlay)
      v.removeEventListener("pause", onPause)
      v.removeEventListener("loadedmetadata", onMeta)
      v.removeEventListener("timeupdate", syncTime)
      v.removeEventListener("ended", onEnded)
    }
  }, [loop, syncTime])

  /* ---------------------------------------------------------------- */
  /*  Play / pause                                                    */
  /* ---------------------------------------------------------------- */

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play().catch(() => {}) } else { v.pause() }
  }, [])

  /* ---------------------------------------------------------------- */
  /*  Volume                                                          */
  /* ---------------------------------------------------------------- */

  const applyVolume = useCallback((val: number) => {
    const v = videoRef.current
    if (!v) return
    const clamped = Math.max(0, Math.min(1, val))
    v.volume = clamped
    setVolume(clamped)
    if (clamped === 0) { setMuted(true); v.muted = true }
    else if (muted) { setMuted(false); v.muted = false }
  }, [muted])

  const toggleMute = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }, [])

  /* ---------------------------------------------------------------- */
  /*  Seek                                                            */
  /* ---------------------------------------------------------------- */

  const seek = useCallback((t: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(t, v.duration || 0))
    setCurrentTime(v.currentTime)
  }, [])

  /* ---------------------------------------------------------------- */
  /*  Speed                                                           */
  /* ---------------------------------------------------------------- */

  const cycleSpeed = useCallback((dir: 1 | -1 = 1) => {
    const v = videoRef.current
    if (!v) return
    const idx = SPEEDS.indexOf(speed as typeof SPEEDS[number])
    const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, idx + dir))]
    v.playbackRate = next
    setSpeed(next)
  }, [speed])

  /* ---------------------------------------------------------------- */
  /*  Loop                                                            */
  /* ---------------------------------------------------------------- */

  const toggleLoop = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.loop = !v.loop
    setLoop(v.loop)
  }, [])

  /* ---------------------------------------------------------------- */
  /*  Fullscreen                                                      */
  /* ---------------------------------------------------------------- */

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      el.requestFullscreen().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  /* ---------------------------------------------------------------- */
  /*  Picture-in-Picture                                              */
  /* ---------------------------------------------------------------- */

  const togglePip = useCallback(async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else {
        await v.requestPictureInPicture()
      }
    } catch { /* pip not supported */ }
  }, [])

  /* ---------------------------------------------------------------- */
  /*  Theater mode                                                    */
  /* ---------------------------------------------------------------- */

  const toggleTheater = useCallback(() => setTheater(p => !p), [])

  /* ---------------------------------------------------------------- */
  /*  Auto-hide controls                                              */
  /* ---------------------------------------------------------------- */

  const showControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setControlsVisible(false)
      }
    }, 3000)
  }, [])

  useEffect(() => {
    // always show on pause
    if (!playing) setControlsVisible(true)
  }, [playing])

  useEffect(() => {
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current) }
  }, [])

  /* ---------------------------------------------------------------- */
  /*  Gesture: double-click left/right to seek, click center to play  */
  /* ---------------------------------------------------------------- */

  const clickCountRef = useRef(0)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleVideoClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const third = rect.width / 3

    clickCountRef.current++
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)

    clickTimerRef.current = setTimeout(() => {
      const clicks = clickCountRef.current
      clickCountRef.current = 0

      if (clicks >= 2) {
        // double click
        const v = videoRef.current
        if (!v) return
        if (x < third) {
          seek(v.currentTime - 10)
          setSeekIndicator("left")
        } else if (x > third * 2) {
          seek(v.currentTime + 10)
          setSeekIndicator("right")
        } else {
          togglePlay()
        }
        if (seekTimerRef.current) clearTimeout(seekTimerRef.current)
        seekTimerRef.current = setTimeout(() => setSeekIndicator(null), 600)
      } else {
        // single click center
        togglePlay()
      }
    }, 250)
  }, [seek, togglePlay])

  /* ---------------------------------------------------------------- */
  /*  Gesture: scroll to adjust volume                                */
  /* ---------------------------------------------------------------- */

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    applyVolume(volume + (e.deltaY < 0 ? 0.05 : -0.05))
  }, [applyVolume, volume])

  /* ---------------------------------------------------------------- */
  /*  Progress bar scrubbing                                          */
  /* ---------------------------------------------------------------- */

  const getTimeFromProgressEvent = useCallback((clientX: number): number => {
    const bar = progressRef.current
    if (!bar || !duration) return 0
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return ratio * duration
  }, [duration])

  const handleProgressMouseDown = useCallback((e: React.MouseEvent) => {
    setScrubbing(true)
    seek(getTimeFromProgressEvent(e.clientX))
  }, [getTimeFromProgressEvent, seek])

  useEffect(() => {
    if (!scrubbing) return
    const onMove = (e: MouseEvent) => {
      seek(getTimeFromProgressEvent(e.clientX))
    }
    const onUp = () => setScrubbing(false)
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [scrubbing, getTimeFromProgressEvent, seek])

  const handleProgressHover = useCallback((e: React.MouseEvent) => {
    const bar = progressRef.current
    if (!bar || !duration) { setHoverTime(null); return }
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setHoverTime(ratio * duration)
    setHoverX(e.clientX - rect.left)
  }, [duration])

  /* ---------------------------------------------------------------- */
  /*  Keyboard shortcuts                                              */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      const v = videoRef.current
      if (!v) return

      switch (e.key) {
        case "Escape":
          if (theater) { setTheater(false); e.preventDefault() }
          else { onClose() }
          break
        case " ":
          e.preventDefault()
          togglePlay()
          break
        case "ArrowLeft":
          e.preventDefault()
          seek(v.currentTime - 5)
          break
        case "ArrowRight":
          e.preventDefault()
          seek(v.currentTime + 5)
          break
        case "ArrowUp":
          e.preventDefault()
          applyVolume(volume + 0.1)
          break
        case "ArrowDown":
          e.preventDefault()
          applyVolume(volume - 0.1)
          break
        case "m":
        case "M":
          toggleMute()
          break
        case "f":
        case "F":
          toggleFullscreen()
          break
        case "l":
        case "L":
          toggleLoop()
          break
        case "t":
        case "T":
          toggleTheater()
          break
        case "<":
          cycleSpeed(-1)
          break
        case ">":
          cycleSpeed(1)
          break
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, theater, togglePlay, seek, applyVolume, volume, toggleMute, toggleFullscreen, toggleLoop, toggleTheater, cycleSpeed])

  /* ---------------------------------------------------------------- */
  /*  AI describe                                                     */
  /* ---------------------------------------------------------------- */

  async function handleDescribe() {
    setSummarizing(true)
    try {
      const result = await api.summarizeScreenshot(shot.id)
      if (result.summary) {
        setSummary(result.summary)
        qc.invalidateQueries({ queryKey: ["screenshots"] })
        qc.invalidateQueries({ queryKey: ["media-stats"] })
      }
    } catch { /* ignore */ }
    setSummarizing(false)
  }

  /* ---------------------------------------------------------------- */
  /*  Derived values                                                  */
  /* ---------------------------------------------------------------- */

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0

  const VolumeIcon = muted || volume === 0 ? VolumeMuteIcon : volume < 0.5 ? VolumeLowIcon : VolumeHighIcon

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  return (
    <div className={cn(
      "col-span-full animate-in fade-in duration-300",
      theater && "fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4",
    )}>
      {/* Video wrapper */}
      <div
        ref={containerRef}
        className={cn(
          "group relative overflow-hidden rounded-lg bg-black",
          theater && "w-[90vw] max-w-[1600px]",
        )}
        onMouseMove={showControls}
        onMouseLeave={() => { if (playing) setControlsVisible(false) }}
      >
        {currentIsVideo && src ? (
          <>
            {/* Video element - no native controls */}
            <video
              ref={videoRef}
              poster={posterSrc || undefined}
              preload="metadata"
              playsInline
              loop={loop}
              muted={muted}
              onWheel={handleWheel}
              onError={() => { setBuffering(false); markMediaBroken() }}
              onWaiting={() => setBuffering(true)}
              onCanPlay={() => setBuffering(false)}
              onPlaying={() => setBuffering(false)}
              className="mx-auto max-h-[70vh] w-full cursor-pointer object-contain"
            />

            {/* Buffering spinner */}
            {buffering && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <div className="h-10 w-10 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              </div>
            )}

            {/* Big play button when not started */}
            {!hasStarted && !playing && !buffering && <BigPlayButton onClick={togglePlay} />}

            {/* Click area for play/pause & double-tap seek */}
            {hasStarted && (
              <div className="absolute inset-0 z-[5]" onClick={handleVideoClick} />
            )}
          </>
        ) : previewSrc ? (
          <img
            src={previewSrc}
            alt={shot.term}
            loading="eager"
            decoding="async"
            draggable={false}
            onError={markPreviewBroken}
            className="mx-auto max-h-[70vh] w-full object-contain select-none"
          />
        ) : (
          <div className="flex min-h-[24rem] items-center justify-center px-6 py-10 text-center">
            <div className="flex max-w-xl flex-col items-center gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-8 py-8">
              <div className="rounded-full border border-amber-300/30 bg-amber-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-100">
                Media unavailable
              </div>
              <p className="text-lg font-medium text-white/85">{shot.term}</p>
              <p className="text-sm text-amber-100/70">This media could not be loaded right now. You can still open the original source from the actions below.</p>
            </div>
          </div>
        )}

        {/* Seek indicator overlays */}
        <SeekIndicator side="left" visible={seekIndicator === "left"} />
        <SeekIndicator side="right" visible={seekIndicator === "right"} />

        {/* ---- Custom controls bar ---- */}
        <div className={cn(
          "absolute inset-x-0 bottom-0 z-20 flex flex-col transition-opacity duration-300",
          controlsVisible || !playing ? "opacity-100" : "pointer-events-none opacity-0",
        )}>
          {/* Progress bar */}
          <div
            ref={progressRef}
            className="group/bar relative mx-2 h-1 cursor-pointer rounded-full bg-white/20 transition-all hover:h-2"
            onMouseDown={handleProgressMouseDown}
            onMouseMove={handleProgressHover}
            onMouseLeave={() => setHoverTime(null)}
          >
            {/* Buffered */}
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-white/30"
              style={{ width: `${bufferedPct}%` }}
            />
            {/* Played */}
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-blue-500"
              style={{ width: `${progress}%` }}
            />
            {/* Scrub handle */}
            <div
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400 opacity-0 shadow transition-opacity group-hover/bar:opacity-100"
              style={{ left: `${progress}%` }}
            />
            {/* Hover tooltip */}
            {hoverTime !== null && (
              <div
                className="absolute -top-8 -translate-x-1/2 rounded bg-black/80 px-2 py-0.5 text-xs font-mono text-white"
                style={{ left: `${hoverX}px` }}
              >
                {fmtTime(hoverTime)}
              </div>
            )}
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-1 bg-black/60 px-2 py-1.5 backdrop-blur-sm">
            {/* Play / Pause */}
            <ControlBtn onClick={togglePlay} title={playing ? "Pause" : "Play"}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </ControlBtn>

            {/* Time display */}
            <span className="mx-1 select-none font-mono text-xs text-white/80">
              {fmtTime(currentTime)} / {fmtTime(duration)}
            </span>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Volume */}
            <ControlBtn onClick={toggleMute} title={muted ? "Unmute (M)" : "Mute (M)"}>
              <VolumeIcon />
            </ControlBtn>
            <input
              type="range" min={0} max={1} step={0.01}
              value={muted ? 0 : volume}
              onChange={e => applyVolume(Number(e.target.value))}
              className="h-1 w-16 cursor-pointer accent-blue-500 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3"
              title="Volume"
            />

            {/* Speed */}
            <ControlBtn onClick={() => cycleSpeed(1)} title="Playback speed (< / >)">
              <span className="text-xs font-mono font-semibold">{speed}x</span>
            </ControlBtn>

            {/* Loop */}
            <ControlBtn onClick={toggleLoop} title={`Loop (L) ${loop ? "ON" : "OFF"}`}>
              <RepeatIcon active={loop} />
            </ControlBtn>

            {/* PiP */}
            <ControlBtn onClick={togglePip} title="Picture-in-Picture">
              <PipIcon />
            </ControlBtn>

            {/* Theater */}
            <ControlBtn onClick={toggleTheater} title="Theater mode (T)">
              <TheaterIcon />
            </ControlBtn>

            {/* Fullscreen */}
            <ControlBtn onClick={toggleFullscreen} title="Fullscreen (F)">
              {isFullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
            </ControlBtn>
          </div>
        </div>
      </div>

      {/* Metadata bar below video */}
      <div className={cn(
        "flex items-center justify-between gap-4 px-2 py-3",
        theater && "w-[90vw] max-w-[1600px]",
      )}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{shot.term}</p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {sourceLabel(shot.source)} · {shot.captured_at ? new Date(shot.captured_at).toLocaleDateString() : ""}
          </p>
          {summary && <p className="mt-1 text-xs text-[var(--color-text-secondary)] line-clamp-2">{summary}</p>}
          {/* User tags */}
          {(userTags.length > 0 || onAddTag) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {userTags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] text-blue-300">
                  {t}
                  {onRemoveTag && (
                    <button onClick={() => onRemoveTag(t)} className="hover:text-white">&times;</button>
                  )}
                </span>
              ))}
              {onAddTag && (
                <button
                  onClick={() => {
                    const tag = prompt("Add tag:")
                    if (tag?.trim()) onAddTag(tag.trim().toLowerCase())
                  }}
                  className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] hover:bg-white/10"
                >
                  + tag
                </button>
              )}
            </div>
          )}
          {onRate && (
            <div className="mt-1.5">
              <StarRating value={shot.rating ?? 0} onChange={onRate} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onToggleFavorite} title={favorite ? "Unfavorite" : "Favorite"}
            className={cn("rounded-full p-2 text-sm transition-colors",
              favorite ? "text-red-400" : "text-[var(--color-text-muted)] hover:text-red-400")}>
            {favorite ? "\u2665" : "\u2661"}
          </button>
          {shot.page_url && (
            <a href={shot.page_url} target="_blank" rel="noopener noreferrer"
              className="rounded-full p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]" title="Open source">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>
            </a>
          )}
          <button onClick={handleDescribe} disabled={summarizing}
            className="rounded-full p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-50" title="AI Describe">
            {summarizing ? "\u2026" : "\u2726"}
          </button>
          <button onClick={onDelete}
            className="rounded-full p-2 text-[var(--color-text-muted)] hover:text-red-400" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
          <button onClick={onClose}
            className="rounded-full p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]" title="Close">
            \u2715
          </button>
        </div>
      </div>

      {/* More Like This */}
      {relatedShots && relatedShots.length > 0 && (
        <div className={cn("px-2 pb-3", theater && "w-[90vw] max-w-[1600px]")}>
          <p className="mb-2 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">More Like This</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-white/10">
            {relatedShots.map((rel) => {
              const relSrc = getBestAvailableMediaSrc(rel)
              const relPreviewSrc = getBestAvailablePreviewSrc(rel)
              const relPosterSrc = getBestAvailablePosterSrc(rel)
              const isVid = isVideoAsset(relSrc)
              return (
                <button
                  key={rel.id}
                  onClick={() => onOpenRelated?.(rel)}
                  className="group/rel relative flex-shrink-0 h-16 w-16 overflow-hidden rounded-md bg-white/5 transition-all hover:ring-2 hover:ring-[var(--color-accent)]"
                  title={rel.term}
                >
                  {relPreviewSrc || relPosterSrc ? (
                    <img
                      src={relPreviewSrc || relPosterSrc}
                      alt={rel.term}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                      fetchPriority="low"
                    />
                  ) : isVid && relSrc ? (
                    <video
                      src={relSrc}
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
                  {isVid && (
                    <div className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[8px] text-white/80">
                      <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,0 10,5 2,10" /></svg>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Reusable control button                                           */
/* ------------------------------------------------------------------ */

function ControlBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded text-white/80 transition-colors hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  )
}
