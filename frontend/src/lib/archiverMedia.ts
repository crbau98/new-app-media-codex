/**
 * Coomer / Kemono file URLs are often stored as same-origin proxy paths so the UI
 * can avoid CORS. Many cloud hosts (e.g. Render) cannot reach those CDNs from the
 * server, so the proxy returns errors while the user's browser can load the HTTPS
 * file URL directly. Detect those hosts so we prefer direct browser fetches.
 */
const ARCHIVER_MEDIA_NETLOCS = new Set([
  "coomer.st",
  "coomer.su",
  "kemono.su",
  "kemono.party",
  "kemono.cr",
])

const PROXY_MEDIA_PATH = "/api/screenshots/proxy-media"

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
    return false
  } catch {
    return false
  }
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
 * - **Always** include the raw `https://coomer…/data/…` when decoded from a proxy URL, so
 *   same-origin SPA+API (e.g. Render) still loads media in the **browser** when the
 *   server cannot reach the CDN.
 * - On **Vercel** (`*.vercel.app`), try Edge `/api/archiver-proxy` first.
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
  if (typeof window !== "undefined" && /\.vercel\.app$/i.test(window.location.hostname)) {
    out.push(`${window.location.origin}/api/archiver-proxy?url=${encodeURIComponent(httpsTarget)}`)
  }
  out.push(httpsTarget)
  if (r !== httpsTarget && !out.includes(r)) {
    out.push(r)
  }
  return out
}
