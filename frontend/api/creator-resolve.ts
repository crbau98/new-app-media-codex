/**
 * Resolve a free-text creator name or handle to PUBLIC platform creator profiles.
 *
 *   GET /api/creator-resolve?q=<name|handle|profile url>&limit=8
 *
 * Order: curated registry -> handle variants probed in parallel -> Redgifs text search
 * (+ best-effort creators endpoint) -> other public sources (`searchSourceCreators`).
 * Only public platform accounts are returned; nothing about real-world identity is
 * inferred. Never throws; provider trouble degrades to fewer candidates (502 only when
 * every provider call failed and nothing else was found).
 */
export const config = { runtime: 'edge', maxDuration: 20 }

import type { SourceCreatorHit } from './_lib/discovery-types.js'
import { findRegistryEntries, registryRedgifsHandles } from './_lib/creator-registry.js'
import {
  handleVariants, mapLimit, mergeVariants, nameSimilarity, rankCandidates, sanitizeQuery, sharesToken,
  type RawCandidate,
} from './_lib/creator-resolve.js'
import {
  aggregateUserNames, canonicalCreator, probeUser, searchCreatorsEndpoint, searchGifsByText,
  type UserProbe,
} from './_lib/redgifs.js'
import { searchSourceCreators } from './_lib/sources/creator-search.js'

const CONCURRENCY = 6
const BUDGET_MS = 12_000
const DEFAULT_LIMIT = 8
const MAX_LIMIT = 20

const RATE_LIMIT = 30
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
  const cache = ok ? 'public, s-maxage=600, stale-while-revalidate=1800' : 'no-store'
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': cache,
    'CDN-Cache-Control': cache,
    'Vercel-CDN-Cache-Control': cache,
    'Content-Type': 'application/json; charset=utf-8',
  }
}

const json = (body: unknown, status: number, ok = status === 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers(ok), ...extra } })

export type ResolveResult = {
  candidates: SourceCreatorHit[]
  tried: string[]
  providerCalls: number
  providerFailures: number
}

const redgifsUrl = (handle: string) => `https://www.redgifs.com/users/${encodeURIComponent(handle)}`

