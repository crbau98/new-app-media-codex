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

import { dedupeItems, pruneUnplayable, withContract } from './_lib/media-normalize.js'
import {
  canonicalCreator, fetchCreatorCatalogPage, hasPlayableUrls, isEligibleScopedItem,
  mapRedgifsItem, providerHandle, sanitizeProviderItem,
} from './_lib/redgifs.js'

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

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(true) })
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: headers(false) })
  }
  const url = new URL(req.url)
  const handle = providerHandle(url.searchParams.get('creator') || '')
  if (canonicalCreator(handle).length < 2) {
    return new Response(JSON.stringify({ error: 'invalid_creator' }), { status: 400, headers: headers(false) })
  }
  const page = boundedInt(url.searchParams.get('page'), 1, 1, MAX_PAGE)
  const count = boundedInt(url.searchParams.get('count'), 40, 1, MAX_COUNT)
  const orderKey = (url.searchParams.get('order') || 'recent').toLowerCase()
  const order = ORDERS[orderKey as keyof typeof ORDERS] || 'recent'

  try {
    const catalog = await fetchCreatorCatalogPage(handle, page, count, order)
    const wanted = canonicalCreator(handle)
    const mapped = catalog.gifs
      .map(sanitizeProviderItem)
      // The provider path is already creator-scoped; keep it exact anyway.
      .filter((item) => canonicalCreator(item.userName || '') === wanted)
      .filter(isEligibleScopedItem)
      .filter(hasPlayableUrls)
      .map((item) => withContract(mapRedgifsItem(item)))
    const pruned = pruneUnplayable(dedupeItems(mapped))
    return new Response(JSON.stringify({
      creator: handle,
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
