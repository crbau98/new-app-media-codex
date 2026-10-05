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
 *
 * Persistent index (additive): when the Render backend's creator index answers
 * (`_lib/index-client.ts`, 3 s timeout) its creators are merged with the live lanes
 * (dedupe by lowercase platform + handle, richer record wins), `total` becomes real
 * and `sources` reports how many creators each half contributed. The opaque cursor
 * gains an optional `x` field (index keyset cursor; '' = index exhausted) that older
 * cursors simply lack. If the index is unreachable the endpoint degrades silently to
 * live-only behaviour.
 */
export const config = { runtime: 'edge', maxDuration: 30 }

import { aggregateCreators, sortDirectory, type DirectoryCreator, type DirectorySort } from './_lib/directory-build.js'
import {
  DISCOVERY_LANES, MAX_BATCH_UNITS, MAX_DIRECTORY_PAGES, MAX_SEEN_HASHES, PROVIDER_PAGE_SIZE, batchAt, creatorHash, decodeCursor,
  laneForTag, planUnits, runBounded, type DirectoryCursor, type LaneUnit,
} from './_lib/discovery-lanes.js'
import { fetchHiddenKeys, isHiddenCreator, fetchIndexPage, mergeCreators, mergeRecords, creatorDedupeKey, type IndexCreator, type IndexPage } from './_lib/index-client.js'
import { REDGIFS_API, canonicalCreator, fetchWithTimeout, getRedgifsToken, type RedgifsItem } from './_lib/redgifs.js'

const BUDGET_MS = 10_000
const REQUEST_TIMEOUT_MS = 6_500
const MAX_BATCHES_PER_REQUEST = 3
const MAX_CONCURRENCY = 8
const SORTS = new Set(['smart', 'newest', 'popular'])

type OutCreator = Omit<DirectoryCreator, 'key'> | IndexCreator

/** Hash identity for "already served": Redgifs by canonical handle (shared with live lanes), others by platform. */
function seenKey(creator: { platform?: string; username?: string; name?: string }): string {
  const canonical = canonicalCreator(creator.username || creator.name || '')
  return (creator.platform || 'Redgifs').toLowerCase() === 'redgifs' ? canonical : `${(creator.platform || '').toLowerCase()}:${canonical}`
}

function sortOut(creators: OutCreator[], sort: DirectorySort): OutCreator[] {
  const byName = (a: OutCreator, b: OutCreator) => creatorDedupeKey(a).localeCompare(creatorDedupeKey(b))
  const time = (c: OutCreator) => Date.parse(c.lastSeenAt || '') || 0
  const sorted = [...creators]
  if (sort === 'newest') return sorted.sort((a, b) => time(b) - time(a) || byName(a, b))
  if (sort === 'popular') return sorted.sort((a, b) => b.viewCount - a.viewCount || b.likeCount - a.likeCount || byName(a, b))
  return sorted.sort((a, b) => b.curationScore - a.curationScore || b.viewCount - a.viewCount || byName(a, b))
}

function b64url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Index half of the cursor: undefined = not started, '' = exhausted, otherwise the index keyset cursor. null = malformed. */
function readIndexCursor(value: string): string | '' | undefined | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
    const raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)))) as Record<string, unknown>
    if (raw.x === undefined) return undefined
    return typeof raw.x === 'string' && raw.x.length <= 600 && /^[A-Za-z0-9_=-]*$/.test(raw.x) ? raw.x : null
  } catch {
    return null
  }
}

