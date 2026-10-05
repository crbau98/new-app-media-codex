import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ExternalLink,
  FolderPlus,
  ListPlus,
  ListStart,
  ListVideo,
  Plus,
  Share2,
  ThumbsDown,
  ThumbsUp,
  UserPlus,
  X,
} from 'lucide-react'
import { resolveMediaAssetUrl } from '@/lib/backendOrigin'
import { creatorFollowId, formatMetric, relativeTime } from '@/lib/discovery'
import { playbackIntent } from '@/lib/intent'
import { readMediaIntel } from '@/lib/player/intel'
import { useCollections } from '@/hooks/useCollections'
import type { MediaItem } from '@/lib/types'
import { useAppStore } from '@/store'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import MediaImage from '@/components/MediaImage'
import Tilt3D from '@/components/three/Tilt3D'
import PhotoViewer, { photoFrames } from '@/components/player/PhotoViewer'
import VideoPlayer from '@/components/player/VideoPlayer'
import { readNetwork, useMotionOk } from '@/components/player/hooks'
import { cn } from '@/lib/utils'
import { useQueue, useSurface } from '@/features/queue/hooks'
import { enqueueWithToast } from '@/features/queue/queueUi'
import { isUpcoming } from '@/features/queue/queueModel'
import { queueActions } from '@/features/queue/queueStore'
import { setStartIntent } from '@/features/queue/startIntent'
import { overlayOpen, surface } from '@/features/queue/surface'
import { usePlaybackFlow } from '@/features/queue/usePlaybackFlow'
import { writeRaw } from '@/features/queue/persist'
import MomentsPanel from '@/features/queue/MomentsPanel'
import QueueStatusCard from '@/features/queue/QueueStatusCard'
import CompletionRing from '@/features/queue/CompletionRing'

// The queue drawer and shortcut help are only fetched when first summoned.
const QueuePanel = lazy(() => import('@/features/queue/QueuePanel'))
const ShortcutHelp = lazy(() => import('@/features/queue/ShortcutHelp'))

const easeOut = [0.16, 1, 0.3, 1] as [number, number, number, number]
const THEATRE_KEY = 'media-codex-theatre-v1'

function readTheatre(): boolean {
  try {
    return localStorage.getItem(THEATRE_KEY) === '1'
  } catch {
    return false
  }
}

