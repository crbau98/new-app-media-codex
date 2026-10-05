/**
 * The one definition of "what request does the live feed make".
 *
 * `fetchLiveDiscovery` builds its request from this, and the boot script
 * (src/lib/perf/boot.js, which starts the request before the JS bundle has
 * even been parsed) mirrors it by signature: `sig` must be identical on both
 * sides or the early response is ignored. tests/perf-boot.test.ts keeps the
 * two in lockstep.
 */

export type DiscoverySort = 'smart' | 'newest' | 'views' | 'likes'

export interface DiscoveryRequestOptions {
  forceFresh?: boolean
  query?: string
  sort?: DiscoverySort
}

export interface DiscoveryRequest {
  method: 'GET' | 'POST'
  url: string
  body?: string
  headers?: Record<string, string>
  cache?: 'no-store'
  timeoutMs: number
  /** Request identity, used to coalesce identical in-flight requests and to match the boot request. */
  sig: string
  /** True for the anonymous default feed that the edge/CDN can cache. */
  cacheable: boolean
}

export const LIVE_MEDIA_URL = '/api/live-media'
export const DEFAULT_FEED_QUERY = 'count=96&pages=3&sort=smart'
export const WATCHLIST_LIMIT = 40

export function buildDiscoveryRequest(watchlist: string[] = [], options: DiscoveryRequestOptions = {}): DiscoveryRequest {
  const { forceFresh = false, query = '', sort = 'smart' } = options
  const hasQuery = query.trim().length > 0
  const anonymousDefault = watchlist.length === 0 && !hasQuery && !forceFresh && sort === 'smart'
  if (anonymousDefault) {
    const url = `${LIVE_MEDIA_URL}?${DEFAULT_FEED_QUERY}`
    return { method: 'GET', url, timeoutMs: 25000, sig: `GET ${url}`, cacheable: true }
  }
  const body = JSON.stringify({
    count: 96,
    pages: 3,
    sort,
    query,
    watchlist: watchlist.slice(0, WATCHLIST_LIMIT),
    forceFresh,
    useAI: forceFresh,
  })
  return {
    method: 'POST',
    url: LIVE_MEDIA_URL,
    body,
    headers: { 'Content-Type': 'application/json', ...(forceFresh ? { 'Cache-Control': 'no-cache' } : {}) },
    cache: 'no-store',
    timeoutMs: forceFresh ? 45000 : 25000,
    sig: `POST ${LIVE_MEDIA_URL} ${body}`,
    // Personalised scans are never shared or reused beyond a single in-flight request.
    cacheable: false,
  }
}