/** Resolve `text` (already sanitised) to candidate creator profiles. */
export async function resolveCreators(text: string, limit = DEFAULT_LIMIT): Promise<ResolveResult> {
  const deadline = Date.now() + BUDGET_MS
  const entries = findRegistryEntries(text)
  const registryHandles = registryRedgifsHandles(entries)
  const names = [text, ...entries.map((e) => e.canonicalName)]
  const variants = mergeVariants(names.map((n) => handleVariants(n))).filter((v) => !registryHandles.includes(v))

  const sourceAbort = new AbortController()
  const sourceTimer = setTimeout(() => sourceAbort.abort(), 8_000)
  const sourcePromise: Promise<SourceCreatorHit[]> = searchSourceCreators(text, { limit, signal: sourceAbort.signal })
    .catch(() => [] as SourceCreatorHit[])
    .finally(() => clearTimeout(sourceTimer))

  let providerCalls = 0
  let providerFailures = 0
  const probes = new Map<string, UserProbe>()
  const probed: string[] = []
  const rawCandidates: RawCandidate[] = []
  const joined = variants[0] || text

  type Task = () => Promise<void>
  const probeTask = (handle: string, origin: 'registry' | 'variant', variantIndex?: number): Task => async () => {
    if (Date.now() > deadline) return
    probed.push(handle)
    providerCalls += 1
    const probe = await probeUser(handle)
    if (probe.error) providerFailures += 1
    probes.set(canonicalCreator(handle), probe)
    if (origin === 'registry' || probe.exists) {
      rawCandidates.push({ handle: probe.userName || handle, origin, variantIndex, total: probe.exists ? probe.total : null })
    }
  }
  const textTask = (needle: string): Task => async () => {
    if (Date.now() > deadline) return
    providerCalls += 1
    try {
      const gifs = await searchGifsByText(needle, 40, 'top')
      for (const { userName, count } of aggregateUserNames(gifs)) {
        const sim = nameSimilarity(text, userName)
        if (sim >= 0.5 || count >= 3 || (count >= 2 && sharesToken(text, userName))) rawCandidates.push({ handle: userName, origin: 'text', mentions: count })
      }
    } catch { providerFailures += 1 }
  }
  const endpointTask: Task = async () => {
    if (Date.now() > deadline) return
    const rows = await searchCreatorsEndpoint(text).catch(() => [])
    for (const row of rows) {
      if (nameSimilarity(text, row.userName) >= 0.5) rawCandidates.push({ handle: row.userName, origin: 'endpoint', mentions: 1 })
    }
  }

  const tasks: Task[] = [
    ...registryHandles.map((h) => probeTask(h, 'registry')),
    ...variants.slice(0, 6).map((v, i) => probeTask(v, 'variant', i)),
    textTask(text),
    endpointTask,
    ...(joined !== text ? [textTask(joined)] : []),
    ...variants.slice(6).map((v, i) => probeTask(v, 'variant', i + 6)),
  ]
  await mapLimit(tasks, CONCURRENCY, (task) => task())

  const ranked = rankCandidates(text, rawCandidates)
  // Fill avatar / count for top text-search hits that were never probed directly.
  const missing = ranked.slice(0, Math.min(limit, 4)).filter((c) => !probes.has(canonicalCreator(c.handle)))
  if (missing.length && Date.now() < deadline) {
    await mapLimit(missing, 4, async (c) => {
      providerCalls += 1
      const probe = await probeUser(c.handle)
      if (probe.error) providerFailures += 1
      probes.set(canonicalCreator(c.handle), probe)
    })
  }

  const registryName = entries.length === 1 ? entries[0].canonicalName : undefined
  const merged = new Map<string, SourceCreatorHit>()
  for (const cand of ranked) {
    const key = `redgifs:${canonicalCreator(cand.handle)}`
    const probe = probes.get(canonicalCreator(cand.handle))
    const entry = entries.find((e) => (e.handles.redgifs || []).some((h) => canonicalCreator(h) === canonicalCreator(cand.handle)))
    const viaRegistry = Boolean(entry) || (Boolean(registryName) && cand.origin !== 'text' && cand.origin !== 'endpoint')
    merged.set(key, {
      handle: cand.handle,
      displayName: entry?.canonicalName || (viaRegistry ? registryName! : cand.handle),
      platform: 'Redgifs',
      profileUrl: redgifsUrl(cand.handle),
      avatar: probe?.avatar,
      followers: null,
      mediaCount: probe?.exists ? probe.total : (cand.total ?? null),
      confidence: cand.confidence,
      matchedBy: cand.matchedBy,
      sourceAttribution: cand.origin === 'registry'
        ? 'Redgifs public profile (curated alias registry)'
        : cand.origin === 'variant'
          ? 'Redgifs public profile (handle variant of the searched name)'
          : 'Redgifs public profile (found via public search)',
    })
  }
  for (const hit of await sourcePromise) {
    const key = `${hit.platform.toLowerCase()}:${canonicalCreator(hit.handle)}`
    const existing = merged.get(key)
    if (!existing || hit.confidence > existing.confidence) merged.set(key, { ...existing, ...hit })
  }
  const candidates = [...merged.values()]
    .sort((a, b) => b.confidence - a.confidence || (b.mediaCount ?? 0) - (a.mediaCount ?? 0))
    .slice(0, limit)
  return { candidates, tried: probed, providerCalls, providerFailures }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...headers(true), 'Access-Control-Allow-Methods': 'GET, OPTIONS' } })
  }
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
  try {
    const url = new URL(req.url)
    const sanitized = sanitizeQuery(url.searchParams.get('q') || '')
    if (!sanitized.ok) return json({ error: 'invalid_query', reason: (sanitized as { reason: string }).reason }, 400)
    const limitRaw = Number(url.searchParams.get('limit'))
    const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(MAX_LIMIT, Math.floor(limitRaw)) : DEFAULT_LIMIT
    if (!consumeBudget(clientIp(req))) {
      return json({ error: 'rate_limited', detail: 'Too many lookups; retry shortly.' }, 429, false, { 'Retry-After': '30' })
    }
    const result = await resolveCreators(sanitized.text, limit)
    if (!result.candidates.length && result.providerCalls > 0 && result.providerFailures >= result.providerCalls) {
      return json({ error: 'providers_unavailable', query: sanitized.text, tried: result.tried }, 502)
    }
    return json({
      query: sanitized.text,
      candidates: result.candidates,
      tried: result.tried,
      updatedAt: new Date().toISOString(),
    }, 200)
  } catch (error) {
    return json({ error: 'creator_resolve_failed', detail: error instanceof Error ? error.message : String(error) }, 502)
  }
}
