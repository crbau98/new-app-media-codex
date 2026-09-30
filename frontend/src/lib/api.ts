/**
 * API layer.
 *
 * The app is fed by a single Vercel edge function (`/api/live-media`).
 * These helpers post filter/watchlist context to it and normalize the
 * payload defensively — every contract field beyond `items`/`performers`
 * may be absent when an upstream source is degraded.
 */

import { FETCH_TIMEOUT_MS } from './backendOrigin'
import { normalizeCandidates, type CreatorCandidate } from '../features/creators/creatorLogic'
import type {
  AiDiscovery,
  AiDiscoveryState,
  Creator,
  DuckDuckGoSection,
  LiveDiscoveryPayload,
  MediaItem,
  SourceState,
  SourceStatus,
} from './types'

export type { LiveDiscoveryPayload }

export interface MediaFilters {
  category?: string | null
  sourceType?: string | null
  sort?: 'smart' | 'newest' | 'oldest' | 'topRated' | 'az' | 'random' | 'mostViewed'
  tag?: string | null
  search?: string
  creator?: string | null
  minViews?: number
  minLikes?: number
  watchlist?: string[]
}

export interface PaginatedResult<T> {
  items: T[]
  page: number
  perPage: number
  total: number
  hasMore: boolean
}

const LIVE_MEDIA_URL = '/api/live-media'

/* ───────────────────────────────────────────────
   Low-level fetch helper with timeout
   ────────────────────────────────────────────── */

async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

async function postLiveMedia(body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
  return fetchWithTimeout(
    LIVE_MEDIA_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(body),
    },
    timeoutMs
  )
}

/* ───────────────────────────────────────────────
   Payload normalization (defensive vs optional fields)
   ────────────────────────────────────────────── */

const AI_STATES: AiDiscoveryState[] = ['ok', 'fallback', 'not-requested']

function toCount(value: unknown): number {
  // Final contract sends numbers; tolerate legacy arrays/strings defensively.
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
  if (Array.isArray(value)) return value.length
  return 0
}

function normalizeAiDiscovery(raw: unknown): AiDiscovery {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rawState = typeof input.state === 'string' ? input.state : undefined
  const state: AiDiscoveryState = rawState === 'model'
    ? 'ok'
    : AI_STATES.includes(rawState as AiDiscoveryState)
      ? (rawState as AiDiscoveryState)
      : 'not-requested'
  return {
    model: typeof input.model === 'string' ? input.model : '',
    state,
    detail: typeof input.detail === 'string' ? input.detail : '',
    cacheState: input.cacheState === 'hit' || input.cacheState === 'miss' ? input.cacheState : undefined,
    explainable: input.explainable === false ? undefined : true,
    suggestedCreators: toCount(input.suggestedCreators),
    autoAddedCreators: toCount(input.autoAddedCreators),
    sensitiveAttributeInference: input.sensitiveAttributeInference === true ? undefined : false,
  }
}

const SOURCE_STATES: SourceState[] = ['connected', 'not-configured', 'limited', 'error']

function normalizeSources(raw: unknown): SourceStatus[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => {
      const rawState = typeof entry.state === 'string' ? entry.state : ''
      const state = SOURCE_STATES.includes(rawState as SourceState) ? rawState : 'limited'
      return { ...(entry as unknown as SourceStatus), id: String(entry.id ?? 'unknown'), state }
    })
}

function normalizeDdg(raw: unknown): DuckDuckGoSection | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const section = raw as Partial<DuckDuckGoSection>
  if (!Array.isArray(section.leads) || typeof section.searchUrl !== 'string') return undefined
  return {
    state: section.state === 'connected' || section.state === 'error' ? section.state : 'limited',
    detail: typeof section.detail === 'string' ? section.detail : '',
    leads: section.leads.filter(
      (lead): lead is DuckDuckGoSection['leads'][number] =>
        Boolean(lead) && typeof lead === 'object' && typeof lead.title === 'string' && typeof lead.url === 'string'
    ),
    searchUrl: section.searchUrl,
  }
}

/* ───────────────────────────────────────────────
   Live discovery
   ────────────────────────────────────────────── */

export interface LiveDiscoveryOptions {
  forceFresh?: boolean
  query?: string
  sort?: 'smart' | 'newest' | 'views' | 'likes'
}

