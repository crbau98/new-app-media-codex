import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, type Screenshot, type BrowseScreenshotsPayload } from "@/lib/api"
import { useAppStore } from "@/store"
import { StarRating } from "@/components/StarRating"
import { cn } from "@/lib/cn"
import { getScreenshotMediaSrc, getScreenshotPosterSrc } from "@/lib/media"

// ── Helpers ──────────────────────────────────────────────────────────────────

function isVideo(src: string) {
  return /\.(mp4|webm|mov)$/i.test(src)
}

function sourceLabel(s: string) {
  return s === "ddg" ? "DDG" : s === "redgifs" ? "Redgifs" : s === "x" ? "X" : s
}

function parseUserTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : []
  } catch { return [] }
}

const FAVORITES_KEY = "screenshot-favorites"

function loadFavorites(): Set<number> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    return new Set((raw ? JSON.parse(raw) : []).filter((v: unknown): v is number => typeof v === "number"))
  } catch { return new Set() }
}

function saveFavorites(s: Set<number>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...s]))
}

// ── Icons ────────────────────────────────────────────────────────────────────

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

function PlayPauseFlash({ state }: { state: "play" | "pause" | null }) {
  if (!state) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center animate-feed-flash">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
        {state === "play" ? (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="white"><polygon points="6 3 20 12 6 21 6 3" /></svg>
        ) : (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
            <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        )}
      </div>
    </div>
  )
}

function MuteFlash({ muted }: { muted: boolean }) {
  return (
    <div className="pointer-events-none absolute left-4 top-1/2 z-30 -translate-y-1/2 animate-feed-flash">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth={1.5}>
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          {muted ? (
            <>
              <line x1="23" y1="9" x2="17" y2="15" stroke="white" strokeWidth={2} />
              <line x1="17" y1="9" x2="23" y2="15" stroke="white" strokeWidth={2} />
            </>
          ) : (
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" fill="none" stroke="white" strokeWidth={2} />
          )}
        </svg>
      </div>
    </div>
  )
}

function HeartBurst() {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
      <div className="animate-feed-heart-burst text-red-500">
        <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </div>
    </div>
  )
}

// ── Single Video Slide ───────────────────────────────────────────────────────

interface VideoSlideProps {
  shot: Screenshot
  isActive: boolean
  favorites: Set<number>
  onToggleFavorite: (id: number) => void
  onRate: (id: number, rating: number) => void
  onDescribe: (id: number) => void
  onDismiss: (id: number) => void
  describingIds: Set<number>
  onAddToPlaylist: (id: number) => void
}

