import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Camera,
  Check,
  ExternalLink,
  FolderPlus,
  LoaderCircle,
  Play,
  Share2,
  ThumbsDown,
  ThumbsUp,
  UserPlus,
  X,
} from 'lucide-react'
import { apiUrl, resolveMediaAssetUrl, resolvePublicUrl } from '@/lib/backendOrigin'
import { creatorFollowId, formatMetric, relativeTime } from '@/lib/discovery'
import { loadProgress, recordProgress } from '@/lib/collections'
import { playbackIntent } from '@/lib/intent'
import { orderPlaybackCandidates } from '@/lib/playback'
import { useCollections } from '@/hooks/useCollections'
import type { MediaItem } from '@/lib/types'
import { useAppStore } from '@/store'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import MediaImage from '@/components/MediaImage'
import { cn } from '@/lib/utils'

const easeOut = [0.16, 1, 0.3, 1] as [number, number, number, number]

function prefersMobilePlayback(): boolean {
  if (typeof window === 'undefined') return false
  const compactOrTouch = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string }
  }).connection
  return compactOrTouch || connection?.saveData === true || ['slow-2g', '2g', '3g'].includes(connection?.effectiveType || '')
}

/**
 * Extract the numeric screenshot id from legacy archived-media identifiers:
 * plain numeric strings or `shot-123` / `screenshot-123`. Returns null for
 * modern public-source ids such as `rg-...` or `x-...`, which should exhaust
 * their provider candidates and then fall back to the source page instead of
 * hitting the archived-media resolve-stream endpoint.
 */
function legacyScreenshotId(id: string): string | null {
  const value = id.trim()
  if (/^\d+$/.test(value)) return value
  return value.match(/^(?:shot|screenshot)-(\d+)$/)?.[1] || null
}