export async function fetchLiveDiscovery(
  watchlist: string[] = [],
  options: LiveDiscoveryOptions = {}
): Promise<LiveDiscoveryPayload> {
  const { forceFresh = false, query = '', sort = 'smart' } = options
  const hasQuery = query.trim().length > 0
  const isAnonymousDefault = watchlist.length === 0 && !hasQuery && !forceFresh && sort === 'smart'

  let response: Response
  if (isAnonymousDefault) {
    // Anonymous default discovery: GET so the edge/CDN cache can serve repeat paints.
    response = await fetchWithTimeout(
      `${LIVE_MEDIA_URL}?count=96&pages=3&sort=smart`,
      { method: 'GET' },
      25000
    )
  } else {
    // Personalized or force-fresh scan: POST with no-store to bypass CDN cache.
    response = await fetchWithTimeout(
      LIVE_MEDIA_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(forceFresh ? { 'Cache-Control': 'no-cache' } : {}),
        },
        cache: 'no-store',
        body: JSON.stringify({
          count: 96,
          pages: 3,
          sort,
          query,
          watchlist: watchlist.slice(0, 40),
          forceFresh,
          useAI: forceFresh,
        }),
      },
      forceFresh ? 45000 : 25000
    )
  }

  if (!response.ok) throw new Error(`Live discovery returned ${response.status}`)
  const payload = (await response.json()) as Partial<LiveDiscoveryPayload>
  const items = Array.isArray(payload.items) ? payload.items : []
  const performers = Array.isArray(payload.performers) ? payload.performers : []
  const ddg = normalizeDdg(payload.ddg)
  // Success criterion per contract: any usable section counts as success.
  if (!items.length && !performers.length && !(ddg?.leads.length)) {
    throw new Error('Live discovery returned no usable results')
  }
  return {
    items,
    performers,
    updatedAt: payload.updatedAt || new Date().toISOString(),
    counts: payload.counts || { received: items.length, eligible: items.length, playable: items.length, pagesScanned: 0 },
    watchlist: {
      requested: Array.isArray(payload.watchlist?.requested) ? payload.watchlist.requested : watchlist,
      matched: Array.isArray(payload.watchlist?.matched) ? payload.watchlist.matched : [],
    },
    aiDiscovery: normalizeAiDiscovery(payload.aiDiscovery),
    sources: normalizeSources(payload.sources),
    ...(ddg ? { ddg } : {}),
  }
}

/* ───────────────────────────────────────────────
   Media browsing / search
   ────────────────────────────────────────────── */

function applyClientSort(items: MediaItem[], sort: MediaFilters['sort']): MediaItem[] {
  const copy = [...items]
  switch (sort) {
    case 'smart':
      copy.sort((a, b) => (b.curationScore || 0) - (a.curationScore || 0))
      break
    case 'oldest':
      copy.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
      break
    case 'topRated':
      copy.sort((a, b) => b.rating - a.rating)
      break
    case 'az':
      copy.sort((a, b) => a.title.localeCompare(b.title))
      break
    case 'random':
      copy.sort(() => Math.random() - 0.5)
      break
    case 'mostViewed':
      copy.sort((a, b) => b.views - a.views)
      break
    case 'newest':
    default:
      copy.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      break
  }
  return copy
}

function applyClientFilters(items: MediaItem[], filters: MediaFilters): MediaItem[] {
  let result = [...items]
  if (filters.category) {
    result = result.filter((m) => m.category === filters.category || m.tags.includes(filters.category!))
  }
  if (filters.sourceType) {
    if (filters.sourceType === 'video') result = result.filter((m) => m.isVideo)
    else if (filters.sourceType === 'image') result = result.filter((m) => !m.isVideo)
    else if (filters.sourceType === 'favorites') result = result.filter((m) => m.isLiked)
    else result = result.filter((m) => m.source.toLowerCase() === filters.sourceType!.toLowerCase())
  }
  if (filters.tag) {
    result = result.filter((m) => m.tags.includes(filters.tag!))
  }
  if (filters.search) {
    const q = filters.search.toLowerCase()
    result = result.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.creator.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
    )
  }
  if (filters.creator) {
    result = result.filter((m) => m.creator.toLowerCase() === filters.creator!.toLowerCase())
  }
  if (filters.minViews) result = result.filter((m) => m.views >= filters.minViews!)
  if (filters.minLikes) result = result.filter((m) => (m.likes || 0) >= filters.minLikes!)
  return result
}