function encodeChainCursor(cursor: DirectoryCursor, indexCursor: string): string {
  return b64url(JSON.stringify({ v: 1, ...cursor, s: cursor.s.slice(-MAX_SEEN_HASHES), x: indexCursor }))
}

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
    const indexCursor = cursorParam ? readIndexCursor(cursorParam) : undefined
    if (indexCursor === null) return fail(400, 'invalid_cursor', 'cursor is malformed.')

    const deadline = Date.now() + BUDGET_MS
    const seen = new Set(cursor.s)

    // Persistent index half (soft-fails to null); runs concurrently with the live scan.
    const indexQuota = Math.max(1, Math.ceil(limit / 2))
    const indexPromise: Promise<IndexPage | null> = indexCursor === ''
      ? Promise.resolve(null)
      : fetchIndexPage({ cursor: indexCursor || undefined, limit: indexQuota, tag: lane?.tag, sort })

    const hiddenKeys = await fetchHiddenKeys()
    let liveError = ''
    const liveDone = cursor.i >= units.length
    let token = ''
    if (!liveDone) {
      try {
        token = await getRedgifsToken()
      } catch (error) {
        liveError = error instanceof Error ? error.message : 'provider auth failed'
      }
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

    for (let round = 0; round < MAX_BATCHES_PER_REQUEST && token; round += 1) {
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
          if (hiddenKeys.has(`redgifs:${canonicalCreator(item.userName || '')}`)) continue
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

    if (scannedAny && attempted > 0 && succeeded === 0) liveError = 'Public provider search is temporarily unavailable.'

    const indexPage = await indexPromise
    const indexCreators = (indexPage?.creators || []).filter((creator) => !seen.has(creatorHash(seenKey(creator))) && !isHiddenCreator(hiddenKeys, creator))
    if (liveError && !indexCreators.length) return fail(502, 'directory_unavailable', liveError)

    // Live creators that the index also returned are merged into the index record (richer wins).
    const liveFresh = liveError
      ? []
      : sortDirectory(aggregateCreators(items, laneTagsById).filter((creator) => !seen.has(creatorHash(creator.key))), sort)
    const indexByKey = new Map<string, IndexCreator>(indexCreators.map((creator) => [creatorDedupeKey(creator), creator]))
    const overlap = new Map<string, DirectoryCreator>()
    const liveOnly: DirectoryCreator[] = []
    for (const creator of liveFresh) {
      const key = creatorDedupeKey(creator)
      if (indexByKey.has(key)) overlap.set(key, creator)
      else liveOnly.push(creator)
    }
    const mergedIndex = indexCreators.map((creator) => {
      const live = overlap.get(creatorDedupeKey(creator))
      if (!live) return creator
      const { key: _key, ...rest } = live
      return mergeRecords<OutCreator>(creator, rest) as OutCreator
    })
    const liveQuota = Math.max(0, limit - mergedIndex.length)
    const livePage = liveOnly.slice(0, liveQuota)
    const surplus = liveOnly.length > liveQuota
    const page = sortOut(mergeCreators<OutCreator>([mergedIndex, livePage.map(({ key: _key, ...creator }) => creator)]), sort)

    const nextPages = cursor.n + 1
    const nextIndex = liveError || surplus ? cursor.i : pointer
    const servedHashes = [
      ...livePage.map((creator) => creatorHash(creator.key)),
      ...[...overlap.values()].map((creator) => creatorHash(creator.key)),
      ...indexCreators.map((creator) => creatorHash(seenKey(creator))),
    ]
    const nextSeen = [...cursor.s, ...servedHashes]
    let nextIndexCursor: string
    if (indexCursor === '') nextIndexCursor = ''
    else if (indexPage) nextIndexCursor = indexPage.nextCursor || ''
    else nextIndexCursor = indexCursor === undefined ? '' : indexCursor // mid-chain outage: retry; never had the index: live-only
    const exhausted = !liveError && !surplus && nextIndex >= units.length && nextIndexCursor === ''
    const nextCursor = exhausted || nextPages >= MAX_DIRECTORY_PAGES
      ? null
      : encodeChainCursor({ i: nextIndex, n: nextPages, s: nextSeen, t: chainTag }, nextIndexCursor)

    return new Response(JSON.stringify({
      creators: page,
      nextCursor,
      total: indexPage && indexPage.total !== null ? Math.max(indexPage.total, page.length) : null,
      sources: { index: mergedIndex.length, live: page.length - mergedIndex.length + overlap.size },
      lanes: [...laneStats.entries()].map(([tag, pagesScanned]) => ({ tag, pagesScanned })),
      updatedAt: new Date().toISOString(),
    }), { status: 200, headers: headers(true) })
  } catch (error) {
    return fail(502, 'directory_unavailable', error instanceof Error ? error.message : String(error))
  }
}
