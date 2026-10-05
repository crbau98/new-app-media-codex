import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type RefObject } from 'react'
import { resolveMediaAssetUrl } from '@/lib/backendOrigin'
import { averageRgb, parseHexColor, rgbCss, type BufferedRange } from '@/lib/player/controls'
import { readMediaIntel } from '@/lib/player/intel'
import { readNetworkProfile, type NetworkProfile } from '@/lib/player/resilience'
import { buildSources, type PlaybackSource } from '@/lib/player/sources'
import type { MediaItem } from '@/lib/types'
import { useAppStore } from '@/store'

/* ── environment ───────────────────────────────────────────────── */

type NavigatorWithConnection = Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }

export function readNetwork(): NetworkProfile {
  if (typeof navigator === 'undefined') return readNetworkProfile(null)
  return readNetworkProfile((navigator as NavigatorWithConnection).connection)
}

export function prefersMobilePlayback(): boolean {
  if (typeof window === 'undefined') return false
  const compactOrTouch = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches
  const network = readNetwork()
  return compactOrTouch || network.saveData || network.slow
}

export { useMotionOk } from '@/hooks/useMotionOk'

/**
 * The ordered playback source chain for an item (HLS / progressive fallbacks,
 * filtered by what this device can decode and the viewer's quality choice).
 * Shared by the full player and the dock's mini player.
 */
export function usePlaybackSources(item: MediaItem): PlaybackSource[] {
  const quality = useAppStore((state) => state.defaultQuality)
  const intel = useMemo(() => readMediaIntel(item), [item])
  const { mediaUrl, streamCandidates } = item
  return useMemo(
    () =>
      buildSources({
        mediaUrl,
        streamCandidates,
        hlsUrl: intel.hlsUrl,
        mimeType: intel.mimeType,
        codec: intel.codec,
        quality,
        preferMobile: quality === 'auto' && prefersMobilePlayback(),
        resolve: resolveMediaAssetUrl,
        probe: typeof document !== 'undefined' ? document.createElement('video') : null,
      }),
    [mediaUrl, streamCandidates, intel.hlsUrl, intel.mimeType, intel.codec, quality],
  )
}

/* ── <video> state as an external store ────────────────────────── */

export interface VideoState {
  currentTime: number
  duration: number
  buffered: BufferedRange[]
  volume: number
  muted: boolean
  rate: number
  loop: boolean
  paused: boolean
  ended: boolean
}

const EMPTY_STATE: VideoState = {
  currentTime: 0,
  duration: 0,
  buffered: [],
  volume: 1,
  muted: false,
  rate: 1,
  loop: false,
  paused: true,
  ended: false,
}

const VIDEO_EVENTS = [
  'timeupdate', 'durationchange', 'progress', 'volumechange', 'ratechange', 'play', 'pause', 'ended',
  'seeked', 'seeking', 'loadedmetadata', 'emptied', 'canplay',
] as const

function readBuffered(video: HTMLVideoElement): BufferedRange[] {
  const out: BufferedRange[] = []
  try {
    for (let i = 0; i < video.buffered.length; i += 1) out.push({ start: video.buffered.start(i), end: video.buffered.end(i) })
  } catch {
    // detached/reset element
  }
  return out
}

function sameBuffered(a: BufferedRange[], b: BufferedRange[]) {
  return a.length === b.length && a.every((range, i) => range.start === b[i].start && range.end === b[i].end)
}

function createVideoStore(video: HTMLVideoElement) {
  let snapshot: VideoState = EMPTY_STATE
  const read = (): VideoState => ({
    currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    buffered: readBuffered(video),
    volume: video.volume,
    muted: video.muted,
    rate: video.playbackRate,
    loop: video.loop,
    paused: video.paused,
    ended: video.ended,
  })
  snapshot = read()
  return {
    subscribe(callback: () => void) {
      const update = () => {
        const next = read()
        const prev = snapshot
        const changed =
          prev.currentTime !== next.currentTime || prev.duration !== next.duration || prev.volume !== next.volume ||
          prev.muted !== next.muted || prev.rate !== next.rate || prev.loop !== next.loop || prev.paused !== next.paused ||
          prev.ended !== next.ended || !sameBuffered(prev.buffered, next.buffered)
        if (!changed) return
        snapshot = next
        callback()
      }
      VIDEO_EVENTS.forEach((type) => video.addEventListener(type, update))
      return () => VIDEO_EVENTS.forEach((type) => video.removeEventListener(type, update))
    },
    getSnapshot: () => snapshot,
  }
}

const NOOP_STORE = { subscribe: () => () => {}, getSnapshot: () => EMPTY_STATE }

/** Live, throttled-by-events view of a video element for the controls UI. */
export function useVideoState(video: HTMLVideoElement | null): VideoState {
  const store = useMemo(() => (video ? createVideoStore(video) : NOOP_STORE), [video])
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_STATE)
}