function buildPaginatedResult<T>(all: T[], page: number, perPage: number): PaginatedResult<T> {
  const start = (page - 1) * perPage
  const end = start + perPage
  return {
    items: all.slice(start, end),
    page,
    perPage,
    total: all.length,
    hasMore: end < all.length,
  }
}

async function fetchLiveMedia(
  filters: MediaFilters,
  page: number,
  perPage: number
): Promise<PaginatedResult<MediaItem>> {
  const sort = filters.sort === 'mostViewed' ? 'views'
    : filters.sort === 'newest' ? 'newest'
      : filters.sort === 'topRated' ? 'likes'
        : 'smart'
  const response = await postLiveMedia(
    {
      count: 96,
      pages: 3,
      query: filters.search || filters.creator || filters.category || '',
      minViews: filters.minViews || 0,
      minLikes: filters.minLikes || 0,
      watchlist: (filters.watchlist || []).slice(0, 8),
      expandWatchlist: !filters.search,
      sort,
    },
    20000
  )
  if (!response.ok) throw new Error(`Live media returned ${response.status}`)
  const payload = (await response.json()) as { items?: MediaItem[] }
  // Query terms were applied upstream. Category remains a tag-level client
  // filter because one item may belong to several source tags.
  const filtered = applyClientFilters(payload.items || [], { ...filters, search: undefined, creator: null })
  const sorted = applyClientSort(filtered, filters.sort || 'newest')
  return buildPaginatedResult(sorted, page, perPage)
}

export async function searchMedia(
  query: string,
  filters: MediaFilters = {}
): Promise<PaginatedResult<MediaItem>> {
  return fetchLiveMedia({ ...filters, search: query }, 1, 24)
}

export type { Creator, MediaItem }

/* ───────────────────────────────────────────────
   Per-creator full catalog (`/api/creator-media`)
   ────────────────────────────────────────────── */

export interface CreatorMediaPage {
  creator: string
  items: MediaItem[]
  page: number
  pages: number
  total: number
  hasMore: boolean
  /** Present when the endpoint resolved the requested name to a different provider handle. */
  resolvedHandle?: string
}

/** One page of a creator's complete public catalog (not just the feed sample). `strict: false` sends `strict=0` for explicit lookups. */
export async function fetchCreatorMediaPage(
  creator: string,
  page = 1,
  count = 40,
  options: { strict?: boolean } = {}
): Promise<CreatorMediaPage> {
  const params = new URLSearchParams({ creator, page: String(page), count: String(count) })
  if (options.strict === false) params.set('strict', '0')
  const response = await fetchWithTimeout(`/api/creator-media?${params}`, { method: 'GET' }, 20000)
  if (!response.ok) throw new Error(`Creator media returned ${response.status}`)
  const payload = (await response.json()) as Partial<CreatorMediaPage>
  return {
    creator: payload.creator || creator,
    items: Array.isArray(payload.items) ? payload.items : [],
    page: payload.page || page,
    pages: payload.pages || page,
    total: payload.total ?? 0,
    hasMore: Boolean(payload.hasMore),
    resolvedHandle: typeof payload.resolvedHandle === 'string' && payload.resolvedHandle ? payload.resolvedHandle : undefined,
  }
}

/* ───────────────────────────────────────────────
   Creator resolver + directory (see docs/CREATOR_COVERAGE.md)
   ────────────────────────────────────────────── */

export type { CreatorCandidate }

export interface CreatorResolution {
  query: string
  candidates: CreatorCandidate[]
  tried: string[]
  updatedAt?: string
}

/** Resolve a name, @handle or pasted profile URL to public creator profiles. */
export async function resolveCreators(q: string, limit = 8): Promise<CreatorResolution> {
  const params = new URLSearchParams({ q: q.trim(), limit: String(limit) })
  const response = await fetchWithTimeout(`/api/creator-resolve?${params}`, { method: 'GET' }, 20000)
  if (!response.ok) throw new Error(`Creator resolver returned ${response.status}`)
  const payload = (await response.json()) as Record<string, unknown>
  return {
    query: typeof payload.query === 'string' ? payload.query : q,
    candidates: normalizeCandidates(payload),
    tried: Array.isArray(payload.tried) ? payload.tried.filter((v): v is string => typeof v === 'string') : [],
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : undefined,
  }
}

