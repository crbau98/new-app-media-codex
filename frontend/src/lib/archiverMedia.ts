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

/** If `ref` is `/api/screenshots/proxy-media?url=...`, return the decoded target URL; else if ref is already http(s), return it. */
export function extractProxyMediaTargetUrl(ref: string): string {
  const probe = ref.trim()
  if (!probe) return ""
  if (probe.startsWith("http://") || probe.startsWith("https://")) return probe
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://invalid.invalid"
    const u = new URL(probe, base)
    if (u.pathname === PROXY_MEDIA_PATH || u.pathname.endsWith("/proxy-media")) {
      const inner = u.searchParams.get("url")
      return inner?.trim() || ""
    }
  } catch {
    /* ignore */
  }
  const marker = `${PROXY_MEDIA_PATH}?url=`
  if (probe.startsWith(marker)) {
    try {
      return decodeURIComponent(probe.slice(marker.length).split("&")[0])
    } catch {
      return ""
    }
  }
  return ""
}

/**
 * When the SPA is on Vercel and the API on another host, try the Edge proxy first
 * (same origin as the page), then the raw HTTPS URL in the browser. Without this,
 * a missing Edge route (HTML 200) marks all variants broken and the UI shows
 * "Media unavailable" with an empty preview chain.
 */
export function archiverPlaybackCandidatesFromAnyRef(ref: string, splitDeploy: boolean): string[] {
  const r = ref.trim()
  if (!r) return []
  if (!splitDeploy || typeof window === "undefined") return [r]

  let httpsTarget: string | null = null

  try {
    const u = r.startsWith("http://") || r.startsWith("https://")
      ? new URL(r)
      : new URL(r, window.location.origin)
    const param = u.searchParams.get("url")
    if (param) {
      const path = u.pathname
      if (path.includes("proxy-media") || path.includes("archiver-proxy")) {
        const decoded = param.trim()
        if (isArchiverDirectMediaUrl(decoded)) httpsTarget = decoded
      }
    }
  } catch {
    /* ignore */
  }

  if (!httpsTarget && (r.startsWith("http://") || r.startsWith("https://")) && isArchiverDirectMediaUrl(r)) {
    httpsTarget = r
  }
  if (!httpsTarget && r.includes("proxy-media")) {
    const inner = extractProxyMediaTargetUrl(r)
    if (inner && isArchiverDirectMediaUrl(inner)) httpsTarget = inner
  }

  if (!httpsTarget) return [r]

  const edge = `${window.location.origin}/api/archiver-proxy?url=${encodeURIComponent(httpsTarget)}`
  return [edge, httpsTarget]
}
