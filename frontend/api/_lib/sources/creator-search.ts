/**
 * Cross-source creator search (non-Redgifs public sources): PeerTube channels/
 * accounts, ActivityPub/Mastodon-compatible accounts (+ WebFinger), and
 * metadata-only web leads for creator profile URLs. Owned by the sources stream.
 * The resolver (`api/creator-resolve.ts`) calls this alongside its Redgifs lookups.
 *
 * Contract: never throws; returns [] when nothing matches or a source is down;
 * respects `limit` and the abort signal; public metadata only.
 *
 * Privacy: emails/phone-like inputs are rejected before any network call; only
 * public counts are returned; no attempt is made to identify a real-world person
 * beyond the public account that matched the search text.
 */
import type { SourceCreatorHit } from '../discovery-types.js'
import { searchCreatorWebLeads } from '../creator-web-leads.js'
import { searchActivityPubCreators } from './activitypub-creators.js'
import { searchPeerTubeCreators } from './peertube-creators.js'

export const CREATOR_SEARCH_BUDGET_MS = 7000
const DEFAULT_LIMIT = 8
const MAX_LIMIT = 24
const MIN_CONFIDENCE = 0.3
const CACHE_MAX = 200
const CACHE_TTL_MS = 10 * 60 * 1000
const LINK_ONLY_PLATFORMS = new Set(['OnlyFans', 'Fansly', 'JustFor.Fans'])

/* ---------------------------- input hygiene ---------------------------- */

/**
 * Returns a cleaned query, or null when the input must not be searched
 * (too short/long, e-mail address, phone-like number). A federated handle must
 * carry a leading `@` (`@user@host`); a bare `a@b.tld` is treated as an e-mail.
 */
export function sanitizeCreatorQuery(input: string): string | null {
  const q = String(input ?? '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()
  if (q.length < 2 || q.length > 80) return null
  if (!q.startsWith('@') && /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(q)) return null
  if (/^@[^@\s]+\.[a-z]{2,}$/i.test(q)) return null
  const digits = q.replace(/\D/g, '')
  if (digits.length >= 8 && /^[\d\s()+.-]+$/.test(q)) return null
  if (/^https?:\/\//i.test(q)) return null
  return q
}

/* ------------------------------- scoring ------------------------------- */

const norm = (v: string) => v.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '')
const tokens = (v: string) => v.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((t) => t.length >= 2)

export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i]
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** Name similarity 0..1: exact handle > exact name > contains > token overlap > fuzzy. */
export function nameSimilarity(query: string, hit: Pick<SourceCreatorHit, 'handle' | 'displayName'>): number {
  const q = norm(query.replace(/^@/, '').split('@')[0] || query)
  const fullQ = norm(query)
  if (!q) return 0
  const local = norm(hit.handle.split('@')[0])
  const name = norm(hit.displayName)
  if (q === local || fullQ === norm(hit.handle)) return 0.97
  if (q === name) return 0.92
  let best = 0
  if (q.length >= 3) {
    for (const field of [local, name]) {
      if (field.includes(q)) best = Math.max(best, 0.7 + 0.15 * (q.length / field.length))
      else if (field.length >= 3 && q.includes(field) && field.length / q.length >= 0.6) best = Math.max(best, 0.55)
    }
  }
  const qTokens = tokens(query.replace(/^@/, '').split('@')[0] || query)
  if (qTokens.length) {
    const hay = tokens(`${hit.displayName} ${hit.handle.split('@')[0]}`)
    const hayJoined = norm(`${hit.displayName} ${hit.handle.split('@')[0]}`)
    const matched = qTokens.filter((t) => hay.includes(t) || (t.length >= 4 && hayJoined.includes(t))).length
    const cov = matched / qTokens.length
    if (cov === 1) best = Math.max(best, 0.8)
    else if (matched) best = Math.max(best, 0.35 + 0.35 * cov)
  }
  for (const field of [local, name]) {
    const max = Math.max(field.length, q.length)
    if (max >= 4) {
      const sim = 1 - editDistance(q, field) / max
      if (sim >= 0.6) best = Math.max(best, 0.6 * sim)
    }
  }
  return Math.min(best, 0.95)
}

