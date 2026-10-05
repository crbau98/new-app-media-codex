import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { ExternalLink, FastForward, LoaderCircle, Play, Rewind, RotateCcw, TriangleAlert, Volume2, VolumeX, Zap } from 'lucide-react'
import MediaImage from '@/components/MediaImage'
import { apiUrl, resolvePublicUrl } from '@/lib/backendOrigin'
import { clamp, formatRate, formatTime, isDoubleTap, resolveKeyAction, stepRate, tapZone, type PlayerAction } from '@/lib/player/controls'
import { readMediaIntel, safeColor } from '@/lib/player/intel'
import { loadPlayerPrefs, savePlayerPrefs } from '@/lib/player/prefs'
import { buildSources, legacyScreenshotId, type PlaybackSource } from '@/lib/player/sources'
import type { MediaItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useItemMoments } from '@/features/queue/hooks'
import type { Moment } from '@/features/queue/momentsModel'
import { momentsActions } from '@/features/queue/momentsStore'
import {
  forgetCreatorStart,
  loadItemRates,
  loadSmartStart,
  MAX_SKIP_TARGET,
  MIN_SKIP_TARGET,
  rateFor,
  recordSkip,
  saveItemRate,
  saveSmartStart,
  suggestStart,
} from '@/features/queue/playerMemory'
import { inQueueMode } from '@/features/queue/queueModel'
import { enqueueWithToast } from '@/features/queue/queueUi'
import { getQueue } from '@/features/queue/queueStore'
import { clearStartIntent, discardOtherIntents, peekStartIntent, recordPlayback, SEEK_EVENT, type SeekDetail } from '@/features/queue/startIntent'
import { overlayOpen, surface } from '@/features/queue/surface'
import type { PlaybackFlow } from '@/features/queue/usePlaybackFlow'
import Controls from './Controls'
import MomentChip from './MomentChip'
import SettingsMenu from './SettingsMenu'
import SkipStartChip from './SkipStartChip'
import UpNextCard from './UpNextCard'
import { PlayerEngine } from './engine'
import {
  readNetwork,
  useAmbientGlow,
  useFullscreen,
  useMediaSession,
  useMotionOk,
  usePauseWhenHidden,
  usePictureInPicture,
  usePlaybackSources,
  useVideoState,
  useWakeLock,
} from './hooks'
import './player.css'

export interface VideoPlayerProps {
  item: MediaItem
  /** Wide "theatre" layout owned by the host; the button only shows when provided. */
  theatre?: { active: boolean; toggle: () => void }
  /** Queue-aware transport (next/previous, Up next, autoplay). Falls back to onPrev/onNext. */
  flow?: PlaybackFlow
  onPrev?: () => void
  onNext?: () => void
  className?: string
}

interface Hud {
  id: number
  kind: 'volume' | 'muted' | 'text'
  text: string
}

interface RippleState {
  id: number
  side: 'left' | 'right'
  seconds: number
}

const CONTROLS_IDLE_MS = 2800
const LONG_PRESS_MS = 480
/** The skip-to-usual-start offer only appears during the very start of a video. */
const SKIP_OFFER_WINDOW = 12

const noopSubscribe = () => () => {}

/**
 * Custom player. Delivery (HLS / progressive fallback chain, retries, resume)
 * lives in PlayerEngine; this component is the presentation: gestures,
 * keyboard, controls, glow, overlays, moments, Up next and error UI.
 */