function VideoSlide({
  shot,
  isActive,
  favorites,
  onToggleFavorite,
  onRate,
  onDescribe,
  onDismiss,
  describingIds,
  onAddToPlaylist,
}: VideoSlideProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const slideRef = useRef<HTMLDivElement>(null)
  const [, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [flashState, setFlashState] = useState<"play" | "pause" | null>(null)
  const [muteFlash, setMuteFlash] = useState(false)
  const [heartBurst, setHeartBurst] = useState(false)
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [progress, setProgress] = useState(0)
  const [swipeX, setSwipeX] = useState(0)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const lastTapRef = useRef(0)
  const lastTapSideRef = useRef<"left" | "right" | null>(null)
  const addToast = useAppStore((s) => s.addToast)

  const src = getScreenshotMediaSrc(shot)
  const posterSrc = getScreenshotPosterSrc(shot)
  const isFav = favorites.has(shot.id)
  const userTags = parseUserTags(shot.user_tags)
  const shouldLoadVideo = isActive
  const videoSrc = shouldLoadVideo ? src : undefined

  // Autoplay via IntersectionObserver
  useEffect(() => {
    const el = slideRef.current
    const v = videoRef.current
    if (!el || !v) return

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
          v.play().catch(() => {})
        } else {
          v.pause()
        }
      },
      { threshold: 0.5 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Sync playing state
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onTime = () => {
      if (v.duration > 0) setProgress(v.currentTime / v.duration)
    }
    v.addEventListener("play", onPlay)
    v.addEventListener("pause", onPause)
    v.addEventListener("timeupdate", onTime)
    v.addEventListener("loadedmetadata", onTime)
    return () => {
      v.removeEventListener("play", onPlay)
      v.removeEventListener("pause", onPause)
      v.removeEventListener("timeupdate", onTime)
      v.removeEventListener("loadedmetadata", onTime)
    }
  }, [])

  // Preload when active
  useEffect(() => {
    const v = videoRef.current
    if (v && isActive) {
      v.preload = "metadata"
    }
  }, [isActive])

  // Flash animation helper
  const flash = useCallback((setter: (v: boolean) => void) => {
    setter(true)
    setTimeout(() => setter(false), 600)
  }, [])

  // Tap center: play/pause
  const handleTap = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const third = rect.width / 3
    const now = Date.now()
    const timeSince = now - lastTapRef.current
    const side = x < third ? "left" : x > third * 2 ? "right" : null

    // Double-tap detection
    if (timeSince < 300 && side === "right" && lastTapSideRef.current === "right") {
      // Double tap right: favorite
      if (!isFav) {
        onToggleFavorite(shot.id)
        setHeartBurst(true)
        setTimeout(() => setHeartBurst(false), 800)
      }
      lastTapRef.current = 0
      lastTapSideRef.current = null
      return
    }

    lastTapRef.current = now
    lastTapSideRef.current = side

    // Single tap left: mute/unmute
    if (side === "left") {
      const v = videoRef.current
      if (v) {
        v.muted = !v.muted
        setMuted(v.muted)
        flash(setMuteFlash)
      }
      return
    }

    // Single tap center/right (after delay to rule out double-tap)
    if (side === null) {
      const v = videoRef.current
      if (!v) return
      if (v.paused) {
        v.play().catch(() => {})
        setFlashState("play")
      } else {
        v.pause()
        setFlashState("pause")
      }
      setTimeout(() => setFlashState(null), 500)
    }
  }, [isFav, onToggleFavorite, shot.id, flash])

  // Touch swipe to dismiss
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const dx = e.touches[0].clientX - touchStartRef.current.x
    const dy = Math.abs(e.touches[0].clientY - touchStartRef.current.y)
    // Only track horizontal swipes
    if (Math.abs(dx) > dy && Math.abs(dx) > 10) {
      setSwipeX(dx)
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (swipeX < -100) {
      onDismiss(shot.id)
    }
    setSwipeX(0)
    touchStartRef.current = null
  }, [swipeX, onDismiss, shot.id])

  const handleCopyUrl = useCallback(() => {
    const url = shot.page_url || shot.local_url || ""
    if (url) {
      navigator.clipboard.writeText(url).then(
        () => addToast("URL copied to clipboard", "success"),
        () => addToast("Failed to copy URL", "error"),
      )
    }
  }, [shot.page_url, shot.local_url, addToast])

  return (
    <div
      ref={slideRef}
      className="relative flex h-[calc(100vh-3.5rem)] w-full snap-start snap-always items-center justify-center bg-black"
      style={{
        transform: swipeX ? `translateX(${swipeX}px)` : undefined,
        opacity: swipeX ? 1 - Math.abs(swipeX) / 300 : 1,
        transition: swipeX ? "none" : "transform 0.3s, opacity 0.3s",
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        src={videoSrc}
        poster={posterSrc || undefined}
        loop
        muted={muted}
        playsInline
        preload={isActive ? "metadata" : "none"}
        className="h-full w-full cursor-pointer object-contain"
        onClick={handleTap}
      />

      {/* Play/Pause flash */}
      <PlayPauseFlash state={flashState} />

      {/* Mute flash */}
      {muteFlash && <MuteFlash muted={muted} />}

      {/* Heart burst on double-tap */}
      {heartBurst && <HeartBurst />}

      {/* Right side action bar */}
      <div className="absolute right-3 bottom-32 z-20 flex flex-col items-center gap-5">
        {/* Favorite */}
        <button
          onClick={() => onToggleFavorite(shot.id)}
          className="flex flex-col items-center gap-1"
        >
          <div className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full transition-all",
            isFav ? "text-red-500 scale-110" : "text-white/80 hover:text-white",
          )}>
            <HeartIcon filled={isFav} />
          </div>
          <span className="text-[10px] text-white/70">{isFav ? "Liked" : "Like"}</span>
        </button>

        {/* Star rating (compact vertical) */}
        <div className="flex flex-col items-center gap-1">
          <StarRating
            value={shot.rating ?? 0}
            onChange={(r) => onRate(shot.id, r)}
            compact
            className="flex-col"
          />
          <span className="text-[10px] text-white/70">Rate</span>
        </div>

        {/* AI describe */}
        <button
          onClick={() => onDescribe(shot.id)}
          disabled={describingIds.has(shot.id)}
          className="flex flex-col items-center gap-1"
        >
          <div className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition-colors hover:text-white",
            describingIds.has(shot.id) && "animate-pulse text-purple-400",
          )}>
            <SparkleIcon />
          </div>
          <span className="text-[10px] text-white/70">Describe</span>
        </button>

        {/* Share / Copy URL */}
        <button
          onClick={handleCopyUrl}
          className="flex flex-col items-center gap-1"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition-colors hover:text-white">
            <ShareIcon />
          </div>
          <span className="text-[10px] text-white/70">Share</span>
        </button>

        {/* Playlist add */}
        <button
          onClick={() => onAddToPlaylist(shot.id)}
          className="flex flex-col items-center gap-1"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition-colors hover:text-white">
            <PlusIcon />
          </div>
          <span className="text-[10px] text-white/70">Playlist</span>
        </button>

        {/* Source link */}
        {shot.page_url && (
          <a
            href={shot.page_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition-colors hover:text-white">
              <ExternalLinkIcon />
            </div>
            <span className="text-[10px] text-white/70">Source</span>
          </a>
        )}
      </div>

      {/* Bottom overlay */}
      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-4 pt-16">
        {/* Term title */}
        <h3 className="text-lg font-semibold text-white drop-shadow-lg">
          {shot.term}
        </h3>

        {/* Source badge */}
        <span className="mt-1 inline-block rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white/80 backdrop-blur-sm">
          {sourceLabel(shot.source)}
        </span>

        {/* AI summary */}
        {shot.ai_summary && (
          <button
            onClick={() => setSummaryExpanded(!summaryExpanded)}
            className="mt-2 block w-full text-left"
          >
            <p className={cn(
              "text-sm text-white/70 transition-all",
              summaryExpanded ? "" : "line-clamp-2",
            )}>
              {shot.ai_summary}
            </p>
          </button>
        )}

        {/* User tags */}
        {userTags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {userTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-blue-500/25 px-2 py-0.5 text-[10px] text-blue-300 backdrop-blur-sm"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Performer name */}
        {shot.performer_id && (
          <p className="mt-1.5 text-xs text-purple-300/80">
            Linked performer #{shot.performer_id}
          </p>
        )}
      </div>

      {/* Progress bar at bottom */}
      <div className="absolute inset-x-0 bottom-0 z-30 h-0.5">
        <div
          className="h-full bg-[var(--color-accent,#6366f1)] transition-all duration-200"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Muted indicator in top-left */}
      {muted && !muteFlash && (
        <div className="absolute left-3 top-3 z-20 flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-[10px] text-white/60 backdrop-blur-sm">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth={2.5} />
            <line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" strokeWidth={2.5} />
          </svg>
          Muted
        </div>
      )}
    </div>
  )
}