/* ── wake lock ─────────────────────────────────────────────────── */

type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (type: string, cb: () => void) => void }
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }

/** Keep the screen awake while `active`; re-acquires after tab visibility changes. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const api = (navigator as WakeLockNavigator).wakeLock
    if (!active || !api) return undefined
    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false
    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible' || sentinel) return
      try {
        const next = await api.request('screen')
        if (cancelled) {
          void next.release().catch(() => {})
          return
        }
        sentinel = next
        next.addEventListener?.('release', () => {
          if (sentinel === next) sentinel = null
        })
      } catch {
        // permission denied / battery saver — non-critical
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => {})
      sentinel = null
    }
  }, [active])
}

/* ── pause on hide ─────────────────────────────────────────────── */

type PipDocument = Document & { pictureInPictureElement?: Element | null }

export function usePauseWhenHidden(video: HTMLVideoElement | null) {
  useEffect(() => {
    if (!video) return undefined
    const onHide = () => {
      if (document.visibilityState !== 'hidden' || video.paused) return
      // Picture-in-Picture (or iOS PiP presentation) keeps playing by design.
      if ((document as PipDocument).pictureInPictureElement === video) return
      const webkitMode = (video as HTMLVideoElement & { webkitPresentationMode?: string }).webkitPresentationMode
      if (webkitMode === 'picture-in-picture') return
      video.pause()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [video])
}

/* ── Media Session ─────────────────────────────────────────────── */

export function useMediaSession(
  video: HTMLVideoElement | null,
  meta: { title: string; artist: string; album: string; artwork?: string },
  actions: { onPrev?: () => void; onNext?: () => void },
) {
  const { title, artist, album, artwork } = meta
  const { onPrev, onNext } = actions
  useEffect(() => {
    if (!video || !('mediaSession' in navigator)) return undefined
    const session = navigator.mediaSession
    try {
      session.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork: artwork ? [{ src: artwork, sizes: '512x512' }] : [],
      })
    } catch {
      // MediaMetadata unsupported/blocked
    }
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        session.setActionHandler(action, handler)
      } catch {
        // action not supported on this browser
      }
    }
    set('play', () => void video.play().catch(() => {}))
    set('pause', () => video.pause())
    set('seekbackward', (details) => {
      video.currentTime = Math.max(0, video.currentTime - (details.seekOffset || 10))
    })
    set('seekforward', (details) => {
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + (details.seekOffset || 10))
    })
    set('seekto', (details) => {
      if (typeof details.seekTime === 'number') video.currentTime = details.seekTime
    })
    set('previoustrack', onPrev ?? null)
    set('nexttrack', onNext ?? null)

    let last = 0
    const position = () => {
      const now = Date.now()
      if (now - last < 1000 || !Number.isFinite(video.duration) || video.duration <= 0) return
      last = now
      try {
        session.setPositionState({ duration: video.duration, position: Math.min(video.currentTime, video.duration), playbackRate: video.playbackRate || 1 })
      } catch {
        // invalid state during source swaps
      }
    }
    const state = () => {
      session.playbackState = video.paused ? 'paused' : 'playing'
    }
    video.addEventListener('timeupdate', position)
    video.addEventListener('play', state)
    video.addEventListener('pause', state)
    return () => {
      video.removeEventListener('timeupdate', position)
      video.removeEventListener('play', state)
      video.removeEventListener('pause', state)
      for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as const) set(action, null)
      try {
        session.metadata = null
        session.playbackState = 'none'
      } catch {
        // ignore
      }
    }
  }, [video, title, artist, album, artwork, onPrev, onNext])
}

/* ── ambient cinema glow ───────────────────────────────────────── */

/**
 * Samples the playing video into a 16×9 canvas at ~10 fps and writes the
 * average colour to `--glow` on the glow element (no React re-renders).
 * Falls back to the item's dominantColor when sampling is off or the canvas
 * is tainted by a cross-origin source.
 */
export function useAmbientGlow(
  video: HTMLVideoElement | null,
  glowRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  fallbackHex?: string,
) {
  useEffect(() => {
    const el = glowRef.current
    if (!el) return undefined
    const fallback = parseHexColor(fallbackHex)
    if (fallback) el.style.setProperty('--glow', rgbCss(fallback))
    if (!enabled || !video) return undefined

    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 9
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return undefined
    let tainted = false
    const sample = () => {
      if (tainted || video.readyState < 2 || !video.videoWidth) return
      try {
        context.drawImage(video, 0, 0, 16, 9)
        el.style.setProperty('--glow', rgbCss(averageRgb(context.getImageData(0, 0, 16, 9).data)))
      } catch {
        tainted = true
      }
    }
    const tick = () => {
      if (!document.hidden && !video.paused) sample()
    }
    const timer = window.setInterval(tick, 100)
    video.addEventListener('seeked', sample)
    video.addEventListener('loadeddata', sample)
    video.addEventListener('pause', sample)
    return () => {
      window.clearInterval(timer)
      video.removeEventListener('seeked', sample)
      video.removeEventListener('loadeddata', sample)
      video.removeEventListener('pause', sample)
    }
  }, [video, glowRef, enabled, fallbackHex])
}

