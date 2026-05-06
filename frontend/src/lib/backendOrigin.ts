/**
 * Backend origin detection and URL helpers.
 *
 * Priority:
 *  1. VITE_BACKEND_ORIGIN env var
 *  2. Same-origin (if UI is served from the same domain as the API)
 *  3. Default Render deployment origin
 */

const DEFAULT_ORIGIN = 'https://codex-research-radar.onrender.com'

/**
 * Number of seconds to wait before aborting a fetch request.
 */
export const FETCH_TIMEOUT_MS = 10000

/**
 * Returns the detected backend origin URL (no trailing slash).
 */
export function getBackendOrigin(): string {
  // 1. explicit env override
  const env = import.meta.env.VITE_BACKEND_ORIGIN as string | undefined
  if (env && env.trim()) {
    return env.trim().replace(/\/$/, '')
  }

  // 2. same-origin detection
  // If the UI is hosted on Render (same domain as backend), use same-origin
  const host = window.location.host
  if (
    host.includes('render.com') ||
    host.includes('localhost') ||
    host.includes('127.0.0.1') ||
    host === 'codex-research-radar.onrender.com'
  ) {
    // Use same-origin (empty string prefix means same origin in fetch)
    return ''
  }

  // 3. split deployment — UI hosted elsewhere (Vercel, Netlify, etc.)
  return DEFAULT_ORIGIN
}

/**
 * Build a full API URL given a path like `/api/screenshots`.
 * If running same-origin, the origin is omitted.
 */
export function apiUrl(path: string): string {
  const origin = getBackendOrigin()
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return origin ? `${origin}${cleanPath}` : cleanPath
}

/**
 * Resolve a public URL (e.g. local_path or avatar_local) into a fully-qualified URL.
 * Backend may return relative paths; this prepends the backend origin when needed.
 */
export function resolvePublicUrl(path: string | null | undefined): string {
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }
  const origin = getBackendOrigin()
  if (!origin) {
    // same-origin — prepend current origin
    return `${window.location.origin}${path.startsWith('/') ? '' : '/'}${path}`
  }
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`
}

/**
 * Get the public origin (for things like OG meta tags, direct links).
 * Returns the backend origin when available, otherwise current page origin.
 */
export function getPublicOrigin(): string {
  const backend = getBackendOrigin()
  return backend || window.location.origin
}

/**
 * Build the WebSocket URL for the real-time crawl status feed.
 */
export function crawlWebSocketUrl(): string {
  const origin = getBackendOrigin()
  if (origin) {
    const wsOrigin = origin.replace(/^http/, 'ws')
    return `${wsOrigin}/ws/crawl`
  }
  // same-origin
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/crawl`
}
