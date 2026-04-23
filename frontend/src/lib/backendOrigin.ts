/**
 * When the UI is hosted separately from FastAPI (e.g. Vercel + Render), set
 * `VITE_BACKEND_ORIGIN` to the API origin, e.g. `https://your-service.onrender.com`
 * (no trailing slash). Omit for same-origin (FastAPI serving the built SPA).
 */
export function getBackendOrigin(): string {
  const raw = import.meta.env.VITE_BACKEND_ORIGIN as string | undefined
  if (raw?.trim()) return raw.trim().replace(/\/$/, "")

  // Production split UI: some deployments set `VITE_BACKEND_URL` (remote https) but not `VITE_BACKEND_ORIGIN`.
  if (import.meta.env.PROD) {
    const alt = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim()
    if (alt && /^https:\/\//i.test(alt)) {
      try {
        const u = new URL(alt)
        if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
          return u.origin.replace(/\/$/, "")
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Runtime fallback: auto-detect Vercel deployments and point to the Render backend.
  if (typeof window !== "undefined") {
    const host = window.location.hostname
    if (host.endsWith(".vercel.app") || host.includes("-vercel-")) {
      return "https://codex-research-radar.onrender.com"
    }
  }

  return ""
}

/** Absolute URL for API paths like `/api/items`. */
export function apiUrl(path: string): string {
  const base = getBackendOrigin()
  const p = path.startsWith("/") ? path : `/${path}`
  return base ? `${base}${p}` : p
}

/** Prefix relative `/api/...` and `/cached-...` URLs for `<img>` / `<video>` when the UI is on another host. */
export function resolvePublicUrl(url: string): string {
  if (!url) return url
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  const origin = getBackendOrigin()
  if (!origin) return url
  if (url.startsWith("/")) return `${origin}${url}`
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