function VideoPlayer({ item }: { item: MediaItem }) {
  const autoplay = useAppStore((state) => state.autoplayVideos)
  const muteOnStart = useAppStore((state) => state.muteOnStart)
  const pictureInPicture = useAppStore((state) => state.pictureInPicture)
  const quality = useAppStore((state) => state.defaultQuality)
  const addToast = useAppStore((state) => state.addToast)

  const videoRef = useRef<HTMLVideoElement>(null)
  const watchdogRef = useRef<number | null>(null)
  const frameCallbackRef = useRef<number | null>(null)
  const recoveringRef = useRef(false)

  const initialCandidates = useMemo(() => {
    const supplied = item.streamCandidates?.length ? item.streamCandidates : item.mediaUrl ? [item.mediaUrl] : []
    const normalized = supplied
      .map(resolveMediaAssetUrl)
      .filter((url): url is string => Boolean(url))
      .filter((url, position, list) => list.indexOf(url) === position)
    return orderPlaybackCandidates(normalized, quality, quality === 'auto' && prefersMobilePlayback())
  }, [item.mediaUrl, item.streamCandidates, quality])

  const [candidates, setCandidates] = useState(initialCandidates)
  const [index, setIndex] = useState(0)
  const [recovering, setRecovering] = useState(false)
  const [failed, setFailed] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [paused, setPaused] = useState(true)
  const [buffering, setBuffering] = useState(false)
  const [frameReady, setFrameReady] = useState(false)

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current)
      watchdogRef.current = null
    }
  }, [])

  const clearFrameCallback = useCallback(() => {
    const node = videoRef.current
    if (frameCallbackRef.current !== null && node?.cancelVideoFrameCallback) {
      node.cancelVideoFrameCallback(frameCallbackRef.current)
    }
    frameCallbackRef.current = null
  }, [])

  const recover = useCallback(async () => {
    clearWatchdog()
    clearFrameCallback()
    setFrameReady(false)
    setBuffering(false)
    setPaused(true)
    if (index + 1 < candidates.length) {
      setIndex((value) => value + 1)
      return
    }
    const shotId = legacyScreenshotId(item.id)
    if (!shotId) {
      setFailed(true)
      return
    }
    if (recoveringRef.current) return
    recoveringRef.current = true
    setRecovering(true)
    try {
      const response = await fetch(apiUrl(`/api/screenshots/${shotId}/resolve-stream`), { method: 'POST' })
      if (!response.ok) throw new Error('No alternate stream')
      const data = (await response.json()) as { cached_url?: string; local_url?: string; direct_url?: string }
      const alternatives = [data.cached_url, data.local_url, data.direct_url].map(resolvePublicUrl).filter((url): url is string => Boolean(url))
      if (!alternatives.length) throw new Error('No alternate stream')
      setFailed(false)
      setCandidates(alternatives)
      setIndex(0)
    } catch {
      setFailed(true)
    } finally {
      recoveringRef.current = false
      setRecovering(false)
    }
  }, [candidates.length, clearFrameCallback, clearWatchdog, index, item.id])

  const armWatchdog = useCallback((timeoutMs: number) => {
    clearWatchdog()
    watchdogRef.current = window.setTimeout(() => {
      void recover()
    }, timeoutMs)
  }, [clearWatchdog, recover])

  useEffect(() => {
    recoveringRef.current = false
    setCandidates(initialCandidates)
    setIndex(0)
    setFailed(false)
    setRecovering(false)
    setPaused(true)
    setBuffering(false)
    setFrameReady(false)
  }, [initialCandidates])

  useEffect(() => () => {
    clearWatchdog()
    clearFrameCallback()
  }, [clearFrameCallback, clearWatchdog])

  useEffect(() => {
    if (failed || !candidates[index]) return undefined
    const node = videoRef.current
    clearFrameCallback()
    setFrameReady(false)
    setBuffering(true)
    setPaused(true)
    armWatchdog(12000)
    node?.load()
    // Opening the sheet is an explicit play intent. The autoPlay attribute can
    // race candidate swaps on some browsers, so attempt playback directly too;
    // a rejection (e.g. unmuted autoplay policy) just leaves the paused
    // click-to-play overlay visible.
    if (autoplay) void node?.play().catch(() => {})
    return () => {
      clearWatchdog()
      clearFrameCallback()
    }
  }, [armWatchdog, autoplay, candidates, clearFrameCallback, clearWatchdog, failed, index])

  const handleUsable = useCallback(() => {
    setFailed(false)
  }, [])

  const handlePlaying = useCallback(() => {
    setFailed(false)
    setPaused(false)
    setBuffering(false)
    const node = videoRef.current
    if (node?.requestVideoFrameCallback) {
      clearFrameCallback()
      armWatchdog(7000)
      frameCallbackRef.current = node.requestVideoFrameCallback(() => {
        frameCallbackRef.current = null
        setFrameReady(true)
        clearWatchdog()
      })
      return
    }
    setFrameReady(true)
    clearWatchdog()
  }, [armWatchdog, clearFrameCallback, clearWatchdog])

  const handleBuffering = useCallback(() => {
    setBuffering(true)
    armWatchdog(9000)
  }, [armWatchdog])

  // Private continue-watching: save position at most every 5s, plus on pause.
  const lastSavedRef = useRef(0)
  const saveProgress = useCallback(() => {
    const node = videoRef.current
    if (!node || node.currentTime < 1) return
    const now = Date.now()
    if (now - lastSavedRef.current < 5000) return
    lastSavedRef.current = now
    recordProgress(item, node.currentTime)
  }, [item])
  const saveProgressNow = useCallback(() => {
    const node = videoRef.current
    if (!node || node.currentTime < 1) return
    lastSavedRef.current = Date.now()
    recordProgress(item, node.currentTime)
  }, [item])

  // Resume-from-position: seek once per item when a saved position exists.
  const resumedRef = useRef(false)
  const [resumedAt, setResumedAt] = useState<number | null>(null)
  const handleLoadedMetadata = useCallback(() => {
    const node = videoRef.current
    if (!node || resumedRef.current) return
    resumedRef.current = true
    const entry = loadProgress()[item.id]
    if (entry && entry.seconds > 20 && entry.seconds < entry.duration * 0.92) {
      node.currentTime = entry.seconds
      setResumedAt(entry.seconds)
    }
  }, [item.id])

  const handleTimeUpdate = useCallback(() => {
    const node = videoRef.current
    if (node && node.currentTime > 0 && !frameReady) {
      setFrameReady(true)
      setBuffering(false)
      clearWatchdog()
    }
    saveProgress()
  }, [clearWatchdog, frameReady, saveProgress])

  // Click-to-play UX: keep the poster until the browser paints a real frame.
  const requestPlay = useCallback(async (recoverOnFailure: boolean) => {
    const node = videoRef.current
    if (!node) return
    try {
      await node.play()
    } catch (error) {
      // Autoplay policy rejections are resolved by the user's next tap. Codec,
      // transport, and provider failures should immediately try the next source
      // instead of silently leaving a poster over a stalled player.
      const name = error instanceof DOMException ? error.name : ''
      if (recoverOnFailure && name !== 'NotAllowedError' && name !== 'AbortError') {
        await recover()
      }
    }
  }, [recover])
  const togglePlay = useCallback(() => {
    const node = videoRef.current
    if (!node) return
    if (node.paused) void requestPlay(true)
    else node.pause()
  }, [requestPlay])
  const handlePauseEvent = useCallback(() => {
    setPaused(true)
    setBuffering(false)
    saveProgressNow()
  }, [saveProgressNow])

  const captureFrame = useCallback(async () => {
    const node = videoRef.current
    if (!node || !node.videoWidth || !node.videoHeight) {
      addToast({ type: 'info', title: 'Frame is not ready yet', message: 'Let the video start rendering, then capture again.' })
      return
    }
    setCapturing(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = node.videoWidth
      canvas.height = node.videoHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas_unavailable')
      context.drawImage(node, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('capture_failed')
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `media-codex-${item.id}-${Math.max(0, Math.floor(node.currentTime))}s.png`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1500)
      addToast({
        type: 'success',
        title: 'Frame saved locally',
        message: 'Only keep captures you have rights or permission to store.',
      })
    } catch {
      addToast({
        type: 'error',
        title: 'Frame could not be captured',
        message: 'Try again after playback starts, or save it from the original source if permitted.',
      })
    } finally {
      setCapturing(false)
    }
  }, [addToast, item.id])

  if (!candidates[index] || failed) {
    const externalOnly = candidates.length === 0 && !failed
    return (
      <div className="relative grid min-h-64 place-items-center overflow-hidden rounded-lg bg-sunken">
        <MediaImage
          sources={[item.thumbnail]}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-20"
          skeletonClassName="absolute inset-0"
          loading="eager"
        />
        <div className="relative z-10 max-w-xs px-5 py-10 text-center">
          <Play size={16} strokeWidth={1.75} className="mx-auto text-ink-2" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-ink">
            {externalOnly ? 'Open this item on its source to play.' : 'This stream is temporarily unavailable.'}
          </p>
          {item.pageUrl && (
            <a href={item.pageUrl} target="_blank" rel="noreferrer" className="btn-primary mt-4">
              Watch on source <ExternalLink size={14} strokeWidth={1.75} />
            </a>
          )}
        </div>
      </div>
    )
  }

  const currentUrl = candidates[index]
  return (
    <div className="relative -mx-3 overflow-hidden bg-black sm:mx-0 sm:rounded-lg">
      <video
        key={currentUrl}
        ref={videoRef}
        src={currentUrl}
        poster={item.thumbnail}
        controls
        playsInline
        // Full preload is a desktop luxury: on cellular it burns data for
        // every opened sheet. Metadata is enough to show the first frame.
        preload={autoplay ? 'auto' : 'metadata'}
        autoPlay={autoplay}
        muted={muteOnStart}
        disablePictureInPicture={!pictureInPicture}
        onLoadedData={handleUsable}
        onCanPlay={handleUsable}
        onPlaying={handlePlaying}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={handleBuffering}
        onStalled={handleBuffering}
        onTimeUpdate={handleTimeUpdate}
        onPause={handlePauseEvent}
        onEnded={handlePauseEvent}
        onClick={togglePlay}
        onError={recover}
        className="aspect-video max-h-[52dvh] min-h-0 w-full object-contain landscape:max-h-[72dvh] sm:min-h-56 md:max-h-[62dvh]"
      >
        Your browser does not support video playback.
      </video>
      {!frameReady && (
        <MediaImage
          sources={[item.thumbnail]}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full bg-black object-contain"
          skeletonClassName="pointer-events-none absolute inset-0"
          loading="eager"
        />
      )}
      {paused && (
        <button
          type="button"
          onClick={togglePlay}
          className="absolute inset-0 grid place-items-center bg-black/20"
          aria-label="Play video"
        >
          <span className="grid h-14 w-14 place-items-center rounded-full bg-canvas/85">
            <Play size={22} strokeWidth={1.75} className="ml-1 text-ink" fill="currentColor" />
          </span>
        </button>
      )}
      {buffering && !paused && (
        <div
          className="pointer-events-none absolute inset-0 grid place-items-center bg-black/15"
          role="status"
          aria-label="Loading video"
        >
          <span className="inline-flex min-h-10 items-center gap-2 rounded-full bg-canvas/90 px-3 text-xs font-medium text-ink">
            <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
            Loading video
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={captureFrame}
        disabled={capturing || !frameReady}
        className="absolute right-3 top-3 inline-flex min-h-9 items-center gap-1.5 rounded-sm bg-canvas/85 px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink transition-colors hover:bg-canvas disabled:opacity-60"
        aria-label="Capture current video frame"
      >
        <Camera size={13} strokeWidth={1.75} aria-hidden="true" />
        <span className="hidden sm:inline">{capturing ? 'Saving' : 'Capture'}</span>
      </button>
      {(recovering || index > 0) && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-sm bg-canvas/85 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink">
          {recovering ? 'Finding another stream' : `Fallback ${index + 1} connected`}
        </div>
      )}
      {resumedAt !== null && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-sm bg-canvas/85 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink">
          Resumed at {Math.floor(resumedAt / 60)}:{String(Math.floor(resumedAt % 60)).padStart(2, '0')}
        </div>
      )}
    </div>
  )
}