const DESKTOP_QUERY = '(min-width: 768px)'
function subscribeDesktop(callback: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
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

/** Blurred, slowly parallaxing poster behind the glass sheet. */
function VelvetBackdrop({ item, active }: { item: MediaItem; active: boolean }) {
  const intel = useMemo(() => readMediaIntel(item), [item])
  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const x = useSpring(useTransform(px, [-1, 1], [-18, 18]), { stiffness: 60, damping: 20 })
  const y = useSpring(useTransform(py, [-1, 1], [-12, 12]), { stiffness: 60, damping: 20 })

  useEffect(() => {
    if (!active) return undefined
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      px.set((event.clientX / window.innerWidth) * 2 - 1)
      py.set((event.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [active, px, py])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <motion.div className="absolute -inset-10" style={active ? { x, y } : undefined}>
        <MediaImage
          sources={[intel.posterUrl, item.thumbnail]}
          alt=""
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-3xl saturate-150"
          skeletonClassName="absolute inset-0"
          loading="eager"
          fetchPriority="low"
          dominantColor={intel.dominantColor}
          lqip={intel.lqip}
        />
      </motion.div>
      <div className="absolute inset-0 bg-gradient-to-b from-canvas/40 via-canvas/70 to-canvas/95" />
    </div>
  )
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
  const [theatre, setTheatre] = useState(readTheatre)
  const [frameState, setFrameState] = useState<{ itemId: string; index: number; direction: 1 | -1 }>({ itemId: '', index: 0, direction: 1 })
  const motionOk = useMotionOk()
  const isDesktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_QUERY).matches, () => true)

  const followId = item ? creatorFollowId(item.creator) : ''
  const liked = item ? Boolean(likeCache[item.id] ?? item.isLiked) : false
  const followed = Boolean(followId && followCache[followId])

  const intel = useMemo(() => (item ? readMediaIntel(item) : null), [item])
  const frameCount = item && !item.isVideo ? photoFrames(item).length : 0
  const frameIndex = item && frameState.itemId === item.id ? Math.min(frameState.index, Math.max(0, frameCount - 1)) : 0
  const frameDirection = frameState.direction

  const itemIndex = useMemo(() => (items && item ? items.findIndex((entry) => entry.id === item.id) : -1), [items, item])
  const queue = useQueue()
  const surf = useSurface()
  const overlay = open && (surf.panelOpen || surf.helpOpen)
  // Next/previous follow the queue when this item is the queue's current one, else the sibling list.
  const flow = usePlaybackFlow({ item, open, items, onNavigate })
  const { goNext, goPrev } = flow
  const canGoBack = flow.canPrev
  const canGoForward = Boolean(flow.next)
  const queuedHere = item ? isUpcoming(queue, item.id) : false
  const playingFromQueue = flow.mode === 'queue'

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
      if (delta > 0) goNext('manual')
      else goPrev()
    },
    [goNext, goPrev]
  )

  /** Queue drawer "now playing" row: show that item here. */
  const openFromQueue = useCallback(
    (target: MediaItem) => {
      if (target.id === item?.id) return
      setStartIntent({ id: target.id, play: true })
      onNavigate?.(target)
    },
    [item?.id, onNavigate]
  )

  const setFrame = useCallback(
    (index: number, direction: 1 | -1) => {
      if (item) setFrameState({ itemId: item.id, index, direction })
    },
    [item]
  )

  const canLeave = useCallback(
    (direction: -1 | 1) => (direction < 0 ? canGoBack : canGoForward),
    [canGoBack, canGoForward]
  )
  const leave = useCallback((direction: -1 | 1) => navigateBy(direction), [navigateBy])

  /** ←/→ on photos: frames first, then sibling items. */
  const stepPhoto = useCallback(
    (direction: -1 | 1) => {
      const next = frameIndex + direction
      if (next >= 0 && next < frameCount) setFrame(next, direction)
      else navigateBy(direction)
    },
    [frameCount, frameIndex, navigateBy, setFrame]
  )

  const toggleTheatre = useCallback(() => {
    setTheatre((value) => {
      const next = !value
      writeRaw(THEATRE_KEY, next ? '1' : '0') // best-effort preference, gated for incognito
      return next
    })
  }, [])

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

  // Warm the neighbours' posters (and, off data-saver, their first photo) so ←/→ feels instant.
  useEffect(() => {
    if (!open || !items || itemIndex < 0) return
    const saver = readNetwork().saveData
    for (const offset of [1, -1]) {
      const neighbour = items[itemIndex + offset]
      if (!neighbour) continue
      const url = resolveMediaAssetUrl(neighbour.thumbnail)
      if (url) {
        const poster = new Image()
        poster.decoding = 'async'
        poster.referrerPolicy = 'no-referrer'
        poster.src = url
      }
      if (!saver && !neighbour.isVideo && neighbour.mediaUrl) {
        const full = new Image()
        full.decoding = 'async'
        full.referrerPolicy = 'no-referrer'
        full.src = resolveMediaAssetUrl(neighbour.mediaUrl)
      }
    }
  }, [items, itemIndex, open])

  // Tell the queue layer a sheet is open: the dock steps aside and the drawer/help render inside this dialog.
  // The registration is released once the exit animation has finished (or on unmount), so the
  // dock never plays on top of a sheet that is still sliding away.
  const sheetShown = open && Boolean(item)
  const releaseSheet = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (sheetShown && !releaseSheet.current) releaseSheet.current = surface.registerSheet()
  }, [sheetShown])
  useEffect(
    () => () => {
      releaseSheet.current?.()
      releaseSheet.current = null
    },
    []
  )
  const onSheetExited = useCallback(() => {
    releaseSheet.current?.()
    releaseSheet.current = null
  }, [])

  // Scroll lock
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // Keyboard. Videos: the player owns ←/→/J/K/F/M/T/P/C…; the sheet keeps Esc,
  // Shift+←/→ ([ ]) for item navigation, S save, Shift+F follow.
  // Photos: ←/→ step frames then items, J/K items, F follow, S save.
  useEffect(() => {
    if (!open) return
    const isVideo = Boolean(item?.isVideo)
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      // The queue drawer and shortcut help own the keyboard (Esc closes just them).
      if (overlayOpen()) return
      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          onClose()
          break
        // Queue keys. On videos the player handles these first; they reach here for photos
        // and when the player is unavailable.
        case 'n':
        case 'N':
          event.preventDefault()
          navigateBy(1)
          break
        case 'p':
        case 'P':
          event.preventDefault()
          navigateBy(-1)
          break
        case 'q':
          event.preventDefault()
          surface.togglePanel()
          break
        case 'Q':
          event.preventDefault()
          if (item) enqueueWithToast(item, 'last', item, addToast)
          break
        case '?':
          event.preventDefault()
          surface.toggleHelp()
          break
        case 'ArrowLeft':
          if (isVideo && !event.shiftKey) return
          event.preventDefault()
          if (isVideo) navigateBy(-1)
          else stepPhoto(-1)
          break
        case 'ArrowRight':
          if (isVideo && !event.shiftKey) return
          event.preventDefault()
          if (isVideo) navigateBy(1)
          else stepPhoto(1)
          break
        case '[':
        case 'PageUp':
          event.preventDefault()
          navigateBy(-1)
          break
        case ']':
        case 'PageDown':
          event.preventDefault()
          navigateBy(1)
          break
        case 'j':
        case 'J':
          if (isVideo) return
          navigateBy(1)
          break
        case 'k':
        case 'K':
          if (isVideo) return
          navigateBy(-1)
          break
        case 'F':
          follow()
          break
        case 'f':
          if (isVideo) return
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
  }, [addToast, follow, item, navigateBy, onClose, open, save, stepPhoto])

  useFocusTrap(panelRef, open)

  const spring = motionOk ? { type: 'spring' as const, stiffness: 340, damping: 36, mass: 0.9 } : { duration: 0.01 }
  const wide = theatre && item?.isVideo
  const posterUrl = intel?.posterUrl || item?.thumbnail

  // Portal to <body>: pages use transform-based enter animations, and any
  // transformed ancestor becomes the containing block for position:fixed —
  // on phones that pins the sheet to the page content instead of the screen.
  return createPortal(
    <AnimatePresence onExitComplete={onSheetExited}>
      {open && item && (
        <div className="fixed inset-0 z-[200] flex items-end justify-end md:items-stretch">
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 h-full w-full bg-scrim backdrop-blur-[2px]"
            aria-label="Close media details"
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="media-title"
            initial={isDesktop ? { x: '100%', opacity: 0.6 } : { y: '100%' }}
            animate={{ x: 0, y: 0, opacity: 1 }}
            exit={isDesktop ? { x: '100%', opacity: 0.6 } : { y: '100%' }}
            transition={motionOk ? { ...spring } : { duration: 0.01, ease: easeOut }}
            className={cn(
              'relative z-10 flex h-dvh w-full flex-col overflow-hidden bg-elevated shadow-overlay outline-none md:h-full md:border-l md:border-line-strong/60',
              wide ? 'md:w-[min(1480px,98vw)]' : 'md:w-[min(1120px,94vw)]'
            )}
          >
            <VelvetBackdrop item={item} active={motionOk && isDesktop} />

            {/* Glass header */}
            <div
              className="relative z-10 flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] bg-canvas/40 px-3 pb-2.5 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl sm:px-5 sm:pt-3"
              inert={overlay || undefined}
            >
              <div className="min-w-0">
                <span className="mono-meta block truncate uppercase">Public source · {item.source}</span>
              </div>
              <div className="flex items-center gap-1">
                {onNavigate && (flow.mode !== 'none' || canGoBack || canGoForward) && (
                  <>
                    {flow.position ? (
                      <span className="mr-1 hidden font-mono text-[11px] tabular-nums text-gold-ink sm:inline" aria-hidden="true">
                        Queue {flow.position.index} / {flow.position.total}
                      </span>
                    ) : (
                      itemIndex >= 0 &&
                      items && (
                        <span className="mr-1 hidden font-mono text-[11px] tabular-nums text-ink-3 sm:inline" aria-hidden="true">
                          {itemIndex + 1} / {items.length}
                        </span>
                      )
                    )}
                    <button
                      onClick={() => navigateBy(-1)}
                      disabled={!canGoBack}
                      className="grid h-11 w-11 place-items-center rounded-full text-ink-2 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-heat/70 disabled:opacity-30"
                      aria-label={playingFromQueue ? 'Previous in queue' : 'Previous item'}
                    >
                      <ArrowLeft size={16} strokeWidth={1.75} />
                    </button>
                    <button
                      onClick={() => navigateBy(1)}
                      disabled={!canGoForward}
                      className="grid h-11 w-11 place-items-center rounded-full text-ink-2 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-heat/70 disabled:opacity-30"
                      aria-label={playingFromQueue ? 'Next in queue' : 'Next item'}
                    >
                      <ArrowRight size={16} strokeWidth={1.75} />
                    </button>
                  </>
                )}
                <button
                  onClick={() => surface.togglePanel()}
                  className="relative grid h-11 w-11 place-items-center rounded-full text-ink-2 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-heat/70"
                  aria-label={queue.upcoming.length > 0 ? `Open queue, ${queue.upcoming.length} up next` : 'Open queue'}
                  aria-expanded={surf.panelOpen}
                  title="Queue (Q)"
                  data-testid="sheet-queue-button"
                >
                  <ListVideo size={17} strokeWidth={1.75} aria-hidden="true" />
                  {queue.upcoming.length > 0 && (
                    <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-heat px-1 font-mono text-[9px] font-semibold leading-4 text-canvas" aria-hidden="true">
                      {queue.upcoming.length > 99 ? '99+' : queue.upcoming.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={onClose}
                  className="grid h-11 w-11 place-items-center rounded-full text-ink-2 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-heat/70"
                  aria-label="Close"
                >
                  <X size={17} strokeWidth={1.75} />
                </button>
              </div>
            </div>

            <div
              className={cn(
                'relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain',
                !wide && 'lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:overflow-hidden'
              )}
              inert={overlay || undefined}
            >
              {/* Stage column: media, title, creator, actions */}
              <div
                className={cn(
                  'px-3 pb-6 pt-3 sm:px-6 sm:pt-5',
                  !wide && 'lg:overflow-y-auto lg:overscroll-contain lg:pb-10'
                )}
              >
                <div
                  className={cn(
                    '[--mc-max-h:52dvh] landscape:[--mc-max-h:72dvh] sm:[--mc-max-h:min(62dvh,640px)]',
                    wide && 'sm:[--mc-max-h:78dvh]'
                  )}
                >
                  {item.isVideo ? (
                    <VideoPlayer
                      key={item.id}
                      item={item}
                      theatre={{ active: theatre, toggle: toggleTheatre }}
                      flow={flow}
                    />
                  ) : (
                    <PhotoViewer
                      key={item.id}
                      item={item}
                      index={frameIndex}
                      direction={frameDirection}
                      onIndexChange={setFrame}
                      canLeave={canLeave}
                      onLeave={leave}
                      className="-mx-3 sm:mx-0"
                    />
                  )}
                </div>

                <div className="relative z-10">
                <h2 id="media-title" className="mt-6 text-xl font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-2xl">
                  {item.title}
                </h2>
                <p className="mono-meta mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 uppercase">
                  <span>{item.source}</span>
                  <span aria-hidden="true">·</span>
                  <span>{relativeTime(item.createdAt)}</span>
                  {item.views > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{formatMetric(item.views)} views</span>
                    </>
                  )}
                  {intel?.width && intel.height && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {intel.width}×{intel.height}
                      </span>
                    </>
                  )}
                  {intel?.hasAudio === false && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>No audio</span>
                    </>
                  )}
                </p>

                {/* Creator strip */}
                <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3 backdrop-blur-md">
                  <div
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-heat/70 to-heat/20 font-mono text-sm font-semibold text-white ring-1 ring-white/15"
                    aria-hidden="true"
                  >
                    {item.creator.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">@{item.creator}</p>
                    <p className="mono-meta mt-0.5 truncate uppercase">Observed on {item.source}</p>
                  </div>
                  <button
                    onClick={follow}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-heat/70',
                      followed ? 'bg-white/10 text-ink hover:bg-white/15' : 'bg-heat text-canvas hover:bg-heat-hover'
                    )}
                    aria-pressed={followed}
                  >
                    <UserPlus size={14} strokeWidth={1.75} aria-hidden="true" />
                    {followed ? 'Following' : 'Follow'}
                  </button>
                </div>

                {/* Actions */}
                <div className="mt-3 grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
                  {item.pageUrl && (
                    <a href={item.pageUrl} target="_blank" rel="noreferrer" className="btn-primary col-span-2 w-full sm:col-span-1 sm:w-auto">
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
                  <button
                    onClick={() => (queuedHere ? queueActions.remove(item.id) : enqueueWithToast(item, 'last', item, addToast))}
                    disabled={playingFromQueue}
                    className={cn('btn-secondary w-full sm:w-auto', playingFromQueue && 'col-span-2 sm:col-span-1')}
                    aria-pressed={queuedHere || playingFromQueue}
                    data-testid="add-to-queue"
                  >
                    {queuedHere || playingFromQueue ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : <ListPlus size={14} strokeWidth={1.75} aria-hidden="true" />}
                    {playingFromQueue ? 'In queue' : queuedHere ? 'Queued · remove' : 'Add to queue'}
                  </button>
                  {!playingFromQueue && (
                    <button onClick={() => enqueueWithToast(item, 'next', item, addToast)} className="btn-secondary w-full sm:w-auto" data-testid="play-next">
                      <ListStart size={14} strokeWidth={1.75} aria-hidden="true" />
                      Play next
                    </button>
                  )}
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
                        <div
                          className="absolute left-0 top-full z-20 mt-1.5 w-64 rounded-2xl border border-white/10 bg-elevated/95 p-2 shadow-overlay backdrop-blur-xl"
                          role="dialog"
                          aria-label="Collections"
                        >
                          {collections.length === 0 && <p className="px-1.5 py-2 text-[12px] text-ink-3">No collections yet — create one below.</p>}
                          <ul className="max-h-44 overflow-y-auto">
                            {collections.map((collection) => {
                              const member = collection.itemIds.includes(item.id)
                              return (
                                <li key={collection.id}>
                                  <button
                                    onClick={() => (member ? removeItem(collection.id, item.id) : addItem(collection.id, item.id))}
                                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1.5 text-left text-[13px] text-ink hover:bg-white/8"
                                    aria-pressed={member}
                                  >
                                    <span
                                      className={cn(
                                        'grid h-4 w-4 shrink-0 place-items-center rounded-sm border',
                                        member ? 'border-heat bg-heat text-canvas' : 'border-line-strong text-transparent'
                                      )}
                                    >
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
                              className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-transparent px-2 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
                            />
                            <button
                              onClick={() => {
                                if (!collectDraft.trim()) return
                                const created = createCollection(collectDraft)
                                addItem(created.id, item.id)
                                setCollectDraft('')
                              }}
                              disabled={!collectDraft.trim()}
                              className="btn-secondary min-h-9 px-2.5 text-xs"
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {item.isVideo && (
                  <p className="mt-4 hidden font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3 sm:block">
                    Space play · J/L ±10s · N/P next/prev · B moment · Q queue · M mute · F fullscreen · T theatre · ? all shortcuts
                  </p>
                )}
                </div>
              </div>

              {/* Info column */}
              <aside
                className={cn(
                  'border-t border-white/[0.06] px-3 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-5 sm:px-6',
                  !wide && 'lg:overflow-y-auto lg:overscroll-contain lg:border-l lg:border-t-0 lg:bg-canvas/25 lg:px-5 lg:backdrop-blur-xl'
                )}
              >
                {/* Artwork card with 3D tilt (desktop) */}
                {posterUrl && (
                  <div className="mb-5 hidden gap-4 lg:flex">
                    <Tilt3D className="h-36 w-28 shrink-0 rounded-xl" max={10}>
                      <div className="relative h-full w-full overflow-hidden rounded-xl bg-sunken shadow-[0_18px_40px_-16px_rgb(0_0_0/0.85)] ring-1 ring-white/15">
                        <MediaImage
                          sources={[posterUrl, item.thumbnail]}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover"
                          skeletonClassName="absolute inset-0"
                          dominantColor={intel?.dominantColor}
                          lqip={intel?.lqip}
                        />
                        <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/65 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white backdrop-blur-sm">
                          {item.isVideo ? item.duration || 'Video' : frameCount > 1 ? `${frameCount} photos` : 'Photo'}
                        </span>
                      </div>
                    </Tilt3D>
                    <div className="min-w-0 flex-1 self-center">
                      <p className="eyebrow">Signal</p>
                      <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-ink">{item.curationScore ?? '—'}</p>
                      <p className="mono-meta mt-1 uppercase">{formatMetric(item.likes)} likes</p>
                    </div>
                  </div>
                )}

                <QueueStatusCard item={item} />

                {/* Why this appeared */}
                <section className="border-b border-white/[0.06] pb-5">
                  <h3 className="eyebrow">Why this appeared</h3>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(item.recommendationReasons || item.curationReasons || ['Matches the current public feed']).map((reason) => (
                      <span key={reason} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] tracking-[0.02em] text-ink-2">
                        {reason}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => feedback('more')} className="btn-secondary min-h-11 px-3 text-xs">
                      <ThumbsUp size={13} strokeWidth={1.75} aria-hidden="true" /> More like this
                    </button>
                    <button onClick={() => feedback('less')} className="btn-secondary min-h-11 px-3 text-xs">
                      <ThumbsDown size={13} strokeWidth={1.75} aria-hidden="true" /> Less like this
                    </button>
                  </div>
                </section>

                {/* Mono metadata grid */}
                <dl className="grid grid-cols-3 gap-px border-b border-white/[0.06] py-4">
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
                      <dd className="mt-0.5 truncate font-mono text-xs text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>

                {item.description && <p className="mt-4 text-sm leading-6 text-ink-2">{item.description}</p>}

                {item.tags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {item.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-white/[0.06] px-2.5 py-1 font-mono text-[10px] text-ink-2">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {item.isVideo && <MomentsPanel item={item} />}

                {/* Related rail */}
                {related.length > 0 && onNavigate && (
                  <section className="mt-6">
                    <h3 className="eyebrow">More like this</h3>
                    <div className="hide-scrollbar mt-3 flex gap-3 overflow-x-auto pb-1">
                      {related.map((entry) => (
                        <div key={entry.id} className="group/rel relative w-28 shrink-0">
                          <button
                            onClick={() => onNavigate(entry)}
                            className="block w-full text-left outline-none tap-highlight-none"
                            aria-label={`Open ${entry.title}`}
                          >
                            <span className="relative block aspect-[2/3] overflow-hidden rounded-xl bg-sunken ring-1 ring-white/10 transition-[transform,box-shadow] duration-300 group-hover/rel:-translate-y-0.5 group-hover/rel:shadow-[0_14px_30px_-14px_rgb(0_0_0/0.9)] group-focus-within/rel:ring-2 group-focus-within/rel:ring-heat/80">
                              <MediaImage
                                sources={entry.isVideo ? [entry.thumbnail] : [entry.thumbnail, entry.mediaUrl]}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover"
                                skeletonClassName="absolute inset-0"
                              />
                              {entry.isVideo && entry.duration && (
                                <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/65 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white">{entry.duration}</span>
                              )}
                              <CompletionRing itemId={entry.id} size={20} className="left-1.5 right-auto top-1.5" />
                            </span>
                            <span className="mt-1.5 block truncate font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">{entry.creator}</span>
                          </button>
                          <button
                            onClick={() => enqueueWithToast(entry, 'last', item, addToast)}
                            className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-full text-white outline-none before:absolute before:h-7 before:w-7 before:rounded-full before:bg-black/65 before:content-[''] focus-visible:ring-2 focus-visible:ring-heat/80"
                            aria-label={`Add ${entry.title} to queue`}
                            title="Add to queue"
                          >
                            <Plus size={14} strokeWidth={2.25} className="relative" aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </aside>
            </div>
            {surf.panelOpen && (
              <Suspense fallback={null}>
                <QueuePanel inside onClose={surface.closePanel} onOpenItem={openFromQueue} />
              </Suspense>
            )}
            {surf.helpOpen && (
              <Suspense fallback={null}>
                <ShortcutHelp inside onClose={surface.closeHelp} />
              </Suspense>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
