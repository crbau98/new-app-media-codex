import Hls, { XhrLoader } from "hls.js"
import { archiverEdgeProxyUrl, isArchiverDirectMediaUrl, shouldPreferArchiverEdgeProxy } from "./archiverMedia"
import { apiUrl, getPublicOrigin } from "./backendOrigin"
import { api } from "./api"

const COOMER_PLAYBACK_STALL_MS = 25_000
const COOMER_WATERFALL_ATTR = "data-coomer-waterfall"

/**
 * True when a coomer playback waterfall is currently cycling through fallback
 * URLs on this video element. Parent React components should skip their
 * `markMediaBroken()` / `setPlaybackFailed(true)` logic for intermediate
 * `error` events while this flag is set.
 */
export function isCoomerWaterfallActive(video: HTMLVideoElement | null | undefined): boolean {
  return Boolean(video && video.hasAttribute(COOMER_WATERFALL_ATTR))
}

/** Coomer/Kemono archiver videos — same CDN + resolve-stream / waterfall behavior. */
export function isArchiverVideoSource(source: string | undefined | null): boolean {
  const s = (source ?? "").toLowerCase().trim()
  return s === "coomer" || s === "coomer_video" || s === "kemono" || s === "kemono_video"
}

const PROXY_PATH = "/api/screenshots/proxy-media"
const PROXY_QUERY = "url="
const SCREENSHOTS_API_PREFIX = "/api/screenshots/"

/**
 * hls.js uses XHR against whatever string we pass. Relative `/api/...` paths hit the **page** origin
 * (e.g. Vercel), not the FastAPI host — break split deploys. Always use absolute backend URLs when
 * `VITE_BACKEND_ORIGIN` is set.
 */
function absoluteMediaRequestUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return pathOrUrl
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl
  if (pathOrUrl.startsWith("/")) return apiUrl(pathOrUrl)
  return pathOrUrl
}

/** Browsers block unmuted autoplay without a user gesture — always set before programmatic play(). */
function prepareAutoplay(video: HTMLVideoElement) {
  video.muted = true
  video.playsInline = true
  try {
    video.setAttribute("playsinline", "")
    video.setAttribute("webkit-playsinline", "")
  } catch {
    /* ignore */
  }
}

function attemptPlay(video: HTMLVideoElement) {
  prepareAutoplay(video)
  return video.play()
}

/**
 * True when the URL points at an HLS playlist (including proxied URLs that encode `.m3u8`).
 * We only match a path ending in `.m3u8`. A bare `/m3u8/i` substring anywhere in the URL
 * false-positived on long CDN/query strings and sent progressive MP4 through hls.js (blob:
 * src + infinite buffering).
 */