interface MediaDetailProps {
  item: MediaItem | null
  open: boolean
  onClose: () => void
  onShare?: () => void
  /** Sibling items enabling ←/→ navigation and the related rail. */
  items?: MediaItem[]
  onNavigate?: (item: MediaItem) => void
}

export default function MediaDetail({ item, open, onClose, onShare, items, onNavigate }: MediaDetailProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const viewedRef = useRef<string | null>(null)
  const likeCache = useAppStore((state) => state.likeCache)
  const toggleLike = useAppStore((state) => state.toggleLike)
  const followCache = useAppStore((state) => state.followCache)
  const toggleFollow = useAppStore((state) => state.toggleFollow)
  const addRecentlyViewed = useAppStore((state) => state.addRecentlyViewed)
  const recordFeedback = useAppStore((state) => state.recordDiscoveryFeedback)
  const addToast = useAppStore((state) => state.addToast)
  const { collections, create: createCollection, addItem, removeItem } = useCollections()
  const [collectOpen, setCollectOpen] = useState(false)
  const [collectDraft, setCollectDraft] = useState('')

  const followId = item ? creatorFollowId(item.creator) : ''
  const liked = item ? Boolean(likeCache[item.id] ?? item.isLiked) : false
  const followed = Boolean(followId && followCache[followId])

  const itemIndex = useMemo(() => (items && item ? items.findIndex((entry) => entry.id === item.id) : -1), [items, item])
  const canGoBack = itemIndex > 0
  const canGoForward = items ? itemIndex >= 0 && itemIndex < items.length - 1 : false

  const related = useMemo(() => {
    if (!items || !item) return []
    const sameCreator = items.filter((entry) => entry.id !== item.id && entry.creator === item.creator)
    const sameTag = items.filter(
      (entry) => entry.id !== item.id && entry.creator !== item.creator && entry.tags.some((tag) => item.tags.includes(tag))
    )
    return [...sameCreator, ...sameTag].slice(0, 8)
  }, [items, item])

  const navigateBy = useCallback(
    (delta: number) => {
      if (!items || !onNavigate || itemIndex < 0) return
      const next = items[itemIndex + delta]
      if (next) onNavigate(next)
    },
    [items, itemIndex, onNavigate]
  )

  const share = useCallback(async () => {
    if (!item) return
    if (onShare) return onShare()
    const url = item.pageUrl || window.location.href
    if (navigator.share) {
      try {
        await navigator.share({ title: item.title, url })
      } catch {
        // user dismissed the share sheet
      }
    } else {
      await navigator.clipboard.writeText(url)
      addToast({ type: 'success', title: 'Source link copied' })
    }
  }, [addToast, item, onShare])

  const save = useCallback(() => {
    if (!item) return
    const next = !liked
    toggleLike(item.id)
    addToast({ type: next ? 'success' : 'info', title: next ? 'Saved to your archive' : 'Removed from saved' })
  }, [addToast, item, liked, toggleLike])

  const follow = useCallback(() => {
    if (!item || !followId) return
    const next = !followed
    toggleFollow(followId)
    addToast({
      type: next ? 'success' : 'info',
      title: next ? `Following @${item.creator}` : `Unfollowed @${item.creator}`,
      message: next ? 'Follows shape your For You mix on this device.' : undefined,
    })
  }, [addToast, followed, followId, item, toggleFollow])

  const feedback = useCallback(
    (signal: 'more' | 'less') => {
      if (!item) return
      recordFeedback(item, signal)
      addToast({
        type: 'info',
        title: signal === 'more' ? 'Your mix learned from this' : 'Your mix will show less like this',
        message: 'Saved privately on this device.',
      })
    },
    [addToast, item, recordFeedback]
  )

  // Record a view once per opened item. Opening detail also cancels any queued
  // hover-warm fetches so the real poster/stream gets the full bandwidth budget.
  useEffect(() => {
    if (!open || !item || viewedRef.current === item.id) return
    viewedRef.current = item.id
    playbackIntent.cancelAll()
    addRecentlyViewed(item.id)
    recordFeedback(item, 'view')
  }, [addRecentlyViewed, item, open, recordFeedback])

  // Scroll lock
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // Keyboard: Esc close · ←/→ or J/K navigate · F follow · S save
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'VIDEO' || target.isContentEditable) return
      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          onClose()
          break
        case 'ArrowLeft':
          event.preventDefault()
          navigateBy(-1)
          break
        case 'ArrowRight':
          event.preventDefault()
          navigateBy(1)
          break
        case 'j':
        case 'J':
          navigateBy(1)
          break
        case 'k':
        case 'K':
          navigateBy(-1)
          break
        case 'f':
        case 'F':
          follow()
          break
        case 's':
        case 'S':
          save()
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [follow, navigateBy, onClose, open, save])

  useFocusTrap(panelRef, open)

  // Portal to <body>: pages use transform-based enter animations, and any
  // transformed ancestor becomes the containing block for position:fixed —
  // on phones that pins the sheet to the page content instead of the screen.
  return createPortal(
    <AnimatePresence>
      {open && item && (
        <div className="fixed inset-0 z-[200] flex items-end justify-end md:items-stretch">
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 h-full w-full bg-scrim"
            aria-label="Close media details"
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="media-title"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.25, ease: easeOut }}
            className="relative z-10 flex h-dvh w-full flex-col overflow-hidden border-line bg-elevated shadow-overlay outline-none md:h-full md:max-w-[480px] md:border-l"
          >
            {/* Sheet header */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-4 sm:pt-3">
              <span className="mono-meta uppercase">Public source · {item.source}</span>
              <div className="flex items-center gap-1">
                {items && onNavigate && (
                  <>
                    <button
                      onClick={() => navigateBy(-1)}
                      disabled={!canGoBack}
                      className="grid h-10 w-10 place-items-center rounded-md text-ink-2 hover:bg-sunken disabled:opacity-30"
                      aria-label="Previous item"
                    >
                      <ArrowLeft size={16} strokeWidth={1.75} />
                    </button>
                    <button
                      onClick={() => navigateBy(1)}
                      disabled={!canGoForward}
                      className="grid h-10 w-10 place-items-center rounded-md text-ink-2 hover:bg-sunken disabled:opacity-30"
                      aria-label="Next item"
                    >
                      <ArrowRight size={16} strokeWidth={1.75} />
                    </button>
                  </>
                )}
                <button
                  onClick={onClose}
                  className="grid h-10 w-10 place-items-center rounded-md text-ink-2 hover:bg-sunken"
                  aria-label="Close"
                >
                  <X size={16} strokeWidth={1.75} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pt-4">
              {item.isVideo ? (
                <VideoPlayer key={item.id} item={item} />
              ) : (
                <div className="relative">
                  <MediaImage
                    sources={[item.mediaUrl, item.thumbnail]}
                    alt={item.title}
                    loading="eager"
                    className="max-h-[62dvh] w-full rounded-lg object-contain bg-sunken transition-opacity duration-200"
                    skeletonClassName="min-h-56 w-full rounded-lg"
                  />
                </div>
              )}

              <h2 id="media-title" className="mt-5 text-lg font-semibold leading-tight tracking-[-0.01em] text-ink">
                {item.title}
              </h2>

              {/* Creator row */}
              <div className="mt-4 flex items-center gap-3 border-b border-line pb-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-sunken font-mono text-sm text-ink-2" aria-hidden="true">
                  {item.creator.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">@{item.creator}</p>
                  <p className="mono-meta mt-0.5 uppercase">Observed on {item.source}</p>
                </div>
                <button
                  onClick={follow}
                  className={cn(
                    'inline-flex min-h-10 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-semibold transition-colors',
                    followed ? 'bg-sunken text-ink' : 'bg-heat text-canvas hover:bg-heat-hover'
                  )}
                  aria-pressed={followed}
                >
                  <UserPlus size={14} strokeWidth={1.75} aria-hidden="true" />
                  {followed ? 'Following' : 'Follow'}
                </button>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 items-center gap-2 border-b border-line py-3 sm:flex sm:flex-wrap">
                {item.pageUrl && (
                  <a href={item.pageUrl} target="_blank" rel="noreferrer" className="btn-primary w-full sm:w-auto">
                    Watch on source <ExternalLink size={14} strokeWidth={1.75} />
                  </a>
                )}
                {!item.isVideo && item.mediaUrl && (
                  <a href={resolveMediaAssetUrl(item.mediaUrl)} target="_blank" rel="noreferrer" className="btn-secondary w-full sm:w-auto">
                    Full image <ExternalLink size={14} strokeWidth={1.75} />
                  </a>
                )}
                <button onClick={save} className="btn-secondary w-full sm:w-auto" aria-pressed={liked}>
                  <Bookmark size={14} strokeWidth={1.75} className={liked ? 'fill-current' : ''} aria-hidden="true" />
                  {liked ? 'Saved' : 'Save'}
                </button>
                <button onClick={share} className="btn-secondary w-full sm:w-auto">
                  <Share2 size={14} strokeWidth={1.75} aria-hidden="true" />
                  Share
                </button>
                <div className="relative col-span-2 sm:col-span-1">
                  <button
                    onClick={() => setCollectOpen((value) => !value)}
                    className="btn-secondary w-full sm:w-auto"
                    aria-expanded={collectOpen}
                    aria-haspopup="dialog"
                  >
                    <FolderPlus size={14} strokeWidth={1.75} aria-hidden="true" />
                    Collect
                  </button>
                  {collectOpen && (
                    <>
                      <button
                        className="fixed inset-0 z-10 cursor-default bg-transparent"
                        onClick={() => setCollectOpen(false)}
                        aria-label="Close collections panel"
                      />
                      <div className="absolute left-0 top-full z-20 mt-1.5 w-64 rounded-md border border-line bg-elevated p-2 shadow-overlay" role="dialog" aria-label="Collections">
                        {collections.length === 0 && (
                          <p className="px-1.5 py-2 text-[12px] text-ink-3">No collections yet — create one below.</p>
                        )}
                        <ul className="max-h-44 overflow-y-auto">
                          {collections.map((collection) => {
                            const member = collection.itemIds.includes(item.id)
                            return (
                              <li key={collection.id}>
                                <button
                                  onClick={() => (member ? removeItem(collection.id, item.id) : addItem(collection.id, item.id))}
                                  className="flex w-full items-center gap-2 rounded px-1.5 py-2 text-left text-[13px] text-ink hover:bg-sunken"
                                  aria-pressed={member}
                                >
                                  <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-sm border', member ? 'border-heat bg-heat text-canvas' : 'border-line-strong text-transparent')}>
                                    <Check size={11} strokeWidth={2.5} aria-hidden="true" />
                                  </span>
                                  <span className="min-w-0 flex-1 truncate">{collection.name}</span>
                                  <span className="font-mono text-[9px] text-ink-3">{collection.itemIds.length}</span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                        <div className="mt-1.5 flex items-center gap-1.5 border-t border-line pt-1.5">
                          <input
                            value={collectDraft}
                            onChange={(event) => setCollectDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && collectDraft.trim()) {
                                const created = createCollection(collectDraft)
                                addItem(created.id, item.id)
                                setCollectDraft('')
                              }
                            }}
                            placeholder="New collection"
                            aria-label="New collection name"
                            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
                          />
                          <button
                            onClick={() => {
                              if (!collectDraft.trim()) return
                              const created = createCollection(collectDraft)
                              addItem(created.id, item.id)
                              setCollectDraft('')
                            }}
                            disabled={!collectDraft.trim()}
                            className="btn-secondary min-h-8 px-2.5 text-xs"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Why this appeared */}
              <section className="border-b border-line py-4">
                <h3 className="eyebrow">Why this appeared</h3>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(item.recommendationReasons || item.curationReasons || ['Matches the current public feed']).map((reason) => (
                    <span key={reason} className="rounded-full border border-line px-2.5 py-1 font-mono text-[10px] tracking-[0.02em] text-ink-2">
                      {reason}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => feedback('more')} className="btn-secondary min-h-10 px-3 text-xs">
                    <ThumbsUp size={13} strokeWidth={1.75} aria-hidden="true" /> More like this
                  </button>
                  <button onClick={() => feedback('less')} className="btn-secondary min-h-10 px-3 text-xs">
                    <ThumbsDown size={13} strokeWidth={1.75} aria-hidden="true" /> Less like this
                  </button>
                </div>
              </section>

              {/* Mono metadata grid */}
              <dl className="grid grid-cols-3 gap-px border-b border-line py-4">
                {[
                  ['Source', item.source],
                  ['Posted', relativeTime(item.createdAt)],
                  ['Duration', item.isVideo ? item.duration || 'Video' : 'Photo'],
                  ['Views', formatMetric(item.views)],
                  ['Likes', formatMetric(item.likes)],
                  ['Signal', String(item.curationScore ?? '—')],
                ].map(([label, value]) => (
                  <div key={label} className="py-1.5">
                    <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">{label}</dt>
                    <dd className="mt-0.5 font-mono text-xs text-ink">{value}</dd>
                  </div>
                ))}
              </dl>

              {item.description && (
                <p className="mt-4 text-sm leading-6 text-ink-2">{item.description}</p>
              )}

              {item.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {item.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-sunken px-2.5 py-1 font-mono text-[10px] text-ink-2">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Related rail */}
              {related.length > 0 && onNavigate && (
                <section className="mt-6">
                  <h3 className="eyebrow">More like this</h3>
                  <div className="mt-3 flex gap-3 overflow-x-auto hide-scrollbar pb-1">
                    {related.map((entry) => (
                      <button
                        key={entry.id}
                        onClick={() => onNavigate(entry)}
                        className="w-28 shrink-0 text-left tap-highlight-none"
                        aria-label={`Open ${entry.title}`}
                      >
                        <span className="relative block aspect-[2/3] overflow-hidden rounded-md bg-sunken">
                          <MediaImage
                            sources={entry.isVideo ? [entry.thumbnail] : [entry.thumbnail, entry.mediaUrl]}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                            skeletonClassName="absolute inset-0"
                          />
                        </span>
                        <span className="mt-1.5 block truncate font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                          {entry.creator}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
