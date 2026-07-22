/**
 * Backend origin detection and URL helpers.
 *
 * Browser API traffic stays same-origin on Vercel and is forwarded by the
 * narrow /api/render gateway. Render remains the canonical backend and asset
 * origin; provider secrets never enter the Vite bundle.
 */

const DEFAULT_ORIGIN = 'https://codex-research-radar.onrender.com'
const VERCEL_API_PREFIX = '/api/render'

/**
 * Number of seconds to wait before aborting a fetch request.
 */
export const FETCH_TIMEOUT_MS = 10000

/**
 * Returns the detected backend origin URL (no trailing slash).
 */
export function getBackendOrigin(): string {
  const host = window.location.host

  // Vercel always uses its same-origin gateway, even if a stale build-time
  // VITE_BACKEND_ORIGIN remains in project settings.
  if (host.endsWith('.vercel.app')) return VERCEL_API_PREFIX

  // 1. explicit override for local/alternate hosts
  const env = import.meta.env.VITE_BACKEND_ORIGIN as string | undefined
  if (env && env.trim()) {
    return env.trim().replace(/\/$/, '')
  }

  // 2. same-origin detection
  if (host === 'codex-research-radar.onrender.com') {
    // Use same-origin (empty string prefix means same origin in fetch)
    return ''
  }

  // 3. Local Vite/Vercel development mirrors the production gateway path.
  if (host.includes('localhost') || host.includes('127.0.0.1')) return VERCEL_API_PREFIX

  // 4. Other split deployments can still talk to Render directly.
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
  const apiOrigin = getBackendOrigin()
  if (!apiOrigin) {
    // same-origin — prepend current origin
    return `${window.location.origin}${path.startsWith('/') ? '' : '/'}${path}`
  }
  // The Vercel gateway is intentionally metadata-only; large media assets
  // continue to stream from their canonical Render/provider origin.
  const assetOrigin = apiOrigin === VERCEL_API_PREFIX ? DEFAULT_ORIGIN : apiOrigin
  return `${assetOrigin}${path.startsWith('/') ? '' : '/'}${path}`
}

/**
 * Resolve media returned by either deployment without moving SPA-owned edge
 * routes to the separate legacy backend origin.
 */
export function resolveMediaAssetUrl(path: string | null | undefined): string {
  if (!path) return ''
  if (path.startsWith('/api/archiver-proxy')) return path
  return resolvePublicUrl(path)
}

/**
 * Get the public origin (for things like OG meta tags, direct links).
 * Returns the backend origin when available, otherwise current page origin.
 */
export function getPublicOrigin(): string {
  const backend = getBackendOrigin()
  return backend === VERCEL_API_PREFIX ? DEFAULT_ORIGIN : backend || window.location.origin
}

/**
 * Build the WebSocket URL for the real-time crawl status feed.
 */
export function crawlWebSocketUrl(): string {
  const origin = getBackendOrigin()
  if (origin === VERCEL_API_PREFIX) {
    return `${DEFAULT_ORIGIN.replace(/^http/, 'ws')}/ws/crawl`
  }
  if (origin) {
    const wsOrigin = origin.replace(/^http/, 'ws')
    return `${wsOrigin}/ws/crawl`
  }
  // same-origin
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/crawl`
}
