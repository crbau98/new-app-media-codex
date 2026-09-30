/**
 * Edge reader for the persistent creator index served by the Render backend
 * (`GET /api/v1/creators/index`). Read-only, public, soft-failing: any error,
 * timeout or unexpected shape yields `null` so callers silently fall back to
 * live-only discovery.
 *
 * Media URLs in the index are raw provider URLs on the allow-listed Redgifs
 * CDNs; this module wraps them with the edge proxy (`/api/archiver-proxy`) so
 * the browser can play/preview them exactly like live results. Anything that is
 * not an allow-listed provider URL is dropped.
 *
 * The backend is reached directly at RENDER_BACKEND_ORIGIN (same validation as
 * `render-gateway.ts` / `multi-source.ts`); browsers can reach the same two
 * read-only paths through the gateway allow-list.
 */
import { canonicalCreator, proxiedMediaUrl, safeProviderMediaUrl } from './redgifs.js'

export const INDEX_TIMEOUT_MS = 3_000
export const INDEX_PATH = '/api/v1/creators/index'
const DEFAULT_ORIGIN = 'https://codex-research-radar.onrender.com'
const PROXY_PREFIX = '/api/archiver-proxy?url='
const MAX_INDEX_LIMIT = 96

export type IndexSort = 'smart' | 'newest' | 'popular' | 'count'

export interface IndexMedia {
  id: string
  title: string
  thumbnail: string
  source: string
  duration: string
  isVideo: boolean
  category: string
  creator: string
  tags: string[]
  rating: number
  createdAt: string
  views: number
  mediaUrl?: string
  streamCandidates: string[]
  pageUrl?: string
  likes: number
  width?: number
  height?: number
  aspect?: number
  durationSeconds?: number
  posterUrl?: string
}

export interface IndexCreator {
  id: string
  name: string
  username: string
  avatar: string
  followers: number | null
  platform: string
  platforms: string[]
  profileUrl: string
  profileLinks: Array<{ label: string; url: string }>
  mediaCount: number
  evidenceCount: number
  viewCount: number
  likeCount: number
  curationScore: number
  lastSeenAt: string | null
  observedAt: string
  discoveryTags: string[]
  sourceAttribution: string
  media: IndexMedia[]
}

export interface IndexPage {
  creators: IndexCreator[]
  nextCursor: string | null
  total: number | null
  sources: Array<{ platform: string; count: number }>
  updatedAt: string
}

export interface FetchIndexOptions {
  cursor?: string | null
  limit?: number
  tag?: string
  q?: string
  sort?: IndexSort
}

export function indexBackendOrigin(): string {
  const configured = (process.env.RENDER_BACKEND_ORIGIN || '').trim()
  try {
    const url = new URL(configured || DEFAULT_ORIGIN)
    if (url.protocol !== 'https:' || url.username || url.password) return DEFAULT_ORIGIN
    return url.origin
  } catch {
    return DEFAULT_ORIGIN
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown, max = 600): string => (typeof value === 'string' ? value.slice(0, max) : '')
const count = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** Provider URL -> edge-proxied URL; an already-proxied URL is kept; everything else is dropped. */
export function toEdgeMediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  if (value.startsWith(PROXY_PREFIX)) {
    try {
      return safeProviderMediaUrl(decodeURIComponent(value.slice(PROXY_PREFIX.length))) ? value : undefined
    } catch {
      return undefined
    }
  }
  return proxiedMediaUrl(safeProviderMediaUrl(value))
}

function normalizeMedia(raw: unknown): IndexMedia | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return null
  const thumbnail = toEdgeMediaUrl(raw.thumbnail) || toEdgeMediaUrl(raw.posterUrl)
  const candidates = (Array.isArray(raw.streamCandidates) ? raw.streamCandidates : [raw.mediaUrl])
  const direct = candidates.map((url) => (typeof url === 'string' ? safeProviderMediaUrl(url) : undefined))
    .filter((url): url is string => Boolean(url))
  const proxied = direct.map((url) => proxiedMediaUrl(url)).filter((url): url is string => Boolean(url))
  const mediaUrl = toEdgeMediaUrl(raw.mediaUrl) || proxied[0]
  if (!thumbnail || !mediaUrl) return null
  const out: IndexMedia = {
    id: raw.id.slice(0, 80),
    title: str(raw.title, 300),
    thumbnail,
    source: str(raw.source, 40),
    duration: str(raw.duration, 12) || '0:00',
    isVideo: raw.isVideo !== false,
    category: str(raw.category, 40),
    creator: str(raw.creator, 120),
    tags: (Array.isArray(raw.tags) ? raw.tags : []).filter((tag): tag is string => typeof tag === 'string').slice(0, 12),
    rating: 0,
    createdAt: str(raw.createdAt, 40),
    views: count(raw.views),
    mediaUrl,
    streamCandidates: [...proxied, ...direct],
    likes: count(raw.likes),
  }
  const page = str(raw.pageUrl, 500)
  if (/^https:\/\//i.test(page)) out.pageUrl = page
  const poster = toEdgeMediaUrl(raw.posterUrl)
  if (poster) out.posterUrl = poster
  for (const key of ['width', 'height', 'durationSeconds'] as const) if (count(raw[key])) out[key] = count(raw[key])
  if (typeof raw.aspect === 'number' && Number.isFinite(raw.aspect) && raw.aspect > 0) out.aspect = raw.aspect
  return out
}

