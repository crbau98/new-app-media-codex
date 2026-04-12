import Hls, { XhrLoader } from "hls.js"
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
    return absoluteMediaRequestUrl(`${PROXY_PATH}?${PROXY_QUERY}${encodeURIComponent(url)}`)
  }
  return url
}

export type AttachMediaOptions = {
  /** Call `video.play()` once the stream is ready (HLS manifest parsed or metadata loaded). */
  tryAutoplay?: boolean
  /** HLS fatal network / media errors (after xhr rewrite, etc.). */
  onFatalError?: () => void
  /** Screenshot ID — if provided, enables pre-flight stream resolution & retry on expired tokens. */
  shotId?: number
}

// ---------------------------------------------------------------------------
// In-flight resolve-stream dedup: if two components request a resolve for the
// same shot concurrently, share the same promise.
// ---------------------------------------------------------------------------
const _inflightResolves = new Map<number, Promise<string | null>>()

/**
 * Ask the backend to resolve a fresh stream URL for a ytdlp screenshot.
 * Returns the new local_url proxy path, or null if refresh wasn't possible.
 */
async function resolveStreamUrl(shotId: number): Promise<string | null> {
  const existing = _inflightResolves.get(shotId)
  if (existing) return existing

  const p = api.resolveStream(shotId)
    .then((res) => res.local_url || null)
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
  video.removeAttribute("src")

  const tryPlay = () => {
    if (!tryAutoplay) return
    void attemptPlay(video).catch(() => {})
  }

  if (!isHlsUrl(src)) {
    video.src = absoluteMediaRequestUrl(src)
    const onMeta = () => {
      video.removeEventListener("loadedmetadata", onMeta)
      tryPlay()
    }
    video.addEventListener("loadedmetadata", onMeta)
    return () => {
      video.removeEventListener("loadedmetadata", onMeta)
      video.removeAttribute("src")
      video.load()
    }
  }

  // ── HLS path ──────────────────────────────────────────────────────────────

  // We track cleanup across async pre-flight + HLS instantiation.
  let destroyed = false
  let hls: Hls | null = null

  const cleanup = () => {
    destroyed = true
    if (hls) {
      hls.destroy()
      hls = null
    }
    video.removeAttribute("src")
    video.load()
  }

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

  let retryCount = 0
  const MAX_RETRIES = 1

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

        // On fatal network error, try resolving a fresh URL (once)
        if (data.type === "networkError" && shotId && retryCount < MAX_RETRIES) {
          retryCount++
          // Destroy the current hls instance and re-resolve
          if (hls) { hls.destroy(); hls = null }
          resolveStreamUrl(shotId).then((freshUrl) => {
            if (destroyed) return
            if (freshUrl) {
              startHls(freshUrl)
            } else {
              // Couldn't resolve — try restarting with original src
              startHls(hlsSrc)
            }
          })
          return
        }

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

  // ── Pre-flight: resolve fresh URL if shotId is available ────────────────
  if (shotId) {
    resolveStreamUrl(shotId).then((freshUrl) => {
      if (destroyed) return
      startHls(freshUrl || src)
    })
  } else {
    startHls(src)
  }

  return cleanup
}
