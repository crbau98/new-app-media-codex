/**
 * Related creators + links a creator published elsewhere.
 *
 *   GET /api/creator-related?creator=<handle>&platform=redgifs&limit=12
 *   -> { creator, related: RelatedCreator[], elsewhere: ElsewhereLink[], updatedAt, partial? }
 *
 * related   = creators whose public posts share this creator's distinctive tags (bounded,
 *             soft-failing provider tag searches).
 * elsewhere = links the creator PUBLISHED themselves (registry, Bluesky/Mastodon bio). Never inferred.
 * Never throws; 502 only when every source failed and nothing was found.
 */
export const config = { runtime: 'edge', maxDuration: 20 }

import {
  backgroundFrequency, buildTagProfile, dedupeLinks, fetchBlueskyLinks, fetchMastodonLinks, pickQueryTags,
  rankRelated, registryLinks, type ElsewhereLink, type RelatedCreator,
} from './_lib/creator-graph.js'
import { findRegistryEntries } from './_lib/creator-registry.js'
import {
  canonicalCreator, fetchCreatorCatalogPage, fetchWithTimeout, getRedgifsToken, isEligibleScopedItem, REDGIFS_API,
  sanitizeProviderItem, type RedgifsItem,
} from './_lib/redgifs.js'

const DEFAULT_LIMIT = 12
const MAX_LIMIT = 24
const CATALOG_SAMPLE = 40
const TAG_QUERY_COUNT = 40
const PROVIDER_TIMEOUT = 5_000
const HANDLE_RE = /^[a-z0-9_.-]{2,50}$/

const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000
const buckets = new Map<string, { count: number; resetAt: number }>()

function consumeBudget(key: string): boolean {
  const now = Date.now()
  if (buckets.size > 4096) buckets.clear()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (bucket.count >= RATE_LIMIT) return false
  bucket.count += 1
  return true
}

function clientIp(req: Request): string {
  const chain = (req.headers.get('x-forwarded-for') || '').split(',').map((v) => v.trim()).filter(Boolean)
  return chain[chain.length - 1] || req.headers.get('x-real-ip') || 'unknown'
}

function headers(ok: boolean): Record<string, string> {
  const cache = ok ? 'public, s-maxage=900, stale-while-revalidate=1800' : 'no-store'
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': cache,
    'CDN-Cache-Control': cache,
    'Vercel-CDN-Cache-Control': cache,
    'Content-Type': 'application/json; charset=utf-8',
  }
}

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers(status === 200), ...extra } })

/** Normalise the `creator` param; null when it is not a plausible provider handle (emails rejected). */
export function validHandle(raw: string): string | null {
  const value = raw.trim().replace(/^@/, '').toLowerCase()
  return HANDLE_RE.test(value) && !value.includes('@') ? value : null
}

async function tagSearch(tag: string): Promise<RedgifsItem[]> {
  const token = await getRedgifsToken()
  const params = new URLSearchParams({ type: 'g', tags: tag, count: String(TAG_QUERY_COUNT), page: '1', order: 'trending' })
  const res = await fetchWithTimeout(`${REDGIFS_API}/gifs/search?${params}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'MediaCodex/1.0' },
    cache: 'no-store',
  }, PROVIDER_TIMEOUT)
  if (!res.ok) throw new Error(`Public provider returned ${res.status}`)
  const body = await res.json() as { gifs?: RedgifsItem[] }
  return Array.isArray(body.gifs) ? body.gifs : []
}

async function computeRelated(handle: string, limit: number): Promise<{ related: RelatedCreator[]; failed: boolean; degraded: boolean }> {
  const page = await fetchCreatorCatalogPage(handle, 1, CATALOG_SAMPLE, 'top', PROVIDER_TIMEOUT)
  const wanted = canonicalCreator(handle)
  const own = page.gifs
    .map(sanitizeProviderItem)
    .filter((item) => canonicalCreator(item.userName || '') === wanted && isEligibleScopedItem(item))
  const profile = buildTagProfile(own)
  const queryTags = pickQueryTags(profile, 3)
  if (!queryTags.length) return { related: [], failed: false, degraded: false }
  const settled = await Promise.allSettled(queryTags.map(tagSearch))
  const pool = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  const failed = settled.every((r) => r.status === 'rejected')
  const degraded = settled.some((r) => r.status === 'rejected')
  if (!pool.length) return { related: [], failed, degraded }
  // Re-weight against the pool so tags on every candidate count for less than distinctive ones.
  const weighted = buildTagProfile(own, backgroundFrequency(pool.map(sanitizeProviderItem)))
  return { related: rankRelated(pool, weighted.length ? weighted : profile, handle, limit), failed, degraded }
}

async function computeElsewhere(handle: string): Promise<{ links: ElsewhereLink[]; failed: boolean }> {
  const entries = findRegistryEntries(handle)
  const links: ElsewhereLink[] = registryLinks(entries, handle)
  const fetchers: Array<Promise<ElsewhereLink[]>> = []
  for (const entry of entries) {
    for (const acct of (entry.handles.bluesky || []).slice(0, 2)) fetchers.push(fetchBlueskyLinks(acct))
    for (const acct of (entry.handles.mastodon || []).slice(0, 2)) fetchers.push(fetchMastodonLinks(acct))
  }
  const settled = await Promise.allSettled(fetchers)
  for (const r of settled) if (r.status === 'fulfilled') links.push(...r.value)
  const self = canonicalCreator(handle)
  const filtered = links.filter((l) => !(l.platform === 'Redgifs' && canonicalCreator(l.handle) === self))
  return { links: dedupeLinks(filtered), failed: settled.length > 0 && settled.every((r) => r.status === 'rejected') }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(true) })
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
  try {
    const url = new URL(req.url)
    const handle = validHandle(url.searchParams.get('creator') || '')
    if (!handle) return json({ error: 'invalid_creator' }, 400)
    const platform = (url.searchParams.get('platform') || 'redgifs').toLowerCase()
    if (platform !== 'redgifs') return json({ error: 'unsupported_platform' }, 400)
    const requested = Number(url.searchParams.get('limit'))
    const limit = Number.isFinite(requested) && requested >= 1 ? Math.min(MAX_LIMIT, Math.floor(requested)) : DEFAULT_LIMIT
    if (!consumeBudget(clientIp(req))) return json({ error: 'rate_limited' }, 429, { 'Retry-After': '60' })

    const [related, elsewhere] = await Promise.allSettled([computeRelated(handle, limit), computeElsewhere(handle)])
    const links = elsewhere.status === 'fulfilled' ? elsewhere.value.links : []
    const rel = related.status === 'fulfilled' ? related.value.related : []
    const partial: string[] = []
    if (related.status === 'rejected' || (related.status === 'fulfilled' && related.value.degraded)) partial.push('related')
    if (elsewhere.status === 'rejected' || (elsewhere.status === 'fulfilled' && elsewhere.value.failed)) partial.push('elsewhere')
    const relatedFailed = related.status === 'rejected' || related.value.failed
    if (relatedFailed && !rel.length && !links.length) return json({ error: 'creator_related_unavailable' }, 502)
    const short = 'public, s-maxage=60, stale-while-revalidate=120'
    return json({
      creator: handle,
      related: rel,
      elsewhere: links,
      updatedAt: new Date().toISOString(),
      ...(partial.length ? { partial } : {}),
    }, 200, partial.length ? { 'Cache-Control': short, 'CDN-Cache-Control': short, 'Vercel-CDN-Cache-Control': short } : {})
  } catch (error) {
    return json({ error: 'creator_related_unavailable', detail: error instanceof Error ? error.message : String(error) }, 502)
  }
}
