import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Camera,
  ExternalLink,
  Play,
  Share2,
  ThumbsDown,
  ThumbsUp,
  UserPlus,
  X,
} from 'lucide-react'
import { apiUrl, resolvePublicUrl } from '@/lib/backendOrigin'
import { creatorFollowId, formatMetric, relativeTime } from '@/lib/discovery'
import type { MediaItem } from '@/lib/types'
import type { VideoQuality } from '@/store'
import { useAppStore } from '@/store'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import MediaImage from '@/components/MediaImage'
import { cn } from '@/lib/utils'

const easeOut = [0.16, 1, 0.3, 1] as [number, number, number, number]

/**
 * Order stream candidates by the preferred quality. Provider URLs carry
 * resolution hints ('hd'/'1080' high, 'sd'/'720'/'mobile' low); when nothing
 * matches we keep the provider's own order.
 */
function preferQuality(candidates: string[], quality: VideoQuality): string[] {
  if (quality === 'auto' || candidates.length < 2) return candidates
  const tokens = quality === '1080p' ? ['1080', 'hd'] : ['720', 'sd', 'mobile']
  return candidates
    .map((url, index) => ({ url, index, match: tokens.some((t) => url.toLowerCase().includes(t)) ? 1 : 0 }))
    .sort((a, b) => b.match - a.match || a.index - b.index)
    .map((entry) => entry.url)
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

function isSameOriginMediaUrl(url: string): boolean {
  if (url.startsWith('/')) return true
  if (typeof window === 'undefined') return false
  return url.startsWith(window.location.origin)
}

function resolveProviderStreamUrl(url: string | null | undefined): string {
  if (!url) return ''
  // `/api/archiver-proxy` is a Vercel edge route owned by this SPA; resolving it
  // through the separate backend origin would turn a same-origin stream into a 404.
  if (url.startsWith('/api/archiver-proxy')) return url
  return resolvePublicUrl(url)
}

function VideoPlayer({ item }: { item: MediaItem }) {
  const autoplay = useAppStore((state) => state.autoplayVideos)
  const muteOnStart = useAppStore((state) => state.muteOnStart)
  const pictureInPicture = useAppStore((state) => state.pictureInPicture)
  const quality = useAppStore((state) => state.defaultQuality)
  const addToast = useAppStore((state) => state.addToast)

  const videoRef = useRef<HTMLVideoElement>(null)
  const watchdogRef = useRef<number | null>(null)
  const recoveringRef = useRef(false)

  const initialCandidates = useMemo(() => {
    const supplied = item.streamCandidates?.length ? item.streamCandidates : item.mediaUrl ? [item.mediaUrl] : []
    const normalized = supplied
      .map(resolveProviderStreamUrl)
      .filter((url): url is string => Boolean(url))
      .filter((url, position, list) => list.indexOf(url) === position)
    return preferQuality(normalized, quality)
  }, [item.mediaUrl, item.streamCandidates, quality])

  const [candidates, setCandidates] = useState(initialCandidates)
  const [index, setIndex] = useState(0)
  const [recovering, setRecovering] = useState(false)
  const [failed, setFailed] = useState(false)
  const [capturing, setCapturing] = useState(false)

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current)
      watchdogRef.current = null
    }
  }, [])

  const recover = useCallback(async () => {
    clearWatchdog()
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
  }, [candidates.length, clearWatchdog, index, item.id])

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
  }, [initialCandidates])

  useEffect(() => clearWatchdog, [clearWatchdog])

  useEffect(() => {
    if (failed || !candidates[index]) return undefined
    const node = videoRef.current
    armWatchdog(12000)
    node?.load()
    return clearWatchdog
  }, [armWatchdog, candidates, clearWatchdog, failed, index])

  const handleReady = useCallback(() => {
    clearWatchdog()
    setFailed(false)
  }, [clearWatchdog])

  const handleBuffering = useCallback(() => {
    armWatchdog(9000)
  }, [armWatchdog])

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
        title: 'Capture was blocked by the source',
        message: 'Try the proxied fallback stream, or open the source link and follow its terms.',
      })
    } finally {
      setCapturing(false)
    }
  }, [addToast, item.id])

  if (!candidates[index] || failed) {
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
          <p className="mt-3 text-sm font-medium text-ink">This stream is temporarily unavailable.</p>
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
  const sameOrigin = isSameOriginMediaUrl(currentUrl)

  return (
    <div className="relative overflow-hidden rounded-lg bg-black">
      <video
        key={currentUrl}
        ref={videoRef}
        src={currentUrl}
        poster={item.thumbnail}
        controls
        playsInline
        preload="metadata"
        autoPlay={autoplay}
        muted={muteOnStart}
        disablePictureInPicture={!pictureInPicture}
        crossOrigin={sameOrigin ? undefined : 'anonymous'}
        onLoadedData={handleReady}
        onCanPlay={handleReady}
        onPlaying={handleReady}
        onWaiting={handleBuffering}
        onStalled={handleBuffering}
        onError={recover}
        className="max-h-[62dvh] min-h-56 w-full object-contain"
      >
        Your browser does not support video playback.
      </video>
      <button
        type="button"
        onClick={captureFrame}
        disabled={capturing}
        className="absolute right-3 top-3 inline-flex min-h-9 items-center gap-1.5 rounded-sm bg-canvas/85 px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink transition-colors hover:bg-canvas disabled:opacity-60"
        aria-label="Capture current video frame"
      >
        <Camera size={13} strokeWidth={1.75} aria-hidden="true" />
        {capturing ? 'Saving' : 'Capture'}
      </button>
      {(recovering || index > 0) && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-sm bg-canvas/85 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink">
          {recovering ? 'Finding another stream' : `Fallback ${index + 1} connected`}
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

  // Record a view once per opened item
  useEffect(() => {
    if (!open || !item || viewedRef.current === item.id) return
    viewedRef.current = item.id
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

  return (
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
            className="relative z-10 flex h-[94dvh] w-full flex-col overflow-hidden border-l border-line bg-elevated shadow-overlay outline-none md:h-full md:max-w-[480px]"
          >
            {/* Sheet header */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
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

            <div className="flex-1 overflow-y-auto px-4 pb-10 pt-4 sm:px-5">
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
              <div className="flex flex-wrap items-center gap-2 border-b border-line py-3">
                {item.pageUrl && (
                  <a href={item.pageUrl} target="_blank" rel="noreferrer" className="btn-primary">
                    Watch on source <ExternalLink size={14} strokeWidth={1.75} />
                  </a>
                )}
                {!item.isVideo && item.mediaUrl && (
                  <a href={resolveProviderStreamUrl(item.mediaUrl)} target="_blank" rel="noreferrer" className="btn-secondary">
                    Full image <ExternalLink size={14} strokeWidth={1.75} />
                  </a>
                )}
                <button onClick={save} className="btn-secondary" aria-pressed={liked}>
                  <Bookmark size={14} strokeWidth={1.75} className={liked ? 'fill-current' : ''} aria-hidden="true" />
                  {liked ? 'Saved' : 'Save'}
                </button>
                <button onClick={share} className="btn-secondary">
                  <Share2 size={14} strokeWidth={1.75} aria-hidden="true" />
                  Share
                </button>
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
    </AnimatePresence>
  )
}