/* ── fullscreen (element, or iOS native video) ─────────────────── */

type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }
type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void }
type WebkitVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void
  webkitExitFullscreen?: () => void
  webkitDisplayingFullscreen?: boolean
}

export function useFullscreen(containerRef: RefObject<HTMLElement | null>, video: HTMLVideoElement | null) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    const sync = () => {
      const doc = document as FullscreenDocument
      const element = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null
      setActive(Boolean(container && element === container) || Boolean((video as WebkitVideo | null)?.webkitDisplayingFullscreen))
    }
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    // iOS Safari: the <video> enters its own native fullscreen player.
    let wasPlaying = false
    const onBegin = () => {
      wasPlaying = Boolean(video && !video.paused)
      setActive(true)
    }
    const onEnd = () => {
      setActive(false)
      // iOS pauses on exit; restore the state the viewer left it in.
      if (video && wasPlaying) void video.play().catch(() => {})
    }
    video?.addEventListener('webkitbeginfullscreen', onBegin)
    video?.addEventListener('webkitendfullscreen', onEnd)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
      video?.removeEventListener('webkitbeginfullscreen', onBegin)
      video?.removeEventListener('webkitendfullscreen', onEnd)
    }
  }, [containerRef, video])

  const toggle = useCallback(async () => {
    const container = containerRef.current as FullscreenElement | null
    const doc = document as FullscreenDocument
    const webkitVideo = video as WebkitVideo | null
    try {
      if (document.fullscreenElement || doc.webkitFullscreenElement) {
        await (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())
        ;(screen.orientation as ScreenOrientation & { unlock?: () => void } | undefined)?.unlock?.()
        return
      }
      if (webkitVideo?.webkitDisplayingFullscreen) {
        webkitVideo.webkitExitFullscreen?.()
        return
      }
      if (container?.requestFullscreen) {
        await container.requestFullscreen({ navigationUI: 'hide' })
      } else if (container?.webkitRequestFullscreen) {
        await container.webkitRequestFullscreen()
      } else if (webkitVideo?.webkitEnterFullscreen) {
        webkitVideo.webkitEnterFullscreen()
        return
      }
      // Landscape clips read best in landscape; ignore where unsupported.
      if (video && video.videoWidth > video.videoHeight) {
        const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
        await orientation?.lock?.('landscape').catch(() => {})
      }
    } catch {
      // Fullscreen denied (iframe policy / gesture lost) — silently keep the inline player.
      if (webkitVideo?.webkitEnterFullscreen) {
        try {
          webkitVideo.webkitEnterFullscreen()
        } catch {
          // nothing else to try
        }
      }
    }
  }, [containerRef, video])

  const supported =
    typeof document !== 'undefined' &&
    Boolean(document.fullscreenEnabled || (document as FullscreenDocument & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled || (video as WebkitVideo | null)?.webkitEnterFullscreen)

  return { active, toggle, supported }
}

/* ── picture in picture ────────────────────────────────────────── */

type PipVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean
  webkitSetPresentationMode?: (mode: string) => void
  webkitPresentationMode?: string
}

export function usePictureInPicture(video: HTMLVideoElement | null, enabled: boolean) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!video) return undefined
    const enter = () => setActive(true)
    const leave = () => setActive(false)
    const webkit = () => setActive((video as PipVideo).webkitPresentationMode === 'picture-in-picture')
    video.addEventListener('enterpictureinpicture', enter)
    video.addEventListener('leavepictureinpicture', leave)
    video.addEventListener('webkitpresentationmodechanged', webkit)
    return () => {
      video.removeEventListener('enterpictureinpicture', enter)
      video.removeEventListener('leavepictureinpicture', leave)
      video.removeEventListener('webkitpresentationmodechanged', webkit)
    }
  }, [video])

  const webkitVideo = video as PipVideo | null
  const supported =
    enabled &&
    Boolean(video) &&
    ((document.pictureInPictureEnabled && !video?.disablePictureInPicture) || Boolean(webkitVideo?.webkitSupportsPresentationMode?.('picture-in-picture')))

  const toggle = useCallback(async () => {
    if (!video) return
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture()
      } else if (document.pictureInPictureEnabled && !video.disablePictureInPicture) {
        await video.requestPictureInPicture()
      } else if (webkitVideo?.webkitSetPresentationMode) {
        webkitVideo.webkitSetPresentationMode(webkitVideo.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture')
      }
    } catch {
      // PiP refused (no metadata yet / policy) — leave inline
    }
  }, [video, webkitVideo])

  return { active, supported, toggle }
}
