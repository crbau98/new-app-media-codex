/**
 * Framework-free playback engine. Owns one <video>, walks the source chain
 * (HLS via lazy hls.js, native HLS on Safari, progressive files), and keeps
 * the viewer's position + play state across every source swap, retry and
 * quality change. React reads it through useSyncExternalStore.
 */
import type HlsType from 'hls.js'
import type { ErrorData, Level } from 'hls.js'
import { loadProgress, recordProgress } from '@/lib/collections'
import type { MediaItem } from '@/lib/types'
import { backoffDelay, classifyMediaError, resumePosition, STALL_KIND, type ClassifiedError } from '@/lib/player/resilience'
import { fileQualityOptions, preferSource, type PlaybackSource } from '@/lib/player/sources'

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'buffering' | 'recovering' | 'error'

export interface QualityOption {
  id: string
  label: string
}

export interface EngineSnapshot {
  status: EngineStatus
  errorMessage: string
  sourceIndex: number
  sourceCount: number
  /** True once playback moved to a source other than the first choice. */
  usingFallback: boolean
  qualityOptions: QualityOption[]
  /** 'auto' or a QualityOption id. */
  activeQuality: string
  /** Quality label actually rendering (auto → current HLS level / file label). */
  playingLabel: string
  frameReady: boolean
  paused: boolean
  resumedAt: number | null
  /** The user's tap was blocked by autoplay policy and we fell back to muted. */
  autoMuted: boolean
}

export interface EngineConfig {
  item: MediaItem
  autoplay: boolean
  /** Extra time budget on constrained links. */
  slowNetwork: boolean
  /** Legacy archived-media recovery; resolves alternative sources or null. */
  legacyRecover: () => Promise<PlaybackSource[] | null>
  /**
   * Explicit start position in seconds (saved moment, dock hand-off). When set
   * — even to 0 — it wins over the stored resume position.
   */
  startAt?: number
}

interface Carry {
  time: number
  play: boolean
}

const MAX_SAME_SOURCE_RETRIES = 2

function isAppleWebKit(): boolean {
  const ua = navigator.userAgent
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|Android|CriOS|FxiOS/.test(ua)
}

export class PlayerEngine {
  private video: HTMLVideoElement | null = null
  private config: EngineConfig | null = null
  private initialSources: PlaybackSource[] = []
  private sources: PlaybackSource[] = []
  private index = 0
  private carry: Carry = { time: 0, play: false }
  private firstLoad = true
  private explicitStart = false
  private hls: HlsType | null = null
  private generation = 0
  private sameSourceRetries = 0
  private retryTimer: number | null = null
  private watchdog: number | null = null
  private frameCallback: number | null = null
  private legacyTried = false
  private lastSave = 0
  private listeners = new Set<() => void>()
  private cleanup: Array<() => void> = []
  private manualQuality = 'auto'

  private snap: EngineSnapshot = {
    status: 'idle',
    errorMessage: '',
    sourceIndex: 0,
    sourceCount: 0,
    usingFallback: false,
    qualityOptions: [],
    activeQuality: 'auto',
    playingLabel: '',
    frameReady: false,
    paused: true,
    resumedAt: null,
    autoMuted: false,
  }

