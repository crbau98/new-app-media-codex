import { extractProxyMediaTargetUrl, isArchiverDirectMediaUrl } from "./archiverMedia"

/**
 * When the UI is hosted separately from FastAPI (e.g. Vercel + Render), set
 * `VITE_BACKEND_ORIGIN` to the API origin, e.g. `https://your-service.onrender.com`
 * (no trailing slash). Omit for same-origin (FastAPI serving the built SPA).
 */
export function getBackendOrigin(): string {
  const raw = import.meta.env.VITE_BACKEND_ORIGIN as string | undefined
  if (!raw?.trim()) return ""
  return raw.trim().replace(/\/$/, "")
}

/** Absolute URL for API paths like `/api/items`. */
export function apiUrl(path: string): string {
  const base = getBackendOrigin()
  const p = path.startsWith("/") ? path : `/${path}`
  return base ? `${base}${p}` : p
}

/** Same-origin Edge proxy on the Vercel deployment (see `/api/archiver-proxy`). */
function archiverEdgeProxyUrl(targetUrl: string): string {
  if (typeof window === "undefined") return targetUrl
  return `${window.location.origin}/api/archiver-proxy?url=${encodeURIComponent(targetUrl)}`
}

/**
 * Prefix relative `/api/...` and `/cached-...` URLs for `<img>` / `<video>` when the UI is on another host.
 * Coomer/kemono file URLs: Render and similar hosts often cannot reach those CDNs; route through the
 * Vercel Edge proxy when the UI is split from the API so media loads same-origin to the SPA.
 */
export function resolvePublicUrl(url: string): string {
  if (!url) return url
  const split = Boolean(getBackendOrigin())

  if (url.startsWith("http://") || url.startsWith("https://")) {
    if (split && typeof window !== "undefined" && isArchiverDirectMediaUrl(url)) {
      return archiverEdgeProxyUrl(url)
    }
    return url
  }

  const origin = getBackendOrigin()
  if (!origin) return url
  if (url.startsWith("/")) {
    if (split && typeof window !== "undefined" && url.includes("proxy-media")) {
      const inner = extractProxyMediaTargetUrl(url)
      if (inner && isArchiverDirectMediaUrl(inner)) {
        return archiverEdgeProxyUrl(inner)
      }
    }
    return `${origin}${url}`
  }
  return url
}

/** Origin used to resolve relative URLs in the browser (backend or current page). */
export function getPublicOrigin(): string {
  if (typeof window === "undefined") return ""
  const o = getBackendOrigin()
  if (o) {
    try {
      return new URL(o.startsWith("http") ? o : `https://${o}`).origin
    } catch {
      return window.location.origin
    }
  }
  return window.location.origin
}

/** WebSocket URL for crawl notifications (`/ws/crawl`). */
export function crawlWebSocketUrl(): string {
  const path = "/ws/crawl"
  const origin = getBackendOrigin()
  if (origin) {
    try {
      const u = new URL(origin.startsWith("http") ? origin : `https://${origin}`)
      const wsProto = u.protocol === "https:" ? "wss:" : "ws:"
      return `${wsProto}//${u.host}${path}`
    } catch {
      /* fall through */
    }
  }
  if (typeof window === "undefined") return `ws://127.0.0.1${path}`
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${window.location.host}${path}`
}