/** Validate + normalise one index creator. Returns null when the record is unusable. */
export function normalizeIndexCreator(raw: unknown): IndexCreator | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id, 140)
  const username = str(raw.username, 120) || str(raw.name, 120)
  const name = str(raw.name, 120) || username
  if (!id || !username) return null
  const platform = str(raw.platform, 20) || 'Redgifs'
  const profileUrl = str(raw.profileUrl, 500)
  const links = (Array.isArray(raw.profileLinks) ? raw.profileLinks : [])
    .filter(isRecord)
    .map((link) => ({ label: str(link.label, 80), url: str(link.url, 500) }))
    .filter((link) => /^https:\/\//i.test(link.url))
  const mediaCount = count(raw.mediaCount)
  return {
    id,
    name,
    username,
    avatar: toEdgeMediaUrl(raw.avatar) || '',
    followers: raw.followers === null || raw.followers === undefined ? null : count(raw.followers),
    platform,
    platforms: (Array.isArray(raw.platforms) ? raw.platforms : [platform]).filter((p): p is string => typeof p === 'string').slice(0, 5),
    profileUrl: /^https:\/\//i.test(profileUrl) ? profileUrl : '',
    profileLinks: links,
    mediaCount,
    evidenceCount: count(raw.evidenceCount) || mediaCount,
    viewCount: count(raw.viewCount),
    likeCount: count(raw.likeCount),
    curationScore: Math.min(100, count(raw.curationScore)),
    lastSeenAt: typeof raw.lastSeenAt === 'string' && raw.lastSeenAt ? raw.lastSeenAt : null,
    observedAt: str(raw.observedAt, 40),
    discoveryTags: (Array.isArray(raw.discoveryTags) ? raw.discoveryTags : []).filter((tag): tag is string => typeof tag === 'string').slice(0, 20),
    sourceAttribution: str(raw.sourceAttribution, 200),
    media: (Array.isArray(raw.media) ? raw.media : []).map(normalizeMedia).filter((item): item is IndexMedia => Boolean(item)).slice(0, 6),
  }
}

/** Validate a whole response body. Returns null unless it has the index page shape. */
export function parseIndexPage(body: unknown): IndexPage | null {
  if (!isRecord(body) || !Array.isArray(body.creators)) return null
  if (body.nextCursor !== null && body.nextCursor !== undefined && typeof body.nextCursor !== 'string') return null
  const creators = body.creators.map(normalizeIndexCreator).filter((creator): creator is IndexCreator => Boolean(creator))
  const total = typeof body.total === 'number' && Number.isFinite(body.total) && body.total >= 0 ? Math.floor(body.total) : null
  return {
    creators,
    nextCursor: typeof body.nextCursor === 'string' && body.nextCursor ? body.nextCursor : null,
    total,
    sources: (Array.isArray(body.sources) ? body.sources : []).filter(isRecord)
      .map((source) => ({ platform: str(source.platform, 20), count: count(source.count) }))
      .filter((source) => source.platform),
    updatedAt: str(body.updatedAt, 40),
  }
}

/** One page of the persistent index; `null` on any failure (timeout, non-2xx, bad shape). Never throws. */
export async function fetchIndexPage(options: FetchIndexOptions = {}, timeoutMs = INDEX_TIMEOUT_MS): Promise<IndexPage | null> {
  const params = new URLSearchParams()
  if (options.cursor) params.set('cursor', options.cursor)
  params.set('limit', String(Math.min(MAX_INDEX_LIMIT, Math.max(1, Math.floor(options.limit || 48)))))
  if (options.tag) params.set('tag', options.tag.slice(0, 60))
  if (options.q) params.set('q', options.q.slice(0, 80))
  if (options.sort) params.set('sort', options.sort)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${indexBackendOrigin()}${INDEX_PATH}?${params}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'manual',
    })
    if (!res.ok) return null
    return parseIndexPage(await res.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/* ── Merge helpers (pure) ── */

/** Dedup identity: lowercase platform + canonical handle. */
export function creatorDedupeKey(creator: { platform?: string; username?: string; name?: string }): string {
  return `${(creator.platform || 'redgifs').toLowerCase()}:${canonicalCreator(creator.username || creator.name || '')}`
}

type Mergeable = {
  platform?: string; username?: string; name?: string; avatar?: string; followers?: number | null
  media?: unknown[]; mediaCount?: number; viewCount?: number; discoveryTags?: string[]
}

function richness(creator: Mergeable): number {
  return (creator.media?.length || 0) * 1_000_000 + (creator.mediaCount || 0) * 1_000 + Math.min(999, Math.log1p(creator.viewCount || 0))
}

/** Merge two records of the same creator: keep the richer one, backfill avatar/followers, union tags. */
export function mergeRecords<T extends Mergeable>(a: T, b: T): T {
  const [rich, other] = richness(b) > richness(a) ? [b, a] : [a, b]
  const tags = [...new Set([...(rich.discoveryTags || []), ...(other.discoveryTags || [])])].slice(0, 20)
  return {
    ...rich,
    avatar: rich.avatar || other.avatar || '',
    followers: rich.followers ?? other.followers ?? null,
    discoveryTags: tags,
  }
}

/** Dedupe by platform+handle (first occurrence order kept), merging duplicates. */
export function mergeCreators<T extends Mergeable>(lists: ReadonlyArray<ReadonlyArray<T>>): T[] {
  const byKey = new Map<string, T>()
  for (const list of lists) {
    for (const creator of list) {
      const key = creatorDedupeKey(creator)
      const existing = byKey.get(key)
      byKey.set(key, existing ? mergeRecords(existing, creator) : creator)
    }
  }
  return [...byKey.values()]
}
