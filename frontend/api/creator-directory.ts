/**
 * GET /api/creator-directory?cursor=&limit=48&tag=&sort=smart|newest|popular
 *
 * Paged enumeration of public creators across many gay/male niche lanes and depths
 * (see _lib/discovery-lanes.ts). Each request scans a bounded batch of
 * (lane, order, page) units in parallel, aggregates by provider userName, and returns
 * creators not already served in this cursor chain.
 *
 * Paging model: the opaque cursor carries the next unit index, a page counter and
 * compact hashes of creators already returned. If a scanned batch yields more new
 * creators than `limit`, the cursor stays on the same batch (the surplus is served
 * next, from a deterministic re-scan). Sorting applies within a page's batch only;
 * the directory is an enumeration, not a global ranking.
 */
export const config = { runtime: 'edge', maxDuration: 30 }

import { aggregateCreators, sortDirectory, type DirectorySort } from './_lib/directory-build.js'
import {
  DISCOVERY_LANES, MAX_BATCH_UNITS, MAX_DIRECTORY_PAGES, PROVIDER_PAGE_SIZE, batchAt, creatorHash, decodeCursor,
  encodeCursor, laneForTag, planUnits, runBounded, type LaneUnit,
} from './_lib/discovery-lanes.js'
import { REDGIFS_API, fetchWithTimeout, getRedgifsToken, type RedgifsItem } from './_lib/redgifs.js'

const BUDGET_MS = 10_000
const REQUEST_TIMEOUT_MS = 6_500
const MAX_BATCHES_PER_REQUEST = 3
const MAX_CONCURRENCY = 8
const SORTS = new Set(['smart', 'newest', 'popular'])

function headers(ok: boolean): Record<string, string> {
  const cache = ok ? 'public, s-maxage=600, stale-while-revalidate=3600' : 'no-store'
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': cache,
    'CDN-Cache-Control': cache,
    'Vercel-CDN-Cache-Control': cache,
    'Content-Type': 'application/json; charset=utf-8',
  }
}

function fail(status: number, error: string, detail: string): Response {
  return new Response(JSON.stringify({ error, detail, creators: [], nextCursor: null, total: null, lanes: [], updatedAt: new Date().toISOString() }), {
    status, headers: headers(false),
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(true) })
  if (req.method !== 'GET') return fail(405, 'method_not_allowed', 'Use GET.')
  try {
    const url = new URL(req.url)
    const rawSort = (url.searchParams.get('sort') || 'smart').toLowerCase()
    if (!SORTS.has(rawSort)) return fail(400, 'invalid_sort', 'sort must be smart, newest or popular.')
    const sort = rawSort as DirectorySort
    const limitRaw = url.searchParams.get('limit')
    const limitParsed = limitRaw === null || limitRaw === '' ? 48 : Number(limitRaw)
    if (!Number.isFinite(limitParsed)) return fail(400, 'invalid_limit', 'limit must be a number.')
    const limit = Math.min(96, Math.max(1, Math.floor(limitParsed)))

    const tagParam = (url.searchParams.get('tag') || '').trim()
    const lane = tagParam ? laneForTag(tagParam) : null
    if (tagParam && !lane) return fail(400, 'invalid_tag', 'tag must contain at least 2 letters or digits.')
    const units = planUnits(lane ? [lane] : DISCOVERY_LANES)
    const chainTag = lane ? lane.tag : ''

    const cursorParam = url.searchParams.get('cursor')
    const cursor = cursorParam ? decodeCursor(cursorParam) : { i: 0, n: 0, s: [], t: chainTag }
    if (!cursor) return fail(400, 'invalid_cursor', 'cursor is malformed.')
    if (cursor.t !== chainTag) return fail(400, 'invalid_cursor', 'cursor belongs to a different tag.')

    const deadline = Date.now() + BUDGET_MS
    const seen = new Set(cursor.s)
    let token: string
    try {
      token = await getRedgifsToken()
    } catch (error) {
      return fail(502, 'directory_unavailable', error instanceof Error ? error.message : 'provider auth failed')
    }

    const fetchUnit = async (unit: LaneUnit): Promise<RedgifsItem[]> => {
      const params = new URLSearchParams({
        type: 'g', tags: unit.tag, count: String(PROVIDER_PAGE_SIZE), page: String(unit.page), order: unit.order,
      })
      const remaining = Math.max(500, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()))
      const res = await fetchWithTimeout(`${REDGIFS_API}/gifs/search?${params}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'MediaCodex/1.0' },
        cache: 'no-store',
      }, remaining)
      if (!res.ok) throw new Error(`Public provider returned ${res.status}`)
      return ((await res.json()) as { gifs?: RedgifsItem[] }).gifs || []
    }

    const items: RedgifsItem[] = []
    const laneTagsById = new Map<string, Set<string>>()
    const laneStats = new Map<string, number>()
    let attempted = 0
    let succeeded = 0
    let pointer = cursor.i
    let scannedAny = false

    for (let round = 0; round < MAX_BATCHES_PER_REQUEST; round += 1) {
      const batch = batchAt(units, pointer, Math.min(MAX_BATCH_UNITS, MAX_CONCURRENCY))
      if (!batch.length) break
      if (round > 0 && deadline - Date.now() < 4_000) break
      scannedAny = true
      const results = await runBounded(batch.map((unit) => () => fetchUnit(unit)), MAX_CONCURRENCY, deadline)
      attempted += batch.length
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled') return
        succeeded += 1
        const unit = batch[index]
        laneStats.set(unit.tag, (laneStats.get(unit.tag) || 0) + 1)
        for (const item of result.value) {
          if (!item.id) continue
          items.push(item)
          const tags = laneTagsById.get(item.id) || new Set<string>()
          tags.add(unit.tag)
          laneTagsById.set(item.id, tags)
        }
      })
      pointer += batch.length
      const fresh = aggregateCreators(items, laneTagsById).filter((creator) => !seen.has(creatorHash(creator.key)))
      if (fresh.length >= limit) break
    }

    if (scannedAny && attempted > 0 && succeeded === 0) {
      return fail(502, 'directory_unavailable', 'Public provider search is temporarily unavailable.')
    }

    const fresh = sortDirectory(aggregateCreators(items, laneTagsById).filter((creator) => !seen.has(creatorHash(creator.key))), sort)
    const page = fresh.slice(0, limit)
    const surplus = fresh.length > limit
    const nextPages = cursor.n + 1
    const nextIndex = surplus ? cursor.i : pointer
    const nextSeen = [...cursor.s, ...page.map((creator) => creatorHash(creator.key))]
    const exhausted = !surplus && nextIndex >= units.length
    const nextCursor = exhausted || nextPages >= MAX_DIRECTORY_PAGES
      ? null
      : encodeCursor({ i: nextIndex, n: nextPages, s: nextSeen, t: chainTag })

    return new Response(JSON.stringify({
      creators: page.map(({ key: _key, ...creator }) => creator),
      nextCursor,
      total: null,
      lanes: [...laneStats.entries()].map(([tag, pagesScanned]) => ({ tag, pagesScanned })),
      updatedAt: new Date().toISOString(),
    }), { status: 200, headers: headers(true) })
  } catch (error) {
    return fail(502, 'directory_unavailable', error instanceof Error ? error.message : String(error))
  }
}