export function isHlsUrl(url: string | null | undefined): boolean {
  if (!url) return false
  let probe = url.trim()
  const marker = "/api/screenshots/proxy-media?url="
  const markerIdx = probe.indexOf(marker)
  if (markerIdx !== -1) {
    try {
      const encoded = probe.slice(markerIdx + marker.length).split("&")[0]
      probe = decodeURIComponent(encoded)
    } catch {
      return false
    }
  }
  try {
    const u = new URL(probe, "https://placeholder.invalid/")
    return /\.m3u8$/i.test(u.pathname)
  } catch {
    return /\.m3u8($|[?#])/i.test(probe)
  }
}

/**
 * hls.js resolves relative segment URIs against the playlist response URL. When the playlist
 * was fetched via `/api/screenshots/proxy-media?url=<encoded m3u8>`, that produces same-origin
 * paths like `/api/screenshots/segment001.ts?url=...` instead of CDN URLs. The erroneous path
 * still carries the real playlist URL in the inherited `url` query — use it to rebuild the
 * correct absolute segment URL, then normal proxying applies.
 */
function fixMisresolvedProxyRelativeUrl(url: string): string {
  if (!url || typeof window === "undefined") return url
  try {
    const u = new URL(url, getPublicOrigin())
    if (u.origin !== getPublicOrigin()) return url
    if (!u.pathname.startsWith(SCREENSHOTS_API_PREFIX)) return url
    const afterPrefix = u.pathname.slice(SCREENSHOTS_API_PREFIX.length)
    if (!afterPrefix || afterPrefix === "proxy-media" || afterPrefix.startsWith("proxy-media/")) {
      return url
    }
    const inner = u.searchParams.get("url")
    if (!inner) return url
    let playlistUrl: string
    try {
      playlistUrl = decodeURIComponent(inner)
    } catch {
      return url
    }
    if (!/^https?:\/\//i.test(playlistUrl)) return url
    const baseDir = new URL("./", playlistUrl).href
    return new URL(afterPrefix, baseDir).href
  } catch {
    return url
  }
}

/**
 * Route cross-origin media through our proxy so XHR (hls.js) avoids CDN CORS blocks.
 * Leaves same-origin proxy URLs and relative /api paths unchanged.
 */
export function rewriteMediaUrlForProxy(url: string): string {
  url = fixMisresolvedProxyRelativeUrl(url)
  if (!url) return url
  if (url.startsWith(`${PROXY_PATH}?${PROXY_QUERY}`)) {
    return absoluteMediaRequestUrl(url)
  }
  if (url.startsWith(PROXY_PATH + "?")) {
    return absoluteMediaRequestUrl(url)
  }
  if (typeof window !== "undefined") {
    try {
      const u = new URL(url, getPublicOrigin())
      if (u.origin === getPublicOrigin() && u.pathname.startsWith(PROXY_PATH)) {
        return absoluteMediaRequestUrl(u.pathname + u.search)
      }
    } catch {
      /* ignore */
    }
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    if (isArchiverDirectMediaUrl(url) && shouldPreferArchiverEdgeProxy()) {
      return archiverEdgeProxyUrl(url)
    }
    return absoluteMediaRequestUrl(`${PROXY_PATH}?${PROXY_QUERY}${encodeURIComponent(url)}`)
  }
  return url
}

function unwrapProxyMediaUrl(url: string | null | undefined): string {
  if (!url) return ""
  const probe = url.trim()
  const marker = `${PROXY_PATH}?${PROXY_QUERY}`
  const idx = probe.indexOf(marker)
  if (idx === -1) return probe
  try {
    const encoded = probe.slice(idx + marker.length).split("&")[0]
    return decodeURIComponent(encoded)
  } catch {
    return probe
  }
}

export type AttachMediaOptions = {
  /** Call `video.play()` once the stream is ready (HLS manifest parsed or metadata loaded). */
  tryAutoplay?: boolean
  /** HLS fatal network / media errors (after xhr rewrite, etc.). */
  onFatalError?: () => void
  /** Screenshot ID — if provided, enables pre-flight stream resolution & retry on expired tokens. */
  shotId?: number
  /** Screenshot source field (e.g. "ytdlp", "coomer"). Pre-flight resolve runs for sources that need refresh/fallback handling. */
  shotSource?: string
}

// ---------------------------------------------------------------------------
// In-flight resolve-stream dedup: if two components request a resolve for the
// same shot concurrently, share the same promise.
// ---------------------------------------------------------------------------
type ResolveResult = {
  local_url: string | null
  direct_url: string | null
  cached_url: string | null
  ip_bound: boolean
}

const _inflightResolves = new Map<number, Promise<ResolveResult | null>>()

/**
 * Ask the backend to resolve a fresh or cached stream URL for a video screenshot.
 * Returns the resolve result with local_url, direct_url, and ip_bound flag.
 */
async function resolveStreamUrl(shotId: number): Promise<ResolveResult | null> {
  const existing = _inflightResolves.get(shotId)
  if (existing) return existing

  const p = api.resolveStream(shotId)
    .then((res) => ({
      local_url: res.local_url || null,
      direct_url: res.direct_url != null && res.direct_url !== "" ? res.direct_url : null,
      cached_url: res.cached_url || null,
      ip_bound: res.ip_bound ?? false,
    }))
    .catch(() => null)
    .finally(() => { _inflightResolves.delete(shotId) })

  _inflightResolves.set(shotId, p)
  return p
}

/**
 * Attach progressive or HLS media to a <video> element. For `.m3u8` in Chrome/Firefox/Edge,
 * uses hls.js with **all** playlist/segment/key requests rewritten through `/api/screenshots/proxy-media`
 * so segment fetches are same-origin (CDN URLs in the m3u8 would otherwise fail CORS in XHR).
 * Safari/iOS: uses the same path when MSE is available; falls back to native HLS when not.
 *
 * When `shotId` is provided and the source is an HLS stream, a pre-flight resolve-stream
 * call ensures the CDN token is fresh before playback begins. On fatal HLS errors the
 * resolve is retried once and the player reloads.
 */
export function attachMediaSource(video: HTMLVideoElement, src: string, options?: AttachMediaOptions): () => void {
  const tryAutoplay = options?.tryAutoplay ?? false
  // Indirection so the coomer branch can intercept the "all URLs exhausted"
  // signal and start cache-status polling instead of giving up.
  let onFatalErrorRef: (() => void) | undefined = options?.onFatalError
  const onFatalError = () => onFatalErrorRef?.()
  const shotId = options?.shotId
  const shotSource = (options?.shotSource ?? "").toLowerCase().trim()
  // Some sources need a backend pre-flight before playback:
  // ytdlp for expiring tokens; archiver (coomer/kemono) for cached-file fallback + waterfall.
  const needsResolve = shotId != null && (shotSource === "ytdlp" || isArchiverVideoSource(shotSource))
  video.removeAttribute("src")

  // We track cleanup across async pre-flight + HLS instantiation.
  let destroyed = false
  let hls: Hls | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let stopCoomerWaterfall: (() => void) | null = null

  const tryPlay = () => {
    if (!tryAutoplay) return
    void attemptPlay(video).catch(() => {})
  }

  const cleanup = () => {
    destroyed = true
    stopCoomerWaterfall?.()
    stopCoomerWaterfall = null
    if (hls) {
      hls.destroy()
      hls = null
    }
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    video.removeAttribute("src")
    video.load()
  }

  /** Play a plain MP4/video URL directly (no HLS). */
  function playDirect(url: string) {
    if (destroyed) return
    video.src = absoluteMediaRequestUrl(url)
    const onMeta = () => {
      video.removeEventListener("loadedmetadata", onMeta)
      tryPlay()
    }
    video.addEventListener("loadedmetadata", onMeta)
  }

  /**
   * Coomer `n*` shards often block browser-direct HTTPS from some networks while
   * still allowing our Vercel Edge `/api/archiver-proxy` or the FastAPI
   * `proxy-media` hop (different egress / TCP path). Try those before raw CDN.
   */
  function buildCoomerPlaybackWaterfall(
    directUrl: string,
    localOrProxyFromApi: string,
    shotIdNum: number,
  ): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const push = (u: string) => {
      const t = u.trim()
      if (!t || seen.has(t)) return
      seen.add(t)
      out.push(t)
    }

    const raw = directUrl.trim()

    // 1. RAW coomer URL first — the browser's native MP4 fetch from the user's
    //    residential IP is the most reliable path for coomer (datacenter-based
    //    Vercel Edge and Render proxies are routinely blocked from n*.coomer.st).
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      push(raw)
    }

    // 2. Vercel Edge archiver-proxy with multi-shard fallback.
    if (shouldPreferArchiverEdgeProxy() && raw && isArchiverDirectMediaUrl(raw)) {
      push(archiverEdgeProxyUrl(raw))
    }

    // 3. Backend proxy-media (FastAPI) — works if ARCHIVER_PROXY_URL is set.
    const proxyHint = localOrProxyFromApi.trim()
    if (proxyHint.startsWith("/") || proxyHint.startsWith("http://") || proxyHint.startsWith("https://")) {
      push(proxyHint)
    } else if (raw.startsWith("http://") || raw.startsWith("https://")) {
      push(
        apiUrl(
          `${PROXY_PATH}?${PROXY_QUERY}${encodeURIComponent(raw)}&shot_id=${shotIdNum}`,
        ),
      )
    }

    return out
  }

  /**
   * Sequential playback attempts for coomer: Edge proxy → backend proxy → direct CDN.
   *
   * Critical subtlety: the React inline `<video onError>` handler in the parent
   * calls `markMediaBroken()` on EVERY `error` event, which changes `mediaSrc`
   * and re-runs the effect — destroying this waterfall before it can reach the
   * next URL. We mark the video element with a data attribute during the
   * waterfall; the parent handler (via `isCoomerWaterfallActive`) skips
   * `markMediaBroken` while that flag is set.
   */
  function playDirectWaterfall(urls: string[]) {
    if (destroyed || urls.length === 0) {
      onFatalError?.()
      return
    }

    let stallTimer: ReturnType<typeof setTimeout> | null = null
    let detachAttempt: (() => void) | null = null
    let succeeded = false

    video.setAttribute(COOMER_WATERFALL_ATTR, "1")

    const clearStall = () => {
      if (stallTimer) {
        clearTimeout(stallTimer)
        stallTimer = null
      }
    }

    const abort = () => {
      detachAttempt?.()
      detachAttempt = null
      clearStall()
      video.removeAttribute(COOMER_WATERFALL_ATTR)
      stopCoomerWaterfall = null
    }

    stopCoomerWaterfall = abort

    const tryIndex = (i: number) => {
      if (destroyed) return
      detachAttempt?.()
      detachAttempt = null
      clearStall()
      if (i >= urls.length) {
        abort()
        onFatalError?.()
        return
      }
      const url = urls[i]
      // Keep the flag active during load; only clear on final failure/success.
      if (!video.hasAttribute(COOMER_WATERFALL_ATTR)) {
        video.setAttribute(COOMER_WATERFALL_ATTR, "1")
      }
      video.removeAttribute("src")
      video.load()
      video.src = absoluteMediaRequestUrl(url)
      if (typeof console !== "undefined") {
        // One-line trace so deployment errors are diagnosable.
        // eslint-disable-next-line no-console
        console.debug(`[coomer-waterfall] ${i + 1}/${urls.length} trying ${url.slice(0, 140)}`)
      }

      const onErr = () => {
        if (succeeded) return
        detachAttempt?.()
        detachAttempt = null
        clearStall()
        tryIndex(i + 1)
      }

      const succeed = () => {
        if (succeeded) return
        succeeded = true
        detachAttempt?.()
        detachAttempt = null
        clearStall()
        video.removeAttribute(COOMER_WATERFALL_ATTR)
        stopCoomerWaterfall = null
        if (typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.debug(`[coomer-waterfall] \u2713 playable on URL ${i + 1}/${urls.length}`)
        }
        tryPlay()
      }

      const onMeta = () => succeed()
      const onCanPlay = () => succeed()

      const detach = () => {
        video.removeEventListener("error", onErr)
        video.removeEventListener("loadedmetadata", onMeta)
        video.removeEventListener("canplay", onCanPlay)
      }

      detachAttempt = detach
      video.addEventListener("error", onErr)
      video.addEventListener("loadedmetadata", onMeta)
      video.addEventListener("canplay", onCanPlay)
      // Stall timeout advances to the next URL if no error/canplay arrives.
      stallTimer = setTimeout(() => {
        if (succeeded || destroyed) return
        detachAttempt?.()
        detachAttempt = null
        stallTimer = null
        tryIndex(i + 1)
      }, COOMER_PLAYBACK_STALL_MS)
    }

    tryIndex(0)
  }

  // ── HLS setup (shared by ytdlp resolve path and non-ytdlp path) ─────────

  const hlsConfig: ConstructorParameters<typeof Hls>[0] = {
    enableWorker: false,
    lowLatencyMode: false,
    progressive: false,
    loader: XhrLoader,
    xhrSetup(xhr: XMLHttpRequest, url: string) {
      const proxied = rewriteMediaUrlForProxy(url)
      xhr.open("GET", proxied, true)
    },
    fetchSetup(context, initParams) {
      const u = rewriteMediaUrlForProxy(context.url)
      return new Request(u, initParams)
    },
  }

  /**
   * Create and start an hls.js instance for `hlsSrc`.
   */
  function startHls(hlsSrc: string) {
    if (destroyed) return

    if (Hls.isSupported()) {
      hls = new Hls(hlsConfig)
      hls.loadSource(absoluteMediaRequestUrl(hlsSrc))
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, tryPlay)

      const onError = (_: string, data: { fatal?: boolean; type?: string }) => {
        if (!data.fatal) return

        // Standard recovery attempts
        if (data.type === "networkError") {
          try { hls?.startLoad() } catch { onFatalError?.() }
          return
        }
        if (data.type === "mediaError") {
          try { hls?.recoverMediaError() } catch { onFatalError?.() }
          return
        }
        onFatalError?.()
      }
      hls!.on(Hls.Events.ERROR, onError)
      return
    }

    // Safari native HLS fallback
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = absoluteMediaRequestUrl(hlsSrc)
      const onMeta = () => {
        video.removeEventListener("loadedmetadata", onMeta)
        tryPlay()
      }
      video.addEventListener("loadedmetadata", onMeta)
      return
    }

    // Last resort
    video.src = absoluteMediaRequestUrl(hlsSrc)
    const onMeta = () => {
      video.removeEventListener("loadedmetadata", onMeta)
      tryPlay()
    }
    video.addEventListener("loadedmetadata", onMeta)
  }

  // ── Archiver (coomer/kemono): start the client waterfall immediately so playback
  // does not wait on resolve-stream (CORS / missing VITE_BACKEND_ORIGIN / slow API).
  // resolve-stream still runs in parallel for disk cache + server-side download.
  // ── backend pre-flight: resolve fresh/cached URL BEFORE deciding HLS vs MP4 ──
  if (needsResolve && isArchiverVideoSource(shotSource) && shotId != null) {
    const startCachePollArchiver = () => {
      if (destroyed) return
      if (pollTimer) return
      let pollCount = 0
      const maxPolls = 10
      pollTimer = setInterval(async () => {
        if (destroyed) { if (pollTimer) clearInterval(pollTimer); return }
        pollCount++
        if (pollCount >= maxPolls) {
          if (pollTimer) clearInterval(pollTimer)
          pollTimer = null
          onFatalError?.()
          return
        }
        const check = await resolveStreamUrl(shotId)
        if (destroyed) { if (pollTimer) clearInterval(pollTimer); return }
        if (check?.cached_url) {
          if (pollTimer) clearInterval(pollTimer)
          pollTimer = null
          playDirect(check.cached_url)
        }
      }, 3000)
    }

    void resolveStreamUrl(shotId).then((result) => {
      if (destroyed) return
      if (result?.cached_url) {
        stopCoomerWaterfall?.()
        playDirect(result.cached_url)
      }
    })

    const directUrl = unwrapProxyMediaUrl(src)
    const httpDirect = directUrl.startsWith("http") ? directUrl : src
    const seq = buildCoomerPlaybackWaterfall(httpDirect, src, shotId)
    if (seq.length >= 1) {
      const prevOnFatal = onFatalErrorRef
      onFatalErrorRef = () => {
        onFatalErrorRef = prevOnFatal
        if (destroyed) return
        startCachePollArchiver()
      }
      playDirectWaterfall(seq)
    } else {
      onFatalError?.()
    }
    return cleanup
  }

  if (needsResolve) {
    resolveStreamUrl(shotId!).then((result) => {
      if (destroyed) return
      if (result?.cached_url) {
        // Locally cached video — play MP4 directly
        playDirect(result.cached_url)
      } else if (result?.ip_bound) {
        const startCachePoll = () => {
          if (destroyed) return
          if (pollTimer) return
          let pollCount = 0
          const maxPolls = 10
          pollTimer = setInterval(async () => {
            if (destroyed) { if (pollTimer) clearInterval(pollTimer); return }
            pollCount++
            if (pollCount >= maxPolls) {
              if (pollTimer) clearInterval(pollTimer)
              pollTimer = null
              onFatalError?.()
              return
            }
            const check = await resolveStreamUrl(shotId!)
            if (destroyed) { if (pollTimer) clearInterval(pollTimer); return }
            if (check?.cached_url) {
              if (pollTimer) clearInterval(pollTimer)
              pollTimer = null
              playDirect(check.cached_url)
            }
          }, 3000)
        }

        startCachePoll()
      } else if (result?.local_url && isHlsUrl(result.local_url)) {
        // Non-IP-bound HLS — use hls.js
        startHls(result.local_url)
      } else if (result?.local_url) {
        // Non-IP-bound MP4 through proxy
        playDirect(result.local_url)
      } else {
        if (isHlsUrl(src)) {
          startHls(src)
        } else {
          playDirect(src)
        }
      }
    })
    // Return cleanup immediately — the async resolve will set up playback
    return cleanup
  }

  // ── Non-ytdlp: use original src directly ────────────────────────────────
  if (!isHlsUrl(src)) {
    playDirect(src)
    return cleanup
  }

  startHls(src)
  return cleanup
}