  /* ── external-store plumbing ─────────────────────────────────── */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): EngineSnapshot => this.snap

  private patch(next: Partial<EngineSnapshot>) {
    let changed = false
    for (const key of Object.keys(next) as Array<keyof EngineSnapshot>) {
      if (this.snap[key] !== next[key]) {
        changed = true
        break
      }
    }
    if (!changed) return
    this.snap = { ...this.snap, ...next }
    this.listeners.forEach((listener) => listener())
  }

  /* ── lifecycle ───────────────────────────────────────────────── */

  /** Ref callback target for the <video> element. */
  bind = (element: HTMLVideoElement | null) => {
    if (element === this.video) return
    this.unbindEvents()
    this.video = element
    if (element) {
      this.bindEvents(element)
      if (this.sources.length) this.attach()
    }
  }

  /** Start (or restart) playback of a source chain for the given item. */
  configure(config: EngineConfig, sources: PlaybackSource[]) {
    this.teardownMedia()
    this.config = config
    this.initialSources = sources
    this.sources = sources
    this.index = 0
    this.firstLoad = true
    this.explicitStart = typeof config.startAt === 'number'
    this.legacyTried = false
    this.sameSourceRetries = 0
    this.manualQuality = 'auto'
    this.carry = { time: config.startAt && config.startAt > 0 ? config.startAt : 0, play: config.autoplay }
    this.patch({
      status: sources.length ? 'loading' : 'error',
      errorMessage: sources.length ? '' : 'No playable stream for this item.',
      sourceIndex: 0,
      sourceCount: sources.length,
      usingFallback: false,
      qualityOptions: fileQualityOptions(sources).length > 1 ? this.fileOptions(sources) : [],
      activeQuality: 'auto',
      playingLabel: sources[0]?.label ?? '',
      frameReady: false,
      paused: true,
      resumedAt: null,
      autoMuted: false,
    })
    if (sources.length && this.video) this.attach()
  }

  updateConfig(partial: Partial<EngineConfig>) {
    if (this.config) this.config = { ...this.config, ...partial }
  }

  /** Stop and release media (effect cleanup); the element stays bound so StrictMode/remount can restart. */
  stop() {
    this.saveProgress(true)
    this.teardownMedia()
  }

  /* ── public controls ─────────────────────────────────────────── */

  play() {
    const video = this.video
    if (!video) return
    this.carry.play = true
    if (this.snap.status === 'error') return
    video.play().catch((error: unknown) => this.handlePlayRejection(error))
  }

  pause() {
    this.carry.play = false
    this.video?.pause()
  }

  toggle() {
    if (!this.video) return
    if (this.video.paused) this.play()
    else this.pause()
  }

  /** Manual retry from the error UI: restart the whole chain at the last position. */
  retry() {
    const time = this.currentPosition()
    this.legacyTried = false
    this.sources = this.initialSources
    this.index = 0
    this.sameSourceRetries = 0
    this.carry = { time, play: true }
    this.patch({ status: 'loading', errorMessage: '', sourceIndex: 0, sourceCount: this.sources.length, usingFallback: false })
    this.attach()
  }

  setQuality(id: string) {
    this.manualQuality = id
    this.patch({ activeQuality: id })
    const hls = this.hls
    if (hls) {
      hls.currentLevel = id === 'auto' ? -1 : Number(id.replace('level:', ''))
      return
    }
    if (id === 'auto') {
      this.switchTo(this.initialSources, 0)
      return
    }
    const chosen = this.sources.find((source) => source.url === id) ?? this.initialSources.find((source) => source.url === id)
    if (chosen) this.switchTo(preferSource(this.initialSources, chosen.url), 0)
  }

  /* ── internals ───────────────────────────────────────────────── */

  private fileOptions(sources: PlaybackSource[]): QualityOption[] {
    return fileQualityOptions(sources).map((option) => ({ id: option.url, label: option.label }))
  }

  private currentPosition(): number {
    const video = this.video
    const t = video && Number.isFinite(video.currentTime) ? video.currentTime : 0
    return t > 0 ? t : this.carry.time
  }

  private wasPlaying(): boolean {
    const video = this.video
    return Boolean(video && !video.paused && !video.ended) || (this.carry.play && (!video || video.currentTime < 0.1))
  }

  /** Swap chain/index, carrying position and play state across the change. */
  private switchTo(sources: PlaybackSource[], index: number, patch: Partial<EngineSnapshot> = {}) {
    this.carry = { time: this.currentPosition(), play: this.wasPlaying() }
    this.sources = sources
    this.index = index
    this.sameSourceRetries = 0
    this.patch({
      status: 'loading',
      sourceIndex: index,
      sourceCount: sources.length,
      usingFallback: sources !== this.initialSources || index > 0,
      playingLabel: sources[index]?.label ?? '',
      frameReady: false,
      ...patch,
    })
    this.attach()
  }

  private clearTimers() {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer)
    if (this.watchdog !== null) window.clearTimeout(this.watchdog)
    this.retryTimer = null
    this.watchdog = null
    const video = this.video
    if (this.frameCallback !== null && video?.cancelVideoFrameCallback) video.cancelVideoFrameCallback(this.frameCallback)
    this.frameCallback = null
  }

  private teardownMedia() {
    this.generation += 1
    this.clearTimers()
    if (this.hls) {
      try {
        this.hls.destroy()
      } catch {
        // ignore — already torn down
      }
      this.hls = null
    }
    const video = this.video
    if (video) {
      video.removeAttribute('src')
      try {
        video.load()
      } catch {
        // jsdom / detached element
      }
    }
  }

  private armWatchdog(ms: number) {
    if (this.watchdog !== null) window.clearTimeout(this.watchdog)
    const slow = this.config?.slowNetwork ? 1.6 : 1
    this.watchdog = window.setTimeout(() => this.handleFailure(STALL_KIND), ms * slow)
  }

  private clearWatchdog() {
    if (this.watchdog !== null) window.clearTimeout(this.watchdog)
    this.watchdog = null
  }

  private async attach() {
    const video = this.video
    const source = this.sources[this.index]
    if (!video || !source) return
    const generation = ++this.generation
    this.clearTimers()
    if (this.hls) {
      this.hls.destroy()
      this.hls = null
    }
    this.armWatchdog(source.kind === 'hls' ? 16000 : 12000)

    if (source.kind === 'hls') {
      const preferNative = Boolean(video.canPlayType('application/vnd.apple.mpegurl')) && (!('MediaSource' in window) || isAppleWebKit())
      if (preferNative) {
        video.src = source.url
        video.load()
        return
      }
      try {
        const mod = await import('hls.js/light')
        if (generation !== this.generation) return
        const Hls = mod.default
        if (!Hls.isSupported()) {
          this.handleFailure({ kind: 'unsupported', retrySame: false, nextSource: true, message: 'Adaptive streaming is not supported here.' })
          return
        }
        this.attachHls(Hls, source, generation)
      } catch {
        if (generation === this.generation) this.handleFailure(classifyMediaError(4))
      }
      return
    }

    video.src = source.url
    video.load()
  }

  private attachHls(Hls: typeof HlsType, source: PlaybackSource, generation: number) {
    const video = this.video
    if (!video) return
    const hls = new Hls({
      // Blob workers are blocked by the site CSP; the main thread is fine for short clips.
      enableWorker: false,
      startPosition: this.carry.time > 0.5 ? this.carry.time : -1,
      capLevelToPlayerSize: true,
      maxBufferLength: 30,
      lowLatencyMode: false,
    })
    this.hls = hls
    hls.on(Hls.Events.MANIFEST_PARSED, (_event: string, data: { levels: Level[] }) => {
      if (generation !== this.generation) return
      const seen = new Set<number>()
      const options: QualityOption[] = []
      data.levels.forEach((level, levelIndex) => {
        const height = level.height || 0
        if (!height || seen.has(height)) return
        seen.add(height)
        options.push({ id: `level:${levelIndex}`, label: `${height}p` })
      })
      options.sort((a, b) => parseInt(b.label, 10) - parseInt(a.label, 10))
      this.patch({ qualityOptions: options })
      if (this.manualQuality !== 'auto') this.setQuality(this.manualQuality)
    })
    hls.on(Hls.Events.LEVEL_SWITCHED, (_event: string, data: { level: number }) => {
      if (generation !== this.generation) return
      const level = hls.levels[data.level]
      if (level?.height) this.patch({ playingLabel: `${level.height}p` })
    })
    hls.on(Hls.Events.ERROR, (_event: string, data: ErrorData) => {
      if (generation !== this.generation || !data.fatal) return
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && this.sameSourceRetries < MAX_SAME_SOURCE_RETRIES) {
        this.sameSourceRetries += 1
        const attempt = this.sameSourceRetries
        this.patch({ status: 'recovering' })
        this.retryTimer = window.setTimeout(() => hls.startLoad(), backoffDelay(attempt - 1))
        return
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this.sameSourceRetries < MAX_SAME_SOURCE_RETRIES) {
        this.sameSourceRetries += 1
        hls.recoverMediaError()
        return
      }
      this.handleFailure(classifyMediaError(data.type === Hls.ErrorTypes.MEDIA_ERROR ? 3 : 2), true)
    })
    hls.loadSource(source.url)
    hls.attachMedia(video)
  }

  /** A load/decode/stall failure: retry the same source with backoff, else advance. */
  private handleFailure(error: ClassifiedError, skipRetry = false) {
    if (error.kind === 'aborted') return
    this.clearWatchdog()
    this.clearFrameWatch()
    if (error.retrySame && !skipRetry && this.sameSourceRetries < MAX_SAME_SOURCE_RETRIES) {
      const attempt = this.sameSourceRetries
      this.sameSourceRetries += 1
      this.carry = { time: this.currentPosition(), play: this.wasPlaying() }
      this.patch({ status: 'recovering' })
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null
        this.patch({ status: 'loading' })
        this.attach()
      }, backoffDelay(attempt))
      return
    }
    void this.advance(error)
  }

  private clearFrameWatch() {
    const video = this.video
    if (this.frameCallback !== null && video?.cancelVideoFrameCallback) video.cancelVideoFrameCallback(this.frameCallback)
    this.frameCallback = null
  }

  private async advance(error: ClassifiedError) {
    if (this.index + 1 < this.sources.length) {
      this.switchTo(this.sources, this.index + 1)
      return
    }
    if (!this.legacyTried && this.config) {
      this.legacyTried = true
      this.carry = { time: this.currentPosition(), play: this.wasPlaying() }
      this.patch({ status: 'recovering' })
      const generation = this.generation
      const alternatives = await this.config.legacyRecover().catch(() => null)
      if (generation !== this.generation) return
      if (alternatives?.length) {
        this.initialSources = alternatives
        this.switchTo(alternatives, 0, { qualityOptions: this.fileOptions(alternatives) })
        return
      }
    }
    this.patch({ status: 'error', errorMessage: error.message, paused: true })
  }

  private handlePlayRejection(error: unknown) {
    const video = this.video
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'AbortError') return
    if (name === 'NotAllowedError') {
      // Autoplay policy: retry muted once so the click/open still produces motion.
      if (video && !video.muted) {
        video.muted = true
        this.patch({ autoMuted: true })
        video.play().catch(() => this.patch({ paused: true }))
      } else {
        this.patch({ paused: true })
      }
      return
    }
    this.handleFailure(classifyMediaError(4))
  }

  /* ── media events ────────────────────────────────────────────── */

  private bindEvents(video: HTMLVideoElement) {
    const on = (type: string, handler: (event: Event) => void) => {
      video.addEventListener(type, handler)
      this.cleanup.push(() => video.removeEventListener(type, handler))
    }

    on('loadedmetadata', () => {
      const { time } = this.carry
      let target = time
      if (this.firstLoad) {
        this.firstLoad = false
        const entry = this.config ? loadProgress()[this.config.item.id] : undefined
        const resume = resumePosition(entry, video.duration)
        if (resume && !(target > 0) && !this.explicitStart) {
          target = resume
          this.patch({ resumedAt: resume })
        }
      }
      if (target > 0.25 && Number.isFinite(video.duration) && target < video.duration - 0.25) {
        try {
          video.currentTime = target
        } catch {
          // seeking before metadata on some engines — the canplay hook retries
        }
      }
    })

    on('loadeddata', () => {
      this.sameSourceRetries = 0
      if (this.carry.play && video.paused) video.play().catch((error: unknown) => this.handlePlayRejection(error))
      this.patch({ status: video.paused ? 'ready' : this.snap.status })
    })

    on('canplay', () => {
      if (this.snap.status === 'loading' || this.snap.status === 'buffering' || this.snap.status === 'recovering') this.patch({ status: 'ready' })
      if (!video.paused) this.clearWatchdog()
    })

    on('playing', () => {
      this.carry.play = true
      this.patch({ status: 'ready', paused: false })
      this.clearWatchdog()
      if (!this.snap.frameReady) this.watchFirstFrame(video)
    })

    on('pause', () => {
      this.patch({ paused: true })
      this.saveProgress(true)
    })

    on('ended', () => {
      this.patch({ paused: true })
      this.saveProgress(true)
    })

    const buffering = () => {
      if (video.paused || video.ended) return
      this.patch({ status: 'buffering' })
      this.armWatchdog(10000)
    }
    on('waiting', buffering)
    on('stalled', buffering)

    on('timeupdate', () => {
      if (video.currentTime > 0 && !this.snap.frameReady && !video.paused) this.patch({ frameReady: true })
      if (this.snap.status === 'buffering' && !video.paused) {
        this.patch({ status: 'ready' })
        this.clearWatchdog()
      }
      this.saveProgress(false)
    })

    on('error', () => {
      // hls.js drives its own errors; a native <video> error while it is attached is a media failure too.
      const code = video.error?.code
      if (this.hls || !video.getAttribute('src')) return
      this.handleFailure(classifyMediaError(code))
    })
  }

  private watchFirstFrame(video: HTMLVideoElement) {
    if (video.requestVideoFrameCallback) {
      this.armWatchdog(7000)
      this.frameCallback = video.requestVideoFrameCallback(() => {
        this.frameCallback = null
        this.clearWatchdog()
        this.patch({ frameReady: true })
      })
      return
    }
    this.patch({ frameReady: true })
  }

  private unbindEvents() {
    this.cleanup.forEach((fn) => fn())
    this.cleanup = []
  }

  private saveProgress(force: boolean) {
    const video = this.video
    const item = this.config?.item
    if (!video || !item || video.currentTime < 1) return
    const now = Date.now()
    if (!force && now - this.lastSave < 5000) return
    this.lastSave = now
    recordProgress(item, video.currentTime)
  }
}
