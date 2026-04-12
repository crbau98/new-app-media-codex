import Hls, { XhrLoader } from "hls.js"

const PROXY_PATH = "/api/screenshots/proxy-media"
const PROXY_QUERY = "url="
const SCREENSHOTS_API_PREFIX = "/api/screenshots/"

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

/** True when the URL points at an HLS playlist (including proxied URLs that encode `.m3u8`). */
export function isHlsUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /m3u8/i.test(url)
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
    const u = new URL(url, window.location.origin)
    if (u.origin !== window.location.origin) return url
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
    return url
  }
  if (url.startsWith(PROXY_PATH + "?")) {
    return url
  }
  if (typeof window !== "undefined") {
    try {
      const u = new URL(url, window.location.origin)
      if (u.origin === window.location.origin && u.pathname.startsWith(PROXY_PATH)) {
        return u.pathname + u.search
      }
    } catch {
      /* ignore */
    }
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return `${PROXY_PATH}?${PROXY_QUERY}${encodeURIComponent(url)}`
  }
  return url
}

export type AttachMediaOptions = {
  /** Call `video.play()` once the stream is ready (HLS manifest parsed or metadata loaded). */
  tryAutoplay?: boolean
  /** HLS fatal network / media errors (after xhr rewrite, etc.). */
  onFatalError?: () => void
}

/**
 * Attach progressive or HLS media to a &lt;video&gt; element. For `.m3u8` in Chrome/Firefox/Edge,
 * uses hls.js with **all** playlist/segment/key requests rewritten through `/api/screenshots/proxy-media`
 * so segment fetches are same-origin (CDN URLs in the m3u8 would otherwise fail CORS in XHR).
 * Safari/iOS: uses the same path when MSE is available; falls back to native HLS when not.
 */
export function attachMediaSource(video: HTMLVideoElement, src: string, options?: AttachMediaOptions): () => void {
  const tryAutoplay = options?.tryAutoplay ?? false
  const onFatalError = options?.onFatalError
  video.removeAttribute("src")

  const tryPlay = () => {
    if (!tryAutoplay) return
    void attemptPlay(video).catch(() => {})
  }

  if (!isHlsUrl(src)) {
    video.src = src
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

  const hlsConfig: ConstructorParameters<typeof Hls>[0] = {
    // Worker transmux can race MSE attachment on some browsers; main thread is more predictable.
    enableWorker: false,
    lowLatencyMode: false,
    // Stay on XhrLoader + non-progressive mode so xhrSetup runs for every fragment/key request.
    // If progressive streaming is enabled, FetchLoader is used unless fetchSetup is set below.
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

  if (Hls.isSupported()) {
    const hls = new Hls(hlsConfig)
    hls.loadSource(src)
    hls.attachMedia(video)
    hls.on(Hls.Events.MANIFEST_PARSED, tryPlay)
    const onError = (_: string, data: { fatal?: boolean; type?: string }) => {
      if (!data.fatal) return
      if (data.type === "networkError") {
        try {
          hls.startLoad()
        } catch {
          onFatalError?.()
        }
        return
      }
      if (data.type === "mediaError") {
        try {
          hls.recoverMediaError()
        } catch {
          onFatalError?.()
        }
        return
      }
      onFatalError?.()
    }
    hls.on(Hls.Events.ERROR, onError)
    return () => {
      hls.off(Hls.Events.ERROR, onError)
      hls.destroy()
      video.removeAttribute("src")
      video.load()
    }
  }

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = src
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

  video.src = src
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
