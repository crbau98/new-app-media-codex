import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListVideo, Maximize2, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import MediaImage from '@/components/MediaImage'
import { PlayerEngine } from '@/components/player/engine'
import { readNetwork, useMediaSession, usePauseWhenHidden, usePlaybackSources, useVideoState } from '@/components/player/hooks'
import { loadPlayerPrefs } from '@/lib/player/prefs'
import { readMediaIntel } from '@/lib/player/intel'
import type { MediaItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useQueue } from './hooks'
import { loadItemRates, rateFor } from './playerMemory'
import { peekNext } from './queueModel'
import { queueActions } from './queueStore'
import { clearHandoff, clearStartIntent, discardOtherIntents, peekHandoff, peekStartIntent, setStartIntent } from './startIntent'
import { overlayOpen, surface } from './surface'
import '@/styles/queue.css'

interface QueueDockProps {
  /** Open the full detail sheet for an item (hand-off already recorded). */
  onExpand: (item: MediaItem) => void
}

const dockBtn =
  'grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-heat/70 disabled:opacity-35'

/**
 * Persistent mini player. While the queue has a current item and no detail
 * sheet is open, it keeps playing (or waits, restored paused after a reload)
 * as you browse, advances through the queue on its own, and expands back into
 * the full sheet at the same position.
 */
export default function QueueDock({ onExpand }: QueueDockProps) {
  const { nowPlaying } = useQueue()
  if (!nowPlaying) return null
  return <DockBody key={nowPlaying.id} item={nowPlaying} onExpand={onExpand} />
}

