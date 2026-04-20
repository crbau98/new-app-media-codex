import Hls, { XhrLoader } from "hls.js"
import { isArchiverDirectMediaUrl, shouldPreferArchiverEdgeProxy } from "./archiverMedia"
import { apiUrl, getPublicOrigin } from "./backendOrigin"
import { api } from "./api"

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
    if (isArchiverDirectMediaUrl(url) && typeof window !== "undefined" && shouldPreferArchiverEdgeProxy()) {
      return `${window.location.origin}/api/archiver-proxy?url=${encodeURIComponent(url)}`
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
  /** Screenshot source field (e.g. "ytdlp", "coomer"). Pre-flight resolve only runs for "ytdlp". */
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
  const onFatalError = options?.onFatalError
  const shotId = options?.shotId
  const shotSource = (options?.shotSource ?? "").toLowerCase()
  // Some sources need a backend pre-flight before playback:
  // ytdlp for expiring tokens, coomer for cached-file fallback when proxying fails.
  const needsResolve = shotId != null && (shotSource === "ytdlp" || shotSource === "coomer")
  video.removeAttribute("src")

  // We track cleanup across async pre-flight + HLS instantiation.
  let destroyed = false
  let hls: Hls | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const tryPlay = () => {
    if (!tryAutoplay) return
    void attemptPlay(video).catch(() => {})
  }

  const cleanup = () => {
    destroyed = true
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

  // ── backend pre-flight: resolve fresh/cached URL BEFORE deciding HLS vs MP4 ──
  if (needsResolve) {
    resolveStreamUrl(shotId!).then((result) => {
      if (destroyed) return
      if (result?.cached_url) {
        // Locally cached video — play MP4 directly
        playDirect(result.cached_url)
      } else if (result?.ip_bound) {
        if (shotSource === "coomer") {
          const directFromApi = (result.direct_url ?? "").trim()
          if (directFromApi.startsWith("http://") || directFromApi.startsWith("https://")) {
            playDirect(directFromApi)
            return
          }
          const directUrl = unwrapProxyMediaUrl(result.local_url || src)
          if (directUrl.startsWith("http://") || directUrl.startsWith("https://")) {
            playDirect(directUrl)
            return
          }
        }
        // IP-bound but not yet cached — download in progress on server
        // Poll every 3 seconds for up to 90 seconds for the cache to complete
        let pollCount = 0
        const maxPolls = 30
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
      } else if (result?.local_url && isHlsUrl(result.local_url)) {
        // Non-IP-bound HLS — use hls.js
        startHls(result.local_url)
      } else if (result?.local_url) {
        // Non-IP-bound MP4 through proxy
        playDirect(result.local_url)
      } else {
        // Fallback to original src
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