export type DirectorySort = 'smart' | 'newest' | 'popular'

export interface CreatorDirectoryLane {
  tag: string
  pagesScanned?: number
}

export interface CreatorDirectoryPage {
  creators: Creator[]
  nextCursor: string | null
  total: number | null
  lanes: CreatorDirectoryLane[]
  updatedAt?: string
}

export interface CreatorDirectoryParams {
  cursor?: string | null
  limit?: number
  tag?: string | null
  sort?: DirectorySort
}

/** One page of the cross-lane creator directory. */
export async function fetchCreatorDirectory(params: CreatorDirectoryParams = {}): Promise<CreatorDirectoryPage> {
  const search = new URLSearchParams({ limit: String(params.limit ?? 48), sort: params.sort ?? 'smart' })
  if (params.cursor) search.set('cursor', params.cursor)
  if (params.tag) search.set('tag', params.tag)
  const response = await fetchWithTimeout(`/api/creator-directory?${search}`, { method: 'GET' }, 25000)
  if (!response.ok) throw new Error(`Creator directory returned ${response.status}`)
  const payload = (await response.json()) as Partial<CreatorDirectoryPage>
  return {
    creators: Array.isArray(payload.creators) ? payload.creators : [],
    nextCursor: typeof payload.nextCursor === 'string' && payload.nextCursor ? payload.nextCursor : null,
    total: typeof payload.total === 'number' ? payload.total : null,
    lanes: Array.isArray(payload.lanes) ? payload.lanes.filter((lane) => lane && typeof lane.tag === 'string') : [],
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : undefined,
  }
}

/* ───────────────────────────────────────────────
   Related creators + "elsewhere" links (`/api/creator-related`)
   ────────────────────────────────────────────── */

export interface RelatedCreator {
  handle: string
  displayName: string
  platform: string
  avatar?: string
  score: number
  reason: string
  sharedTags: string[]
}

export interface ElsewhereLink {
  platform: string
  handle: string
  url: string
  label: string
  /** True only for registry entries and Mastodon rel=me verified fields. */
  verified: boolean
  source: 'bio' | 'registry'
  /** Media Codex cannot browse this platform; the link just opens on the source. */
  linkOnly?: boolean
}

export interface CreatorRelated {
  creator: string
  related: RelatedCreator[]
  elsewhere: ElsewhereLink[]
  updatedAt?: string
  partial?: string[]
}

const isHttpsUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

/** Related creators (tag overlap) and links the creator published themselves. */
export async function fetchCreatorRelated(handle: string, platform = 'redgifs', limit = 12): Promise<CreatorRelated> {
  const params = new URLSearchParams({ creator: handle, platform: platform.toLowerCase(), limit: String(limit) })
  const response = await fetchWithTimeout(`/api/creator-related?${params}`, { method: 'GET' }, 20000)
  if (!response.ok) throw new Error(`Creator related returned ${response.status}`)
  const payload = (await response.json()) as Partial<CreatorRelated>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    creator: payload.creator || handle,
    related: (Array.isArray(payload.related) ? payload.related : [])
      .filter((r) => r && typeof r.handle === 'string' && r.handle)
      .map((r) => ({
        handle: r.handle,
        displayName: str(r.displayName) || r.handle,
        platform: str(r.platform) || 'Redgifs',
        avatar: typeof r.avatar === 'string' && r.avatar.startsWith('/api/') ? r.avatar : undefined,
        score: Number(r.score) || 0,
        reason: str(r.reason),
        sharedTags: Array.isArray(r.sharedTags) ? r.sharedTags.filter((t): t is string => typeof t === 'string').slice(0, 5) : [],
      })),
    elsewhere: (Array.isArray(payload.elsewhere) ? payload.elsewhere : [])
      .filter((l) => l && isHttpsUrl(l.url))
      .map((l) => ({
        platform: str(l.platform), handle: str(l.handle), url: l.url, label: str(l.label) || str(l.platform),
        verified: l.verified === true, source: l.source === 'registry' ? ('registry' as const) : ('bio' as const),
        linkOnly: l.linkOnly !== false,
      })),
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : undefined,
    partial: Array.isArray(payload.partial) ? payload.partial.filter((v): v is string => typeof v === 'string') : undefined,
  }
}