// ── Main Feed Component ──────────────────────────────────────────────────────

interface VideoFeedProps {
  onExit: () => void
  term?: string | null
  source?: string | null
}

export function VideoFeed({ onExit, term, source }: VideoFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [favorites, setFavorites] = useState<Set<number>>(() => loadFavorites())
  const [describingIds, setDescribingIds] = useState<Set<number>>(new Set())
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set())
  const addToast = useAppStore((s) => s.addToast)
  const qc = useQueryClient()

  // Fetch videos via infinite query
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ["video-feed", term, source],
    queryFn: ({ pageParam = 0 }) =>
      api.browseScreenshots({
        offset: pageParam as number,
        limit: 12,
        media_type: "video",
        ...(term ? { term } : {}),
        ...(source ? { source } : {}),
      }),
    getNextPageParam: (last: BrowseScreenshotsPayload) =>
      last.has_more ? (last.next_offset ?? (last.offset + last.screenshots.length)) : undefined,
    initialPageParam: 0,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    maxPages: 3,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })

  const videos = useMemo(() => {
    if (!data?.pages) return []
    return data.pages
      .flatMap((p) => p.screenshots)
      .filter((s) => !dismissedIds.has(s.id))
  }, [data?.pages, dismissedIds])

  // Track active index for preloading
  const [activeIndex, setActiveIndex] = useState(0)

  // IntersectionObserver to track current slide
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const slides = container.querySelectorAll("[data-video-slide]")
    if (!slides.length) return

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            const idx = Number(entry.target.getAttribute("data-video-slide"))
            if (!isNaN(idx)) setActiveIndex(idx)
          }
        }
      },
      { root: container, threshold: 0.5 },
    )

    slides.forEach((s) => obs.observe(s))
    return () => obs.disconnect()
  }, [videos.length])

  // Load more when near end
  useEffect(() => {
    if (activeIndex >= videos.length - 3 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [activeIndex, videos.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  // Keyboard nav
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const container = containerRef.current
      if (!container) return

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault()
        const slides = container.querySelectorAll("[data-video-slide]")
        const next = Math.min(activeIndex + 1, slides.length - 1)
        slides[next]?.scrollIntoView({ behavior: "smooth" })
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault()
        const slides = container.querySelectorAll("[data-video-slide]")
        const prev = Math.max(activeIndex - 1, 0)
        slides[prev]?.scrollIntoView({ behavior: "smooth" })
      } else if (e.key === "Escape") {
        onExit()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [activeIndex, onExit])

  // Toggle favorite
  const handleToggleFavorite = useCallback((id: number) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveFavorites(next)
      return next
    })
  }, [])

  // Rate
  const rateMutation = useMutation({
    mutationFn: ({ id, rating }: { id: number; rating: number }) =>
      api.rateScreenshot(id, rating),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["video-feed"] })
      qc.invalidateQueries({ queryKey: ["screenshots"] })
      qc.invalidateQueries({ queryKey: ["media-stats"] })
    },
  })

  const handleRate = useCallback((id: number, rating: number) => {
    rateMutation.mutate({ id, rating })
  }, [rateMutation])

  // AI Describe
  const handleDescribe = useCallback(async (id: number) => {
    setDescribingIds((prev) => new Set(prev).add(id))
    try {
      const result = await api.summarizeScreenshot(id)
      if (result.summary) {
        addToast("Description generated", "success")
        qc.invalidateQueries({ queryKey: ["video-feed"] })
        qc.invalidateQueries({ queryKey: ["screenshots"] })
        qc.invalidateQueries({ queryKey: ["media-stats"] })
      } else if (result.refused) {
        addToast("AI refused to describe this content", "info")
      }
    } catch {
      addToast("Failed to describe", "error")
    }
    setDescribingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [addToast, qc])

  // Dismiss (swipe left)
  const handleDismiss = useCallback((id: number) => {
    setDismissedIds((prev) => new Set(prev).add(id))
  }, [])

  // Add to playlist (simple toast for now, could open modal)
  const handleAddToPlaylist = useCallback((id: number) => {
    addToast(`Screenshot #${id} ready to add to playlist`, "info")
  }, [addToast])

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center bg-black">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
          <p className="text-sm text-white/50">Loading videos...</p>
        </div>
      </div>
    )
  }

  if (videos.length === 0) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] flex-col items-center justify-center bg-black gap-4">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.5} className="opacity-30">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <polyline points="8 21 16 21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <p className="text-sm text-white/40">No videos found</p>
        <button
          onClick={onExit}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/15"
        >
          Back to gallery
        </button>
      </div>
    )
  }

  return (
    <div className="relative h-[calc(100vh-3.5rem)] bg-black">
      {/* Exit button */}
      <button
        onClick={onExit}
        className="absolute left-3 top-3 z-40 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-sm text-white/70 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
        </svg>
        Back
      </button>

      {/* Video count indicator */}
      <div className="absolute right-3 top-3 z-40 rounded-full bg-black/40 px-3 py-1 text-xs text-white/50 backdrop-blur-sm">
        {activeIndex + 1} / {videos.length}
      </div>

      {/* Scrollable feed */}
      <div
        ref={containerRef}
        className="h-full w-full overflow-y-scroll snap-y snap-mandatory scrollbar-none"
        style={{ scrollBehavior: "smooth" }}
      >
        {videos.map((shot, idx) => (
          <div key={shot.id} data-video-slide={idx}>
            <VideoSlide
              shot={shot}
              isActive={idx === activeIndex || idx === activeIndex + 1}
              favorites={favorites}
              onToggleFavorite={handleToggleFavorite}
              onRate={handleRate}
              onDescribe={handleDescribe}
              onDismiss={handleDismiss}
              describingIds={describingIds}
              onAddToPlaylist={handleAddToPlaylist}
            />
          </div>
        ))}

        {/* Load more sentinel */}
        {isFetchingNextPage && (
          <div className="flex h-20 items-center justify-center bg-black">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
          </div>
        )}
      </div>
    </div>
  )
}
