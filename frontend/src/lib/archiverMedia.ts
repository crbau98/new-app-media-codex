/**
 * Coomer / Kemono file URLs are often stored as same-origin proxy paths so the UI
 * can avoid CORS. Many cloud hosts (e.g. Render) cannot reach those CDNs from the
 * server, so the proxy returns errors while the user's browser can load the HTTPS
 * file URL directly. Detect those hosts so we prefer direct browser fetches.
 *
 * IMPORTANT: coomer.st redirects `/data/…` to `n*.coomer.st` which blocks datacenter
 * and many cloud/mobile IP ranges. The `img.coomer.st/thumbnail/data/…` host is
 * reachable from almost anywhere and serves JPEG thumbnails for both images and
 * videos — that is what we prefer for previews.
 */
const ARCHIVER_MEDIA_NETLOCS = new Set([
  "coomer.st",
  "coomer.su",
  "kemono.su",
  "kemono.party",
  "kemono.cr",
])

const PROXY_MEDIA_PATH = "/api/screenshots/proxy-media"

const COOMER_HOSTS = /^(?:[a-z0-9-]+\.)?coomer\.(?:st|su)$/i
const KEMONO_HOSTS = /^(?:[a-z0-9-]+\.)?kemono\.(?:su|party|cr)$/i

function isCoomerHost(host: string): boolean {
  return COOMER_HOSTS.test(host)
}
function isKemonoHost(host: string): boolean {
  return KEMONO_HOSTS.test(host)
}

/**
 * Rewrite a coomer/kemono `/data/…` URL to the always-reachable thumbnail host:
 *   coomer.st/data/aa/bb/xxx.jpg → img.coomer.st/thumbnail/data/aa/bb/xxx.jpg
 *   kemono.cr/data/aa/bb/xxx.jpg → img.kemono.cr/thumbnail/data/aa/bb/xxx.jpg
 * Returns the empty string if the URL cannot be rewritten.
 */
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|avif)(?:$|\?)/i

export function archiverThumbnailUrl(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (!u.pathname.startsWith("/data/")) return ""
    // Don't rewrite URLs already on the img.* thumbnail host
    if (host.startsWith("img.")) return url
    // Only images have a /thumbnail/data/ variant — video mp4 gives 404
    if (!IMAGE_EXT_RE.test(u.pathname)) return ""
    if (isCoomerHost(host)) {
      const base = host.endsWith("coomer.su") ? "img.coomer.su" : "img.coomer.st"
      return `https://${base}/thumbnail${u.pathname}`
    }
    if (isKemonoHost(host)) {
      const tld = host.split(".").pop() || "su"
      return `https://img.kemono.${tld}/thumbnail${u.pathname}`
    }
    return ""
  } catch {
    return ""
  }
}

/** True on Vercel deployments where `/api/archiver-proxy` Edge route exists. */
export function shouldPreferArchiverEdgeProxy(): boolean {
  return typeof window !== "undefined" && /\.vercel\.app$/i.test(window.location.hostname)
}

export function isArchiverDirectMediaUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (ARCHIVER_MEDIA_NETLOCS.has(host)) return true
    if (/^n\d+\.coomer\.(st|su)$/i.test(host)) return true
    if (/^n\d+\.kemono\.(su|party|cr)$/i.test(host)) return true
    if (/^img\.(coomer|kemono)\./i.test(host)) return true
    return false
  } catch {
    return false
  }
}

export function isArchiverImageUrl(url: string): boolean {
  return isArchiverDirectMediaUrl(url) && IMAGE_EXT_RE.test(url)
}

/** Decode inner `url=` from proxy paths, including absolute API URLs (`https://api.../proxy-media?url=`). */
export function extractProxyMediaTargetUrl(ref: string): string {
  const probe = ref.trim()
  if (!probe) return ""

  const decodeParam = (raw: string): string => {
    const t = raw.trim()
    if (!t) return ""
    try {
      return decodeURIComponent(t)
    } catch {
      return t
    }
  }

  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://invalid.invalid"
    const u = probe.startsWith("http://") || probe.startsWith("https://")
      ? new URL(probe)
      : new URL(probe, base)
    const path = u.pathname
    if (path.includes("proxy-media") || path.includes("archiver-proxy")) {
      const inner = u.searchParams.get("url")
      return decodeParam(inner || "")
    }
  } catch {
    /* fall through */
  }

  const marker = `${PROXY_MEDIA_PATH}?url=`
  if (probe.startsWith(marker)) {
    try {
      return decodeURIComponent(probe.slice(marker.length).split("&")[0])
    } catch {
      return ""
    }
  }
  if (probe.startsWith("http://") || probe.startsWith("https://")) return probe
  return ""
}

/**
 * Playback URLs for coomer/kemono file targets.
 *
 * Order (best → worst):
 *   1. `https://img.coomer.st/thumbnail/data/…` — reachable from datacenter and client.
 *      Coomer/kemono’s thumbnail host serves JPEG previews for images AND videos and
 *      does NOT rate-limit client IPs the way `n*.coomer.st` does.
 *   2. Edge proxy on `*.vercel.app` (only relevant for SPA same-origin fetches).
 *   3. Raw `https://coomer.st/data/…` — works from residential browsers if not blocked.
 *   4. Original ref (`/api/screenshots/proxy-media?url=…`) — last-resort server proxy.
 */
export function archiverPlaybackCandidatesFromAnyRef(ref: string): string[] {
  const r = ref.trim()
  if (!r) return []

  let httpsTarget: string | null = null
  if (r.includes("proxy-media") || r.includes("archiver-proxy")) {
    const inner = extractProxyMediaTargetUrl(r)
    if (inner && isArchiverDirectMediaUrl(inner)) httpsTarget = inner
  }
  if (!httpsTarget && (r.startsWith("http://") || r.startsWith("https://")) && isArchiverDirectMediaUrl(r)) {
    httpsTarget = r
  }

  if (!httpsTarget) return [r]

  const out: string[] = []
  const thumb = archiverThumbnailUrl(httpsTarget)
  if (thumb) out.push(thumb)
  if (typeof window !== "undefined" && /\.vercel\.app$/i.test(window.location.hostname)) {
    out.push(`${window.location.origin}/api/archiver-proxy?url=${encodeURIComponent(httpsTarget)}`)
  }
  out.push(httpsTarget)
  if (r !== httpsTarget && !out.includes(r)) {
    out.push(r)
  }
  return out
}