function DockBody({ item, onExpand }: { item: MediaItem; onExpand: (item: MediaItem) => void }) {
  const queue = useQueue()
  const upNext = peekNext(queue)?.item ?? null
  const intel = useMemo(() => readMediaIntel(item), [item])

  const [engine] = useState(() => new PlayerEngine())
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const bindVideo = useCallback(
    (element: HTMLVideoElement | null) => {
      setVideo(element)
      engine.bind(element)
    },
    [engine],
  )
  const state = useVideoState(video)
  const sources = usePlaybackSources(item)

  // Start where the sheet left off (or, after a reload, paused at the saved position).
  const [intent] = useState(() => peekStartIntent(item.id) ?? peekHandoff(item.id))
  useEffect(() => {
    clearStartIntent(intent)
    clearHandoff(item.id)
    discardOtherIntents(item.id)
  }, [intent, item.id])

  const itemId = item.id
  useEffect(() => {
    if (!item.isVideo || !video) return
    const prefs = loadPlayerPrefs()
    video.volume = prefs.volume
    video.playbackRate = rateFor(loadItemRates(), itemId) ?? prefs.rate
  }, [item.isVideo, itemId, video])

  const playIntent = Boolean(intent?.play)
  const startAt = intent?.at
  useEffect(() => {
    if (!item.isVideo) return undefined
    engine.configure({ item, autoplay: playIntent, slowNetwork: readNetwork().slow, legacyRecover: async () => null, startAt }, sources)
    return () => engine.stop()
    // Only the playback inputs (sources) matter; the item object is replaced on feed refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, sources, playIntent, itemId])

  usePauseWhenHidden(video)

  const goNext = useCallback(() => {
    queueActions.next('manual')
  }, [])
  const goPrev = useCallback(() => {
    if (video && video.currentTime > 3) {
      video.currentTime = 0
      return
    }
    queueActions.previous()
  }, [video])

  const artwork = useMemo(() => {
    const url = intel.posterUrl || item.thumbnail
    try {
      return url ? new URL(url, window.location.href).href : undefined
    } catch {
      return undefined
    }
  }, [intel.posterUrl, item.thumbnail])
  useMediaSession(
    item.isVideo ? video : null,
    { title: item.title, artist: `@${item.creator}`, album: item.source, artwork },
    { onPrev: queue.history.length > 0 ? goPrev : undefined, onNext: upNext ? goNext : undefined },
  )

  // The video ended on its own: honour repeat-one, else continue through the queue.
  useEffect(() => {
    if (!video) return undefined
    const onEnded = () => {
      if (video.loop) return
      const outcome = queueActions.next('auto')
      if (outcome === 'replay') {
        video.currentTime = 0
        engine.play()
      }
    }
    video.addEventListener('ended', onEnded)
    return () => video.removeEventListener('ended', onEnded)
  }, [engine, video])

  // Browsing keys while the dock is up (never while typing or an overlay owns the keyboard).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || overlayOpen()) return
      const target = event.target as HTMLElement | null
      if (!target || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return
      if (target.closest('[role="dialog"]')) return
      switch (event.key) {
        case 'n':
        case 'N':
          goNext()
          break
        case 'p':
        case 'P':
          goPrev()
          break
        case 'q':
          surface.togglePanel()
          break
        case '?':
          surface.toggleHelp()
          break
        default:
          return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goNext, goPrev])

  const expand = () => {
    if (video && item.isVideo) setStartIntent({ id: item.id, at: video.currentTime, play: !video.paused })
    onExpand(item)
  }

  const close = () => {
    engine.pause()
    surface.dismissDock()
  }

  const progress = state.duration > 0 ? Math.min(100, (state.currentTime / state.duration) * 100) : 0
  const playing = !state.paused
  const canNext = Boolean(upNext)
  const canPrev = queue.history.length > 0 || state.currentTime > 3

  return (
    <div
      className="q-dock fixed bottom-[calc(env(safe-area-inset-bottom,0px)+8.25rem)] left-3 right-3 z-[150] md:left-auto md:right-6 md:w-[392px]"
      role="region"
      aria-label="Now playing from your queue"
      data-testid="queue-dock"
    >
      <div className="relative rounded-2xl border border-white/10 bg-elevated shadow-overlay">
        <div className="flex items-center gap-2 p-1.5 pr-1">
          <button
            type="button"
            onClick={expand}
            className="group/thumb relative block aspect-video w-[5.5rem] shrink-0 overflow-hidden rounded-xl bg-black outline-none ring-1 ring-white/10 focus-visible:ring-2 focus-visible:ring-heat/80 md:w-[7rem]"
            aria-label={`Open ${item.title}`}
          >
            {item.isVideo ? (
              <video
                ref={bindVideo}
                poster={intel.posterUrl || item.thumbnail}
                playsInline
                preload="metadata"
                aria-hidden="true"
                tabIndex={-1}
                className="absolute inset-0 h-full w-full object-cover"
                data-testid="dock-video"
              />
            ) : (
              <MediaImage sources={[item.thumbnail]} alt="" className="absolute inset-0 h-full w-full object-cover" skeletonClassName="absolute inset-0" loading="eager" />
            )}
            <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition-[opacity,background-color] group-hover/thumb:bg-black/40 group-hover/thumb:opacity-100 group-focus-visible/thumb:bg-black/40 group-focus-visible/thumb:opacity-100">
              <Maximize2 size={16} aria-hidden="true" />
            </span>
          </button>

          <button type="button" onClick={expand} className="min-w-0 flex-1 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-heat/70" aria-label={`Expand ${item.title}`}>
            <span className="block truncate text-[13px] font-semibold leading-tight text-ink" data-testid="dock-title">
              {item.title}
            </span>
            <span className="mt-0.5 block truncate font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">@{item.creator}</span>
            {upNext && <span className="mt-0.5 hidden truncate text-[11px] text-ink-3 md:block">Up next · {upNext.title}</span>}
          </button>

          <div className="flex shrink-0 items-center">
            <button type="button" onClick={goPrev} disabled={!canPrev} className={cn(dockBtn, 'hidden sm:grid')} aria-label="Previous">
              <SkipBack size={17} fill="currentColor" strokeWidth={1.75} aria-hidden="true" />
            </button>
            {item.isVideo ? (
              <button type="button" onClick={() => engine.toggle()} className={cn(dockBtn, 'bg-white/10')} aria-label={playing ? 'Pause' : 'Play'} data-testid="dock-toggle">
                {playing ? <Pause size={18} fill="currentColor" strokeWidth={1.75} aria-hidden="true" /> : <Play size={18} fill="currentColor" strokeWidth={1.75} className="ml-0.5" aria-hidden="true" />}
              </button>
            ) : (
              <button type="button" onClick={expand} className={cn(dockBtn, 'bg-white/10')} aria-label={`View ${item.title}`}>
                <Maximize2 size={17} aria-hidden="true" />
              </button>
            )}
            <button type="button" onClick={goNext} disabled={!canNext} className={dockBtn} aria-label={upNext ? `Next: ${upNext.title}` : 'Next'} data-testid="dock-next">
              <SkipForward size={17} fill="currentColor" strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => surface.togglePanel()}
              className={cn(dockBtn, 'relative')}
              aria-label={`Open queue, ${queue.upcoming.length} up next`}
              data-testid="dock-queue"
            >
              <ListVideo size={18} strokeWidth={1.75} aria-hidden="true" />
              {queue.upcoming.length > 0 && (
                <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-heat px-1 font-mono text-[9px] font-semibold leading-4 text-canvas" aria-hidden="true">
                  {queue.upcoming.length > 99 ? '99+' : queue.upcoming.length}
                </span>
              )}
            </button>
          </div>
        </div>
        <div className="q-dock-progress mx-2 mb-0 overflow-hidden rounded-full" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <button
          type="button"
          onClick={close}
          className="absolute -top-2.5 right-3 grid h-6 w-6 place-items-center rounded-full border border-white/10 bg-elevated text-ink-3 outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-heat/70"
          aria-label="Hide queue player"
        >
          <X size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
