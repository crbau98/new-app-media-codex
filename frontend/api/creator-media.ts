/**
 * A creator's full public catalog, paged.
 *
 * `/api/live-media` only samples the feed, so a creator card there carries the
 * handful of posts that happened to be in that sample. This endpoint asks the
 * public provider for the creator's own catalog (`/users/{handle}/search`) and
 * returns every page on demand, with the same eligibility rules, sanitising,
 * stream ordering and media-intelligence fields as the feed. Nothing is stored.
 */
export const config = { runtime: 'edge', maxDuration: 20 }

import { findRegistryEntries, registryRedgifsHandles } from './_lib/creator-registry.js'
import { handleVariants, mapLimit, mergeVariants, sanitizeQuery } from './_lib/creator-resolve.js'
import { dedupeItems, pruneUnplayable, withContract } from './_lib/media-normalize.js'
import {
  canonicalCreator, fetchCreatorCatalogPage, hasPlayableUrls, isEligibleScopedItem,
  mapRedgifsItem, providerHandle, sanitizeProviderItem, type CreatorCatalogPage,
} from './_lib/redgifs.js'
import { fetchHiddenKeys } from './_lib/index-client.js'

const MAX_COUNT = 60
const MAX_PAGE = 200
const ORDERS = { recent: 'recent', top: 'top', trending: 'trending' } as const

function headers(ok: boolean): Record<string, string> {
  const cache = ok ? 'public, s-maxage=300, stale-while-revalidate=900' : 'no-store'
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': cache,
    'CDN-Cache-Control': cache,
    'Vercel-CDN-Cache-Control': cache,
    'Content-Type': 'application/json; charset=utf-8',
  }
}

function boundedInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && value !== null && value.trim() !== ''
    ? Math.min(max, Math.max(min, Math.floor(parsed)))
    : fallback
}

const NAME_LOOKUP_TIMEOUT_MS = 5_000
const MAX_NAME_VARIANTS = 12

/**
 * `creator` may be a display name ("Michael Yerger"). Try registry handles, then handle
 * variants (in small parallel batches, most likely first) and use the first that has posts.
 */
async function resolveNameToCatalog(
  name: string, page: number, count: number, order: 'recent' | 'top' | 'trending', skip = '',
): Promise<{ handle: string; catalog: CreatorCatalogPage } | null> {
  const entries = findRegistryEntries(name)
  const registry = registryRedgifsHandles(entries)
  const variants = mergeVariants([name, ...entries.map((e) => e.canonicalName)].map((n) => handleVariants(n)), MAX_NAME_VARIANTS)
  const ordered = [...registry, ...variants.filter((v) => !registry.includes(v))].filter((h) => h !== skip)
  for (let i = 0; i < ordered.length; i += 4) {
    const batch = ordered.slice(i, i + 4)
    const results = await mapLimit(batch, 4, (handle) =>
      fetchCreatorCatalogPage(handle, page, count, order, NAME_LOOKUP_TIMEOUT_MS))
    const hit = results.findIndex((r) => r && r.gifs.length > 0)
    if (hit >= 0) return { handle: batch[hit], catalog: results[hit]! }
  }
  return null
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(true) })
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: headers(false) })
  }
  const url = new URL(req.url)
  const rawCreator = url.searchParams.get('creator') || ''
  const looksLikeName = /\s/.test(rawCreator.trim())
  const sanitized = sanitizeQuery(rawCreator)
  let handle = providerHandle(sanitized.ok ? sanitized.text.replace(/\s+/g, '') : '')
  if (!sanitized.ok || canonicalCreator(handle).length < 2) {
    return new Response(JSON.stringify({ error: 'invalid_creator' }), { status: 400, headers: headers(false) })
  }
  const strict = url.searchParams.get('strict') !== '0'
  const page = boundedInt(url.searchParams.get('page'), 1, 1, MAX_PAGE)
  const count = boundedInt(url.searchParams.get('count'), 40, 1, MAX_COUNT)
  const orderKey = (url.searchParams.get('order') || 'recent').toLowerCase()
  const order = ORDERS[orderKey as keyof typeof ORDERS] || 'recent'

  try {
    let catalog: CreatorCatalogPage | undefined
    if (looksLikeName) {
      const resolved = await resolveNameToCatalog(sanitized.text, page, count, order)
      if (resolved) { handle = resolved.handle; catalog = resolved.catalog }
      else catalog = { gifs: [], page, pages: 0, total: 0 }
    } else {
      catalog = await fetchCreatorCatalogPage(handle, page, count, order)
      if (catalog.gifs.length === 0 && page === 1) {
        // Exact handle had nothing: the value may be a name written without spaces or a
        // registry alias; try the resolver's variants before reporting an empty catalog.
        const resolved = await resolveNameToCatalog(sanitized.text, page, count, order, handle).catch(() => null)
        if (resolved) { handle = resolved.handle; catalog = resolved.catalog }
      }
    }
    const wanted = canonicalCreator(handle)
    // Removed by takedown/operator: serve an empty catalog rather than the provider's copy.
    const removed = (await fetchHiddenKeys()).has(`redgifs:${wanted}`)
    const mapped = (removed ? [] : catalog.gifs)
      .map(sanitizeProviderItem)
      // The provider path is already creator-scoped; keep it exact anyway.
      .filter((item) => canonicalCreator(item.userName || '') === wanted)
      // strict=0 (explicit creator lookups): never hide part of an explicitly requested catalog.
      .filter((item) => !strict || isEligibleScopedItem(item))
      .filter(hasPlayableUrls)
      .map((item) => withContract(mapRedgifsItem(item)))
    const pruned = pruneUnplayable(dedupeItems(mapped))
    return new Response(JSON.stringify({
      creator: handle,
      resolvedHandle: handle,
      requested: sanitized.text,
      strict,
      items: pruned.items,
      page: catalog.page,
      pages: catalog.pages,
      total: catalog.total,
      hasMore: catalog.page < catalog.pages,
      source: 'Redgifs',
      // Items the provider returned that were filtered out (ineligible/unplayable) so
      // clients can explain a page that is shorter than requested.
      skipped: catalog.gifs.length - pruned.items.length,
      updatedAt: new Date().toISOString(),
    }), { status: 200, headers: headers(true) })
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'creator_media_unavailable',
      detail: error instanceof Error ? error.message : String(error),
    }), { status: 502, headers: headers(false) })
  }
}