function scoreHit(query: string, hit: SourceCreatorHit): SourceCreatorHit | null {
  const similarity = nameSimilarity(query, hit)
  const factor = LINK_ONLY_PLATFORMS.has(hit.platform) ? 0.5 : hit.sourceAttribution.startsWith('DuckDuckGo') ? 0.7 : 0.95
  const confidence = Math.round(similarity * factor * 100) / 100
  if (confidence < MIN_CONFIDENCE) return null
  const exactHandle = norm(hit.handle.split('@')[0]) === norm(query.replace(/^@/, '').split('@')[0])
  return { ...hit, confidence, matchedBy: exactHandle ? 'exact' : hit.matchedBy === 'exact' ? 'exact' : 'search' }
}

/* -------------------------------- cache -------------------------------- */

const cache = new Map<string, { at: number; hits: SourceCreatorHit[] }>()

export function clearCreatorSearchCache(): void {
  cache.clear()
}

export function creatorSearchCacheSize(): number {
  return cache.size
}

function cacheGet(key: string): SourceCreatorHit[] | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  cache.delete(key) // refresh LRU position
  cache.set(key, entry)
  return entry.hits
}

function cacheSet(key: string, hits: SourceCreatorHit[]): void {
  cache.delete(key)
  cache.set(key, { at: Date.now(), hits })
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/* ------------------------------ orchestrator --------------------------- */

/** Testable core: same as `searchSourceCreators` with an explicit time budget. */
export async function runCreatorSearch(
  query: string,
  opts: { limit?: number; signal?: AbortSignal } = {},
  budgetMs = CREATOR_SEARCH_BUDGET_MS,
): Promise<SourceCreatorHit[]> {
  try {
    const clean = sanitizeCreatorQuery(query)
    if (!clean) return []
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(opts.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT))
    if (opts.signal?.aborted) return []
    const key = norm(clean) || clean.toLowerCase()
    const cached = cacheGet(key)
    if (cached) return cached.slice(0, limit)

    const controller = new AbortController()
    const onAbort = () => controller.abort()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const raw: SourceCreatorHit[] = []
    const onHits = (hits: SourceCreatorHit[]) => { raw.push(...hits) }
    const run = (task: Promise<SourceCreatorHit[]>) => task.then(onHits, () => undefined)
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(() => { timedOut = true; controller.abort(); resolve() }, budgetMs)
      controller.signal.addEventListener('abort', () => resolve(), { once: true })
    })
    try {
      const signal = controller.signal
      await Promise.race([
        Promise.all([
          run(searchPeerTubeCreators(clean, { signal, onHits })),
          run(searchActivityPubCreators(clean, { signal, onHits })),
          run(searchCreatorWebLeads(clean, { signal })),
        ]),
        budget,
      ])
    } finally {
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }

    const best = new Map<string, SourceCreatorHit>()
    for (const hit of raw) {
      const scored = scoreHit(clean, hit)
      if (!scored) continue
      const id = `${scored.platform.toLowerCase()}:${scored.handle.toLowerCase()}`
      const existing = best.get(id)
      if (!existing || scored.confidence > existing.confidence) best.set(id, scored)
    }
    const ranked = [...best.values()].sort((a, b) => b.confidence - a.confidence || (b.followers ?? 0) - (a.followers ?? 0)).slice(0, MAX_LIMIT)
    // Partial (budget-cut or caller-aborted) results are not cached.
    if (ranked.length && !timedOut && !opts.signal?.aborted) cacheSet(key, ranked)
    return ranked.slice(0, limit)
  } catch {
    return []
  }
}

export async function searchSourceCreators(
  query: string,
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<SourceCreatorHit[]> {
  return runCreatorSearch(query, opts)
}