export default function VideoPlayer({ item, theatre, flow, onPrev, onNext, className }: VideoPlayerProps) {
  const autoplay = useAppStore((state) => state.autoplayVideos)
  const muteOnStart = useAppStore((state) => state.muteOnStart)
  const pictureInPicture = useAppStore((state) => state.pictureInPicture)
  const addToast = useAppStore((state) => state.addToast)
  const motionOk = useMotionOk()

  const intel = useMemo(() => readMediaIntel(item), [item])
  const network = useSyncExternalStore(noopSubscribe, () => readNetwork().saveData, () => false)
  const dataSaver = network

  const [engine] = useState(() => new PlayerEngine())
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot)

  const itemId = item.id
  // A hand-off for this item (saved moment, queue auto-advance, dock → sheet). Pure read; consumed below.
  const [intent] = useState(() => peekStartIntent(itemId))
  useEffect(() => {
    clearStartIntent(intent)
    discardOtherIntents(itemId)
  }, [intent, itemId])

  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const lastVideo = useRef<HTMLVideoElement | null>(null)
  const bindVideo = useCallback(
    (element: HTMLVideoElement | null) => {
      if (element) lastVideo.current = element
      setVideo(element)
      engine.bind(element)
    },
    [engine],
  )
  const state = useVideoState(video)

  // While this is the queue's current item, report the live position so that closing the
  // sheet hands playback to the dock's mini player at the same spot (and playing/paused state).
  useEffect(() => {
    if (!video) return undefined
    const report = () => {
      if (video.currentTime >= 1 && !video.ended && inQueueMode(getQueue(), itemId)) recordPlayback(itemId, video.currentTime, !video.paused)
    }
    for (const type of ['timeupdate', 'pause', 'play', 'seeked']) video.addEventListener(type, report)
    return () => {
      for (const type of ['timeupdate', 'pause', 'play', 'seeked']) video.removeEventListener(type, report)
      report()
    }
  }, [itemId, video])

  const containerRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)

  const [interacting, setInteracting] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [boost, setBoost] = useState(false)
  const [hud, setHud] = useState<Hud | null>(null)
  const [ripple, setRipple] = useState<RippleState | null>(null)
  const [ambientOn, setAmbientOn] = useState(true)
  const [ab, setAb] = useState<{ a: number | null; b: number | null }>(() => (intent?.loop ? { a: intent.loop.a, b: intent.loop.b } : { a: null, b: null }))
  const [naturalAspect, setNaturalAspect] = useState<number | null>(null)
  const [momentChip, setMomentChip] = useState<{ moment: Moment; updated: boolean } | null>(null)
  const [upNext, setUpNext] = useState<{ cancelled: boolean } | null>(null)
  const [smartStartOn, setSmartStartOn] = useState(() => loadPlayerPrefs().smartStart)
  const [rateRemembered, setRateRemembered] = useState(() => rateFor(loadItemRates(), itemId) !== undefined)
  const [skipDismissed, setSkipDismissed] = useState(false)

  const itemMoments = useItemMoments(itemId)
  const markers = useMemo(() => itemMoments.map((moment) => ({ id: moment.id, time: moment.t, end: moment.end })), [itemMoments])

  const flowRef = useRef(flow)
  useEffect(() => {
    flowRef.current = flow
  }, [flow])

  /* ── source chain ───────────────────────────────────────────── */

  const sources = usePlaybackSources(item)

  const legacyRecover = useCallback(async (): Promise<PlaybackSource[] | null> => {
    const shotId = legacyScreenshotId(itemId)
    if (!shotId) return null
    const response = await fetch(apiUrl(`/api/screenshots/${shotId}/resolve-stream`), { method: 'POST' })
    if (!response.ok) return null
    const data = (await response.json()) as { cached_url?: string; local_url?: string; direct_url?: string }
    const urls = [data.cached_url, data.local_url, data.direct_url].map(resolvePublicUrl).filter((url): url is string => Boolean(url))
    if (!urls.length) return null
    return buildSources({ streamCandidates: urls, quality: 'auto', preferMobile: false, resolve: (url) => url })
  }, [itemId])

  // Prefs first (declared before configure so muted/volume are set before autoplay).
  // Speed: this item's remembered speed, else the last speed the viewer chose.
  useEffect(() => {
    if (!video) return
    const prefs = loadPlayerPrefs()
    video.volume = prefs.volume
    video.muted = muteOnStart
    video.defaultMuted = muteOnStart
    video.playbackRate = rateFor(loadItemRates(), itemId) ?? prefs.rate
    video.loop = prefs.loop
  }, [video, muteOnStart, itemId])

  const startAutoplay = autoplay || Boolean(intent?.play)
  const startAt = intent?.at
  useEffect(() => {
    engine.configure({ item, autoplay: startAutoplay, slowNetwork: readNetwork().slow, legacyRecover, startAt }, sources)
    return () => engine.stop()
    // The item object is replaced on feed refresh; identity of its playback inputs (in `sources`) is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, sources, startAutoplay, legacyRecover, itemId])

  useEffect(() => {
    if (!video) return undefined
    const persist = () => {
      if (!video.muted || video.volume > 0) savePlayerPrefs({ volume: video.volume })
    }
    const onMeta = () => {
      if (video.videoWidth && video.videoHeight) setNaturalAspect(video.videoWidth / video.videoHeight)
    }
    video.addEventListener('volumechange', persist)
    video.addEventListener('loadedmetadata', onMeta)
    return () => {
      video.removeEventListener('volumechange', persist)
      video.removeEventListener('loadedmetadata', onMeta)
    }
  }, [video])

  /* ── platform integrations ──────────────────────────────────── */

  const fullscreen = useFullscreen(containerRef, video)
  const pip = usePictureInPicture(video, pictureInPicture)
  useWakeLock(!state.paused && snap.status !== 'error')
  usePauseWhenHidden(video)

  const artwork = useMemo(() => {
    const url = intel.posterUrl || item.thumbnail
    if (!url) return undefined
    try {
      return new URL(url, window.location.href).href
    } catch {
      return undefined
    }
  }, [intel.posterUrl, item.thumbnail])

  const flowNext = flow?.next ?? null
  const goNextManual = useCallback(() => {
    flowRef.current?.goNext('manual')
  }, [])
  const goPrevManual = useCallback(() => {
    flowRef.current?.goPrev()
  }, [])
  const mediaNext = flow ? (flowNext ? goNextManual : undefined) : onNext
  const mediaPrev = flow ? (flow.canPrev ? goPrevManual : undefined) : onPrev
  useMediaSession(video, { title: item.title, artist: `@${item.creator}`, album: item.source, artwork }, { onPrev: mediaPrev, onNext: mediaNext })

  const glowActive = motionOk && !dataSaver && ambientOn && !state.paused
  useAmbientGlow(video, glowRef, motionOk && !dataSaver && ambientOn, safeColor(intel.dominantColor))

  /* ── A–B loop ───────────────────────────────────────────────── */

  useEffect(() => {
    if (!video || ab.a === null || ab.b === null) return undefined
    const { a, b } = ab
    const timer = window.setInterval(() => {
      if (video.currentTime >= b || video.currentTime < a - 0.5) video.currentTime = a
    }, 80)
    return () => window.clearInterval(timer)
  }, [video, ab])

  const markAb = useCallback(() => {
    if (!video) return
    setAb((current) => {
      if (current.a === null) return { a: video.currentTime, b: null }
      if (current.b === null && video.currentTime > current.a + 0.5) return { a: current.a, b: video.currentTime }
      return { a: null, b: null }
    })
  }, [video])

  /* ── HUD / ripple helpers ───────────────────────────────────── */

  const hudId = useRef(0)
  const flash = useCallback((kind: Hud['kind'], text: string) => {
    hudId.current += 1
    setHud({ id: hudId.current, kind, text })
  }, [])

  const lastRippleRef = useRef<{ side: 'left' | 'right'; t: number; seconds: number } | null>(null)
  const seekBy = useCallback(
    (delta: number) => {
      if (!video) return
      const max = Number.isFinite(video.duration) ? video.duration : Infinity
      video.currentTime = clamp(video.currentTime + delta, 0, max)
    },
    [video],
  )

  /* ── moments ────────────────────────────────────────────────── */

  const saveMoment = useCallback(() => {
    if (!video) return
    const clip = ab.a !== null && ab.b !== null ? { a: ab.a, b: ab.b } : null
    const result = momentsActions.save(item, clip ? clip.a : video.currentTime, { end: clip ? clip.b : null })
    if (result.moment) {
      setMomentChip({ moment: result.moment, updated: result.outcome === 'updated' })
    } else if (result.outcome === 'limit') {
      addToast({ type: 'info', title: 'Moment limit reached', message: 'Remove a moment on this video to save another.' })
    }
  }, [ab.a, ab.b, addToast, item, video])

  const saveClip = useCallback(() => {
    if (ab.a === null || ab.b === null) return
    saveMoment()
  }, [ab.a, ab.b, saveMoment])

  const dismissMomentChip = useCallback(() => setMomentChip(null), [])

  // Moment rows in the sheet (and moment cards opened on the same item) ask this player to jump.
  useEffect(() => {
    if (!video) return undefined
    const onSeek = (event: Event) => {
      const detail = (event as CustomEvent<SeekDetail>).detail
      if (!detail || detail.id !== itemId) return
      const max = Number.isFinite(video.duration) ? video.duration : Infinity
      video.currentTime = clamp(detail.t, 0, max)
      // A clip loops; a plain moment must not be dragged back by an older loop.
      setAb(detail.end !== undefined ? { a: detail.t, b: detail.end } : { a: null, b: null })
      if (detail.play !== false) engine.play()
    }
    window.addEventListener(SEEK_EVENT, onSeek)
    return () => window.removeEventListener(SEEK_EVENT, onSeek)
  }, [engine, itemId, video])

  /* ── per-creator smart start ────────────────────────────────── */

  const suggestion = useMemo(
    () => (smartStartOn && !intent?.at ? suggestStart(loadSmartStart(), item.creator) : null),
    // Learned once per opened video; the stored samples only change while it plays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemId, smartStartOn],
  )

  // Learn: the first forward jump early in a video the viewer chose to watch from the top.
  const abRef = useRef(ab)
  useEffect(() => {
    abRef.current = ab
  }, [ab])
  useEffect(() => {
    if (!video || !smartStartOn) return undefined
    let lastTime = 0
    let learned = false
    const onTime = () => {
      if (!video.seeking) lastTime = video.currentTime
    }
    const onSeeked = () => {
      if (learned || abRef.current.a !== null) return
      const to = video.currentTime
      if (lastTime > 0.3 && lastTime < SKIP_OFFER_WINDOW && to - lastTime >= MIN_SKIP_TARGET && to <= MAX_SKIP_TARGET) {
        learned = true
        saveSmartStart(recordSkip(loadSmartStart(), item.creator, to))
      }
    }
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('seeked', onSeeked)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('seeked', onSeeked)
    }
  }, [item.creator, smartStartOn, video])

  const showSkip =
    Boolean(suggestion) && !skipDismissed && snap.resumedAt === null && state.currentTime < Math.min(SKIP_OFFER_WINDOW, (suggestion?.seconds ?? 0) - 2) && state.duration > (suggestion?.seconds ?? 0) + 5

  /* ── actions ────────────────────────────────────────────────── */

  const setVolume = useCallback(
    (volume: number) => {
      if (!video) return
      video.volume = clamp(volume, 0, 1)
      video.muted = volume === 0
    },
    [video],
  )

  const toggleMute = useCallback(() => {
    if (!video) return
    video.muted = !video.muted
    if (!video.muted && video.volume === 0) video.volume = 0.5
  }, [video])

  /** A speed the viewer chose: remembered for this video and as the new default. */
  const chooseRate = useCallback(
    (rate: number) => {
      if (!video) return
      video.playbackRate = rate
      savePlayerPrefs({ rate })
      saveItemRate(itemId, rate)
      setRateRemembered(true)
    },
    [itemId, video],
  )

  const toggleLoop = useCallback(() => {
    if (!video) return
    video.loop = !video.loop
    savePlayerPrefs({ loop: video.loop })
    flash('text', video.loop ? 'Loop on' : 'Loop off')
  }, [flash, video])

  const captureFrame = useCallback(async () => {
    if (!video || !video.videoWidth || !video.videoHeight) {
      addToast({ type: 'info', title: 'Frame is not ready yet', message: 'Let the video start rendering, then capture again.' })
      return
    }
    setCapturing(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas_unavailable')
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('capture_failed')
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `media-codex-${item.id}-${Math.max(0, Math.floor(video.currentTime))}s.png`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1500)
      addToast({ type: 'success', title: 'Frame saved locally', message: 'Only keep captures you have rights or permission to store.' })
    } catch {
      addToast({
        type: 'error',
        title: 'Frame could not be captured',
        message: 'Try again after playback starts, or save it from the original source if permitted.',
      })
    } finally {
      setCapturing(false)
    }
  }, [addToast, item.id, video])

  const runAction = useCallback(
    (action: PlayerAction) => {
      if (!video) return
      switch (action.type) {
        case 'toggle':
          engine.toggle()
          break
        case 'seek':
          seekBy(action.delta)
          flash('text', `${action.delta > 0 ? '+' : '−'}${Math.abs(action.delta)}s`)
          break
        case 'seekPercent':
          if (video.duration > 0) video.currentTime = (video.duration * action.percent) / 100
          break
        case 'volume': {
          const next = clamp((video.muted ? 0 : video.volume) + action.delta, 0, 1)
          setVolume(next)
          flash('volume', `${Math.round(next * 100)}%`)
          break
        }
        case 'mute':
          toggleMute()
          flash(video.muted ? 'muted' : 'volume', video.muted ? 'Muted' : `${Math.round(video.volume * 100)}%`)
          break
        case 'fullscreen':
          void fullscreen.toggle()
          break
        case 'theatre':
          theatre?.toggle()
          break
        case 'pip':
          if (pip.supported) void pip.toggle()
          break
        case 'capture':
          void captureFrame()
          break
        case 'loop':
          toggleLoop()
          break
        case 'abLoop':
          markAb()
          break
        case 'frame':
          video.pause()
          video.currentTime = clamp(video.currentTime + action.direction / 30, 0, video.duration || Infinity)
          break
        case 'rate': {
          const next = stepRate(video.playbackRate, action.delta)
          chooseRate(next)
          flash('text', formatRate(next))
          break
        }
        case 'moment':
          saveMoment()
          break
        case 'nextItem': {
          const current = flowRef.current
          if (current?.next) current.goNext('manual')
          else if (!current && onNext) onNext()
          else flash('text', 'Nothing up next')
          break
        }
        case 'prevItem': {
          const current = flowRef.current
          // Like a music player: past the first seconds, Previous restarts; at the start it goes back.
          if (video.currentTime > 3 || !(current ? current.canPrev : onPrev)) {
            video.currentTime = 0
            flash('text', 'From the start')
          } else if (current) current.goPrev()
          else onPrev?.()
          break
        }
        case 'queue':
          surface.togglePanel()
          break
        case 'enqueue':
          enqueueWithToast(item, 'last', item, addToast)
          break
        case 'help':
          surface.toggleHelp()
          break
      }
    },
    [addToast, captureFrame, chooseRate, engine, flash, fullscreen, item, markAb, onNext, onPrev, pip, saveMoment, seekBy, setVolume, theatre, toggleLoop, toggleMute, video],
  )

  /* ── Up next (end of video) ─────────────────────────────────── */

  useEffect(() => {
    if (!video) return undefined
    const onEnded = () => {
      if (video.loop) return
      const current = flowRef.current
      if (current?.mode === 'queue' && current.repeat === 'one') {
        video.currentTime = 0
        engine.play()
        return
      }
      if (current?.next) setUpNext({ cancelled: false })
    }
    // Replaying or seeking away from the end clears the offer.
    const onResume = () => setUpNext(null)
    video.addEventListener('ended', onEnded)
    video.addEventListener('play', onResume)
    video.addEventListener('seeking', onResume)
    return () => {
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('play', onResume)
      video.removeEventListener('seeking', onResume)
    }
  }, [engine, video])

  const showUpNext = Boolean(upNext && flowNext && snap.status !== 'error')
  const upNextCounting = showUpNext && !upNext?.cancelled && Boolean(flow?.autoplay)
  const upNextCountingRef = useRef(false)
  useEffect(() => {
    upNextCountingRef.current = upNextCounting
  }, [upNextCounting])

  /* ── controls visibility ────────────────────────────────────── */

  const interactingRef = useRef(interacting)
  useEffect(() => {
    interactingRef.current = interacting
  }, [interacting])
  const idleTimer = useRef<number | null>(null)
  const pointerOverControls = useRef(false)
  const poke = useCallback(() => {
    setInteracting(true)
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      if (!pointerOverControls.current) setInteracting(false)
    }, CONTROLS_IDLE_MS)
  }, [])
  useEffect(() => {
    // Kick off the initial auto-hide countdown once, and clean up on unmount.
    const timer = window.setTimeout(() => setInteracting(false), CONTROLS_IDLE_MS + 400)
    return () => {
      window.clearTimeout(timer)
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
    }
  }, [])

  const failed = snap.status === 'error'
  const showControls = !failed && (interacting || state.paused || menuOpen || scrubbing)
  const idleCursor = !showControls && !state.paused

  /* ── keyboard ───────────────────────────────────────────────── */

  useEffect(() => {
    if (!video) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return
      // The queue drawer and shortcut help own the keyboard while open.
      if (overlayOpen()) return
      // Let real buttons/links/sliders/menus keep Space/Enter/arrow semantics.
      if (target.closest('[role="menu"], [role="dialog"][aria-label="Collections"]')) return
      // Esc cancels a running Up next countdown before it closes the sheet.
      if (event.key === 'Escape' && upNextCountingRef.current) {
        event.preventDefault()
        event.stopPropagation()
        setUpNext({ cancelled: true })
        return
      }
      const inPlayer = containerRef.current?.contains(target) ?? false
      const activatable = target.tagName === 'BUTTON' || target.tagName === 'A' || target.getAttribute('role') === 'slider'
      if (activatable && (event.key === ' ' || event.key === 'Enter')) return
      if (target.getAttribute('role') === 'slider' && inPlayer && /^Arrow|^Page|^Home|^End/.test(event.key)) return
      // Shift+arrows / brackets belong to sheet navigation.
      if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return
      const action = resolveKeyAction(event, video.paused)
      if (!action) return
      // Follow uses Shift+F; bare shortcuts are the player's.
      if (event.shiftKey && (event.key === 'F' || event.key === 'S')) return
      event.preventDefault()
      event.stopPropagation()
      poke()
      runAction(action)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [poke, runAction, video])

  /* ── gestures ───────────────────────────────────────────────── */

  const gesture = useRef<{ t: number; x: number; y: number; moved: boolean; type: string } | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  const singleTapTimer = useRef<number | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const restoreRate = useRef<number | null>(null)

  const clearLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current)
    longPressTimer.current = null
  }

  const onGestureDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    gesture.current = { t: Date.now(), x: event.clientX, y: event.clientY, moved: false, type: event.pointerType }
    if (menuOpen) setMenuOpen(false)
    if (event.pointerType !== 'mouse') {
      clearLongPress()
      longPressTimer.current = window.setTimeout(() => {
        if (!video || video.paused || gesture.current?.moved) return
        restoreRate.current = video.playbackRate
        video.playbackRate = 2
        setBoost(true)
      }, LONG_PRESS_MS)
    }
  }

  const onGestureMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current
    if (event.pointerType === 'mouse') poke()
    if (!current || current.moved) return
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 12) {
      current.moved = true
      clearLongPress()
    }
  }

  const finishBoost = () => {
    if (restoreRate.current !== null && video) {
      video.playbackRate = restoreRate.current
      restoreRate.current = null
    }
    setBoost(false)
  }

  const onGestureUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current
    gesture.current = null
    clearLongPress()
    if (!current) return
    if (restoreRate.current !== null) {
      finishBoost()
      return
    }
    if (current.moved) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (event.pointerType === 'mouse') {
      engine.toggle()
      poke()
      return
    }
    const now = { t: Date.now(), x: event.clientX - rect.left, y: event.clientY - rect.top }
    const zone = tapZone(now.x, rect.width)
    if (isDoubleTap(lastTap.current, now)) {
      if (singleTapTimer.current !== null) window.clearTimeout(singleTapTimer.current)
      singleTapTimer.current = null
      if (zone === 'center') {
        lastTap.current = null
        engine.toggle()
        return
      }
      const delta = zone === 'left' ? -10 : 10
      seekBy(delta)
      const previous = lastRippleRef.current
      const seconds = previous && previous.side === zone && now.t - previous.t < 900 ? previous.seconds + 10 : 10
      lastRippleRef.current = { side: zone, t: now.t, seconds }
      setRipple({ id: now.t, side: zone, seconds })
      lastTap.current = now
      poke()
      return
    }
    lastTap.current = now
    if (singleTapTimer.current !== null) window.clearTimeout(singleTapTimer.current)
    singleTapTimer.current = window.setTimeout(() => {
      singleTapTimer.current = null
      if (interactingRef.current) setInteracting(false)
      else poke()
    }, 260)
  }
  useEffect(
    () => () => {
      if (singleTapTimer.current !== null) window.clearTimeout(singleTapTimer.current)
      if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current)
    },
    [],
  )

  /* ── layout ─────────────────────────────────────────────────── */

  const aspect = clamp(naturalAspect ?? intel.aspect ?? 16 / 9, 0.5, 2.4)
  const spinner = !failed && (snap.status === 'loading' || snap.status === 'buffering' || snap.status === 'recovering') && (!state.paused || startAutoplay || snap.status !== 'loading')
  const showBigPlay = state.paused && !spinner && !failed && !showUpNext
  const posterSources = [intel.posterUrl, item.thumbnail]

  if (failed || sources.length === 0) {
    const externalOnly = sources.length === 0
    return (
      <div className={cn('relative grid min-h-64 place-items-center overflow-hidden rounded-xl bg-sunken', className)} style={{ aspectRatio: String(aspect) }}>
        <MediaImage
          sources={posterSources}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-20"
          skeletonClassName="absolute inset-0"
          loading="eager"
          lqip={intel.lqip}
          dominantColor={intel.dominantColor}
        />
        <div className="relative z-10 max-w-xs px-5 py-10 text-center" role="alert">
          <TriangleAlert size={18} strokeWidth={1.75} className="mx-auto text-ink-2" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-ink">{externalOnly ? 'Open this item on its source to play.' : 'This stream is temporarily unavailable.'}</p>
          {!externalOnly && snap.errorMessage && <p className="mt-1 text-xs text-ink-3">{snap.errorMessage}</p>}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {!externalOnly && (
              <button type="button" className="btn-secondary" onClick={() => engine.retry()}>
                <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" /> Try again
              </button>
            )}
            {flow?.next && (
              <button type="button" className="btn-secondary" onClick={() => flow.goNext('manual')}>
                Skip to next
              </button>
            )}
            {item.pageUrl && (
              <a href={item.pageUrl} target="_blank" rel="noreferrer" className="btn-primary">
                Watch on source <ExternalLink size={14} strokeWidth={1.75} />
              </a>
            )}
          </div>
        </div>
      </div>
    )
  }

  const pickNext = flow ? (flowNext ? goNextManual : undefined) : onNext

  return (
    <div className={cn('relative -mx-3 sm:mx-0', className)}>
      <div ref={glowRef} className="mc-glow" style={{ opacity: glowActive ? 0.6 : 0.28 }} aria-hidden="true" />
      <div
        ref={containerRef}
        className="mc-player relative z-10 mx-auto max-h-[var(--mc-max-h,62dvh)] overflow-hidden bg-black sm:rounded-2xl sm:shadow-[0_24px_70px_-20px_rgb(0_0_0/0.8)] sm:ring-1 sm:ring-white/10"
        style={{
          aspectRatio: String(aspect),
          width: `min(100%, calc(var(--mc-max-h, 62dvh) * ${aspect}))`,
          backgroundColor: safeColor(intel.dominantColor),
        }}
        data-idle={idleCursor ? 'true' : 'false'}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') poke()
        }}
        onFocusCapture={poke}
      >
        <video
          ref={bindVideo}
          poster={intel.posterUrl || item.thumbnail}
          playsInline
          muted={muteOnStart}
          // Full preload is a desktop luxury; constrained links only fetch what they need.
          preload={autoplay && !dataSaver ? 'auto' : 'metadata'}
          disablePictureInPicture={!pictureInPicture}
          aria-label={item.title}
          className="absolute inset-0 h-full w-full bg-black object-contain"
        >
          Your browser does not support video playback.
        </video>

        {!snap.frameReady && (
          <MediaImage
            sources={posterSources}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full bg-black object-contain"
            skeletonClassName="pointer-events-none absolute inset-0"
            loading="eager"
            lqip={intel.lqip}
            dominantColor={intel.dominantColor}
          />
        )}

        {/* Gesture surface: click/tap, double-tap seek, long-press 2×. */}
        <div
          className="absolute inset-0 z-10 touch-pan-y"
          onPointerDown={onGestureDown}
          onPointerMove={onGestureMove}
          onPointerUp={onGestureUp}
          onPointerCancel={() => {
            gesture.current = null
            clearLongPress()
            finishBoost()
          }}
          onDoubleClick={(event) => {
            if ((event as unknown as { pointerType?: string }).pointerType === 'touch') return
            engine.toggle() // undo the first click's toggle
            void fullscreen.toggle()
          }}
          onContextMenu={(event) => {
            if (gesture.current?.type === 'touch' || boost) event.preventDefault()
          }}
        />

        {ripple && (
          <div
            key={ripple.id}
            className={cn('mc-ripple pointer-events-none absolute inset-y-0 z-10 grid w-[38%] place-items-center', ripple.side === 'left' ? 'left-0 rounded-r-[50%]' : 'right-0 rounded-l-[50%]')}
            style={{ background: 'radial-gradient(closest-side, rgb(255 255 255 / 0.22), rgb(255 255 255 / 0.06))' }}
            aria-hidden="true"
          >
            <div className="flex flex-col items-center text-white">
              {ripple.side === 'left' ? <Rewind size={26} fill="currentColor" /> : <FastForward size={26} fill="currentColor" />}
              <span className="mt-1 font-mono text-xs font-semibold">{ripple.seconds}s</span>
            </div>
          </div>
        )}

        {hud && (
          <div key={hud.id} className="mc-hud pointer-events-none absolute left-1/2 top-[14%] z-20 -translate-x-1/2" aria-hidden="true">
            <span className="inline-flex items-center gap-2 rounded-full bg-black/70 px-3.5 py-1.5 font-mono text-xs text-white backdrop-blur-md">
              {hud.kind === 'volume' && <Volume2 size={14} />}
              {hud.kind === 'muted' && <VolumeX size={14} />}
              {hud.text}
            </span>
          </div>
        )}

        {boost && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2" role="status">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-white backdrop-blur-md">
              <Zap size={12} fill="currentColor" aria-hidden="true" /> 2× speed
            </span>
          </div>
        )}

        {showBigPlay && (
          <button
            type="button"
            onClick={() => engine.play()}
            className="absolute inset-0 z-10 grid place-items-center bg-black/25 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-heat/80"
            aria-label="Play video"
          >
            <span className="grid h-16 w-16 place-items-center rounded-full border border-white/20 bg-black/45 text-white shadow-2xl backdrop-blur-md transition-transform duration-200 hover:scale-105 sm:h-[4.5rem] sm:w-[4.5rem]">
              <Play size={26} strokeWidth={1.75} className="ml-1" fill="currentColor" aria-hidden="true" />
            </span>
          </button>
        )}

        {spinner && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-black/15" role="status" aria-label="Loading video">
            <span className="inline-flex min-h-10 items-center gap-2 rounded-full bg-black/65 px-3.5 text-xs font-medium text-white backdrop-blur-md">
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
              {snap.status === 'recovering' ? 'Reconnecting' : 'Loading video'}
            </span>
          </div>
        )}

        {/* Transient badges (CSS-faded, no timers). */}
        <div className="pointer-events-none absolute left-3 top-3 z-20 flex flex-col items-start gap-1.5">
          {snap.usingFallback && (
            <span key={`fb-${snap.sourceIndex}`} className="mc-fade-out rounded-full bg-black/65 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-white backdrop-blur-md">
              Fallback {snap.sourceIndex + 1} connected
            </span>
          )}
          {snap.resumedAt !== null && (
            <span key={`rs-${snap.resumedAt}`} className="mc-fade-out rounded-full bg-black/65 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-white backdrop-blur-md">
              Resumed at {formatTime(snap.resumedAt)}
            </span>
          )}
        </div>

        {snap.autoMuted && state.muted && (
          <button
            type="button"
            onClick={() => {
              if (video) video.muted = false
            }}
            className="absolute right-3 top-3 z-20 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-black/65 px-3.5 text-xs font-medium text-white outline-none backdrop-blur-md focus-visible:ring-2 focus-visible:ring-heat/80"
          >
            <VolumeX size={14} aria-hidden="true" /> Tap to unmute
          </button>
        )}

        {/* Smart start + moment confirmation, stacked above the control bar. */}
        <div className="pointer-events-none absolute bottom-[4.5rem] left-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2 sm:bottom-[4.75rem]">
          {showSkip && suggestion && (
            <SkipStartChip
              seconds={suggestion.seconds}
              creator={item.creator}
              samples={suggestion.samples}
              onSkip={() => {
                if (video) video.currentTime = suggestion.seconds
                setSkipDismissed(true)
                engine.play()
              }}
              onForget={() => {
                saveSmartStart(forgetCreatorStart(loadSmartStart(), item.creator))
                setSkipDismissed(true)
                addToast({ type: 'info', title: `Won't suggest skipping for @${item.creator}`, message: 'Change this any time in the player settings.' })
              }}
            />
          )}
          {momentChip && (
            <MomentChip
              key={momentChip.moment.id}
              moment={momentChip.moment}
              updated={momentChip.updated}
              onLabel={(label) => {
                momentsActions.rename(momentChip.moment.id, label)
                setMomentChip({ ...momentChip, moment: { ...momentChip.moment, label } })
              }}
              onUndo={() => {
                momentsActions.remove(momentChip.moment.id)
                setMomentChip(null)
              }}
              onDismiss={dismissMomentChip}
            />
          )}
        </div>

        {showUpNext && flowNext && flow && (
          <UpNextCard
            key={flowNext.id}
            item={flowNext}
            countdown={upNextCounting}
            source={flow.mode === 'queue' ? 'queue' : 'list'}
            onPlay={() => {
              setUpNext(null)
              flow.goNext(upNextCounting ? 'auto' : 'upnext')
            }}
            onCancel={() => setUpNext({ cancelled: true })}
          />
        )}

        <div
          onPointerEnter={() => {
            pointerOverControls.current = true
          }}
          onPointerLeave={() => {
            pointerOverControls.current = false
          }}
        >
          <Controls
            video={video}
            state={state}
            visible={showControls}
            spriteUrl={intel.spriteUrl}
            spriteGrid={intel.spriteGrid}
            onTogglePlay={() => engine.toggle()}
            onVolume={setVolume}
            onMute={toggleMute}
            menuOpen={menuOpen}
            onMenuToggle={() => setMenuOpen((open) => !open)}
            pip={pip}
            fullscreen={fullscreen}
            theatre={theatre}
            capture={{ ready: snap.frameReady, busy: capturing, onCapture: () => void captureFrame() }}
            abLoop={ab}
            onScrubChange={setScrubbing}
            onNext={pickNext}
            nextTitle={flowNext?.title}
            onMoment={saveMoment}
            momentIsClip={ab.a !== null && ab.b !== null}
            markers={markers}
            queue={flow ? { count: flow.upcomingCount, onOpen: () => surface.openPanel() } : undefined}
          />
        </div>

        {menuOpen && (
          <div className="pointer-events-none absolute bottom-[5.25rem] right-2 top-2 z-30 flex items-end justify-end">
            <SettingsMenu
              rate={state.rate}
              onRate={chooseRate}
              rateRemembered={rateRemembered}
              qualityOptions={snap.qualityOptions}
              activeQuality={snap.activeQuality}
              playingLabel={snap.playingLabel}
              onQuality={(id) => engine.setQuality(id)}
              loop={state.loop}
              onLoop={toggleLoop}
              ambient={{ available: motionOk && !dataSaver, enabled: ambientOn, onToggle: () => setAmbientOn((value) => !value) }}
              abLoop={{ a: ab.a, b: ab.b, onMark: markAb, onClear: () => setAb({ a: null, b: null }), onSaveClip: saveClip }}
              autoplayNext={flow && (flow.mode === 'queue' || flow.next) ? { enabled: flow.autoplay, mode: flow.mode === 'queue' ? 'queue' : 'list', onToggle: flow.toggleAutoplay } : undefined}
              pip={pip}
              smartStart={{
                enabled: smartStartOn,
                onToggle: () => {
                  const next = !smartStartOn
                  savePlayerPrefs({ smartStart: next })
                  setSmartStartOn(next)
                },
              }}
              onShortcuts={() => {
                setMenuOpen(false)
                surface.openHelp()
              }}
              onMoment={() => {
                setMenuOpen(false)
                saveMoment()
              }}
              onEnqueue={() => {
                setMenuOpen(false)
                enqueueWithToast(item, 'last', item, addToast)
              }}
              onClose={() => setMenuOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

