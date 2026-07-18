/**
 * Source-attributed public media discovery.
 *
 * This endpoint deliberately uses a public provider API and preserves a link
 * back to the original post. It does not scrape, cache, or rehost subscription
 * creator libraries. Ranking is explainable (public engagement + freshness),
 * never a model's judgement about a person's appearance.
 */
export const config = { runtime: 'edge', maxDuration: 30 }

import { rankSimilarCreatorsWithAI } from './_lib/ai-similarity.js'
import { collectAdditionalSources } from './_lib/multi-source.js'
import type { CreatorLead, UnifiedMediaItem } from './_lib/discovery-types.js'

const REDGIFS_API = 'https://api.redgifs.com/v2'
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const EMAIL_TEST = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const GENERIC_SIMILARITY_TAGS = new Set(['gay', 'male', 'men', 'man', 'video', 'verified'])
// Exclusion-only blocklist: strictly female/straight markers. Trans-related
// terms were removed — trans men are in scope, and identity terms must never
// be used as exclusion signals.
const FEMALE_MARKERS = [
  'female', 'woman', 'women', 'girl', 'lesbian', 'straight', 'pussy',
  'vagina', 'hetero',
  'girlfriend', 'wife', 'b/g', 'm/f', 'boob', 'breast', 'tits',
  'milf', 'femdom',
  'girls', 'chick', 'chicks', 'females',
]
const PROVIDER_TIMEOUT_MS = 9_000

/* ── Redgifs token cache (module scope, single-flight, ~20min TTL) ── */
const TOKEN_TTL_MS = 20 * 60 * 1_000
let redgifsTokenCache: { token: string; expiresAt: number } | null = null
let redgifsTokenPromise: Promise<string> | null = null

/* ── Best-effort edge rate limiting for expensive scans ──
   In-memory per-IP bucket: 6 AI/forced scans per 5 minutes. Edge isolates are
   ephemeral, so this is a best-effort guardrail, not a hard security boundary. */
const AI_SCAN_LIMIT = 6
const AI_SCAN_WINDOW_MS = 5 * 60 * 1_000
const aiScanBuckets = new Map<string, { count: number; resetAt: number }>()

function consumeScanBudget(key: string): boolean {
  const now = Date.now()
  if (aiScanBuckets.size > 4096) aiScanBuckets.clear()
  const bucket = aiScanBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    aiScanBuckets.set(key, { count: 1, resetAt: now + AI_SCAN_WINDOW_MS })
    return true
  }
  if (bucket.count >= AI_SCAN_LIMIT) return false
  bucket.count += 1
  return true
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') || ''
  const chain = forwarded.split(',').map((value) => value.trim()).filter(Boolean)
  return chain[chain.length - 1] || req.headers.get('x-real-ip') || 'unknown'
}

type RedgifsItem = {
  id?: string
  userName?: string
  description?: string
  tags?: string[]
  niches?: Array<string | { name?: string }>
  duration?: number
  likes?: number
  views?: number
  createDate?: number
  urls?: {
    hd?: string
    sd?: string
    poster?: string
    thumbnail?: string
  }
}

type LiveMediaItem = UnifiedMediaItem

type CreatorSimilarity = {
  score: number
  reasons: string[]
}

function redactEmails(value = ''): string {
  return value
    .replace(EMAIL_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

function sanitizeProviderItem(item: RedgifsItem): RedgifsItem {
  const creator = redactEmails(item.userName || '') || 'Public creator'
  return {
    ...item,
    userName: creator,
    description: redactEmails(item.description || '') || undefined,
    tags: (item.tags || []).map(redactEmails).filter(Boolean),
    niches: (item.niches || []).map((niche) => {
      if (typeof niche === 'string') return redactEmails(niche)
      return { ...niche, name: redactEmails(niche.name || '') }
    }).filter((niche) => typeof niche === 'string' ? Boolean(niche) : Boolean(niche.name)),
  }
}

function textFor(item: RedgifsItem): string {
  const niches = (item.niches || []).map((niche) =>
    typeof niche === 'string' ? niche : niche.name || ''
  )
  return [item.userName || '', ...(item.tags || []), ...niches, item.description || '']
    .join(' ')
    .toLowerCase()
}

function isEligibleScopedItem(item: RedgifsItem): boolean {
  // Provider tag-scoped searches (tags=Gay) and exact creator-profile lookups
  // are scope-proofed by the provider query itself; only exclusion markers are
  // applied here. We never infer identity, body, gender, or orientation.
  const tokens = new Set(textFor(item).split(/[^a-z0-9/]+/).filter(Boolean))
  return !FEMALE_MARKERS.some((marker) => tokens.has(marker))
}

function safeProviderMediaUrl(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined
    if (!/^(?:media|thumbs\d*)\.redgifs\.com$/i.test(url.hostname)) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function durationLabel(seconds = 0): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}

function toIsoDate(value?: number): string {
  if (!value || !Number.isFinite(value)) return ''
  const milliseconds = value > 1_000_000_000_000 ? value : value * 1000
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function proxiedMediaUrl(url?: string): string | undefined {
  return url ? `/api/archiver-proxy?url=${encodeURIComponent(url)}` : undefined
}

function percentile(value: number, cohort: number[]): number {
  if (cohort.length <= 1) return 0.5
  const below = cohort.filter((candidate) => candidate < value).length
  const equal = cohort.filter((candidate) => candidate === value).length
  return (below + Math.max(0, equal - 1) / 2) / (cohort.length - 1)
}

function rankCohort(items: LiveMediaItem[]): LiveMediaItem[] {
  const viewCohort = items.map((item) => Math.log1p(item.views))
  const likeCohort = items.map((item) => Math.log1p(item.likes))
  return items.map((item) => {
    const viewRank = percentile(Math.log1p(item.views), viewCohort)
    const likeRank = percentile(Math.log1p(item.likes), likeCohort)
    const created = Date.parse(item.createdAt)
    const hoursOld = Number.isFinite(created) ? Math.max(0, (Date.now() - created) / 3_600_000) : Number.POSITIVE_INFINITY
    const freshness = Math.exp(-hoursOld / (24 * 14))
    const score = Math.min(100, Math.round((viewRank * 0.48 + likeRank * 0.29 + freshness * 0.14) * 100 + (item.isWatchedCreator ? 9 : 0)))
    const reasons: string[] = []
    if (item.isWatchedCreator) reasons.push('creator is on your watchlist')
    if (viewRank >= 0.75) reasons.push('among the most watched in this feed')
    if (likeRank >= 0.75) reasons.push('strong public engagement')
    if (hoursOld <= 72) reasons.push('recently published')
    if (!reasons.length) reasons.push('adds variety to the current public feed')
    return { ...item, curationScore: score, curationReasons: reasons }
  })
}

function parseBoundedInt(value: string | null, fallback: number, maximum: number): number {
  if (value === null || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(0, Math.floor(parsed)))
}

function boundedQuery(value: string): string {
  return redactEmails(value).replace(/\s+/g, ' ').slice(0, 80)
}

function canonicalCreator(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function hostLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function parseWatchlistCandidates(candidates: string[]): string[] {
  const unique = new Map<string, string>()
  for (const raw of candidates) {
    if (EMAIL_TEST.test(raw)) continue
    const display = raw.trim().replace(/^@/, '').replace(/\s+/g, ' ').slice(0, 50)
    const key = canonicalCreator(display)
    if (key.length < 2 || unique.has(key)) continue
    unique.set(key, display)
    if (unique.size >= 8) break
  }
  return [...unique.values()]
}

function parseWatchlist(url: URL): string[] {
  return parseWatchlistCandidates([
    ...url.searchParams.getAll('watch'),
    ...(url.searchParams.get('watchlist') || '').split(','),
  ])
}

function creatorIsWatched(creator: string, watchlist: string[]): boolean {
  const key = canonicalCreator(creator)
  return Boolean(key) && watchlist.some((candidate) => canonicalCreator(candidate) === key)
}

function matchesQuery(item: RedgifsItem, query: string): boolean {
  if (!query) return true
  const haystack = textFor(item)
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token))
}

function sortItems(items: LiveMediaItem[], sort: string): LiveMediaItem[] {
  const sorted = [...items]
  if (sort === 'views') return sorted.sort((a, b) => b.views - a.views || b.likes - a.likes)
  if (sort === 'likes') return sorted.sort((a, b) => b.likes - a.likes || b.views - a.views)
  if (sort === 'newest') return sorted.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
  return sorted.sort((a, b) => b.curationScore - a.curationScore || b.views - a.views)
}

function diversifySources(items: LiveMediaItem[], count: number): LiveMediaItem[] {
  const selected: LiveMediaItem[] = []
  const seen = new Set<string>()
  const sources = [...new Set(items.map((item) => item.source))]
  for (const source of sources) {
    for (const item of items.filter((candidate) => candidate.source === source).slice(0, 6)) {
      if (selected.length >= count || seen.has(item.id)) continue
      selected.push(item)
      seen.add(item.id)
    }
  }
  for (const item of items) {
    if (selected.length >= count) break
    if (seen.has(item.id)) continue
    selected.push(item)
    seen.add(item.id)
  }
  return selected.sort((a, b) => items.indexOf(a) - items.indexOf(b))
}

function creatorSimilarities(items: LiveMediaItem[]): Map<string, CreatorSimilarity> {
  const byCreator = new Map<string, LiveMediaItem[]>()
  for (const item of items) {
    const creator = canonicalCreator(item.creator)
    if (!creator) continue
    byCreator.set(creator, [...(byCreator.get(creator) || []), item])
  }
  const watched = new Set(items.filter((item) => item.isWatchedCreator).map((item) => canonicalCreator(item.creator)))
  if (!watched.size) return new Map()

  const documentFrequency = new Map<string, number>()
  const vectors = new Map<string, Map<string, number>>()
  for (const [creator, creatorItems] of byCreator) {
    const counts = new Map<string, number>()
    for (const item of creatorItems) {
      for (const rawTag of item.tags) {
        const tag = rawTag.trim().toLowerCase()
        if (!tag || GENERIC_SIMILARITY_TAGS.has(tag)) continue
        counts.set(tag, (counts.get(tag) || 0) + 1)
      }
    }
    vectors.set(creator, counts)
    for (const tag of counts.keys()) documentFrequency.set(tag, (documentFrequency.get(tag) || 0) + 1)
  }

  const weighted = (counts: Map<string, number>): Map<string, number> => {
    const result = new Map<string, number>()
    for (const [tag, count] of counts) {
      const idf = Math.log((byCreator.size + 1) / ((documentFrequency.get(tag) || 0) + 1)) + 1
      result.set(tag, (1 + Math.log(count)) * idf)
    }
    return result
  }
  const seedCounts = new Map<string, number>()
  for (const creator of watched) {
    for (const [tag, count] of vectors.get(creator) || []) seedCounts.set(tag, (seedCounts.get(tag) || 0) + count)
  }
  const seed = weighted(seedCounts)
  const seedNorm = Math.sqrt([...seed.values()].reduce((sum, value) => sum + value * value, 0)) || 1
  const scored: Array<[string, CreatorSimilarity]> = []
  for (const [creator, counts] of vectors) {
    if (watched.has(creator) || !counts.size) continue
    const candidate = weighted(counts)
    const norm = Math.sqrt([...candidate.values()].reduce((sum, value) => sum + value * value, 0)) || 1
    let dot = 0
    for (const [tag, value] of candidate) dot += value * (seed.get(tag) || 0)
    const similarity = dot / (seedNorm * norm)
    if (similarity < 0.08) continue
    const overlaps = [...candidate.keys()]
      .filter((tag) => seed.has(tag))
      .sort((a, b) => (seed.get(b) || 0) * (candidate.get(b) || 0) - (seed.get(a) || 0) * (candidate.get(a) || 0))
      .slice(0, 3)
    scored.push([creator, {
      score: Math.min(99, Math.max(1, Math.round(similarity * 100))),
      reasons: overlaps.length ? overlaps.map((tag) => `shares #${tag} with your radar`) : ['similar public content signals'],
    }])
  }
  return new Map(scored.sort((a, b) => b[1].score - a[1].score).slice(0, 12))
}

function buildCreators(items: LiveMediaItem[], similarities: Map<string, CreatorSimilarity>) {
  const grouped = new Map<string, LiveMediaItem[]>()
  for (const item of items) {
    const key = canonicalCreator(item.creator)
    if (!key) continue
    const creatorItems = grouped.get(key) || []
    creatorItems.push(item)
    grouped.set(key, creatorItems)
  }

  return [...grouped.entries()]
    .map(([key, creatorItems]) => {
      const ranked = sortItems(creatorItems, 'smart')
      const first = ranked[0]
      const views = creatorItems.reduce((sum, item) => sum + item.views, 0)
      const likes = creatorItems.reduce((sum, item) => sum + item.likes, 0)
      const similarity = similarities.get(key)
      const platforms = [...new Set(creatorItems.map((item) => item.source))]
      const discoveryTags = [...new Set(creatorItems.flatMap((item) => item.tags))].slice(0, 20)
      return {
        id: `creator-${key}`,
        name: first.creator,
        username: first.creator,
        avatar: first.thumbnail,
        followers: null,
        hasStory: false,
        storySeen: true,
        platform: platforms.join(' + '),
        platforms,
        profileUrl: first.profileUrl || (first.source === 'Redgifs' ? `https://www.redgifs.com/users/${encodeURIComponent(first.creator)}` : first.pageUrl),
        profileLinks: [...new Set(creatorItems.map((item) => item.profileUrl).filter((url): url is string => Boolean(url)))]
          .slice(0, 4)
          .map((url) => ({ label: hostLabel(url) || 'Source profile', url })),
        mediaCount: creatorItems.length,
        evidenceCount: creatorItems.length,
        lastSeenAt: first.createdAt || null,
        viewCount: views,
        likeCount: likes,
        curationScore: Math.max(...creatorItems.map((item) => item.curationScore)),
        sourceAttribution: `Public source metadata: ${platforms.join(', ')}`,
        observedAt: first.createdAt,
        isWatched: creatorItems.some((item) => item.isWatchedCreator),
        isSimilar: Boolean(similarity),
        similarityScore: similarity?.score || 0,
        similarityMethod: similarity ? 'metadata' : 'none',
        discoveryReasons: similarity?.reasons || [],
        matchReasons: similarity?.reasons || [],
        autoAdded: false,
        aiSuggested: false,
        discoveryConfidence: similarity?.score || 0,
        discoveryTags,
        media: ranked.slice(0, 12),
      }
    })
    .sort((a, b) => Number(b.isWatched) - Number(a.isWatched) || (b.similarityScore - a.similarityScore) || (b.curationScore - a.curationScore) || (b.viewCount - a.viewCount))
}

type BuiltCreator = ReturnType<typeof buildCreators>[number]

function mergeCreatorLeads(creators: BuiltCreator[], leads: CreatorLead[]): BuiltCreator[] {
  const merged = new Map(creators.map((creator) => [canonicalCreator(creator.username), creator]))
  for (const lead of leads) {
    const key = canonicalCreator(lead.username)
    if (!key) continue
    const existing = merged.get(key)
    if (existing) {
      const platforms = [...new Set([...(existing.platforms || [existing.platform]), lead.platform].filter(Boolean))]
      const existingLinks = existing.profileLinks || []
      const links = lead.profileUrl && !existingLinks.some((link) => link.url === lead.profileUrl)
        ? [...existingLinks, { label: lead.platform || hostLabel(lead.profileUrl) || 'Source profile', url: lead.profileUrl }].slice(0, 4)
        : existingLinks
      merged.set(key, {
        ...existing,
        platform: platforms.join(' + '),
        platforms,
        profileUrl: existing.profileUrl || lead.profileUrl,
        profileLinks: links,
        avatar: existing.avatar || lead.avatar,
        isWatched: existing.isWatched || lead.exactWatchMatch,
        discoveryConfidence: Math.max(existing.discoveryConfidence || 0, lead.confidence),
        discoveryTags: [...new Set([...(existing.discoveryTags || []), ...lead.tags])].slice(0, 20),
        sourceAttribution: `${existing.sourceAttribution}; ${lead.sourceAttribution}`,
      })
      continue
    }
    merged.set(key, {
      id: `creator-${key}`,
      name: lead.name,
      username: lead.username,
      avatar: lead.avatar,
      followers: null,
      hasStory: false,
      storySeen: true,
      platform: lead.platform,
      platforms: [lead.platform],
      profileUrl: lead.profileUrl,
      profileLinks: lead.profileUrl ? [{ label: lead.platform || hostLabel(lead.profileUrl) || 'Source profile', url: lead.profileUrl }] : [],
      mediaCount: 0,
      evidenceCount: 0,
      lastSeenAt: lead.observedAt || null,
      viewCount: 0,
      likeCount: 0,
      curationScore: lead.confidence,
      sourceAttribution: lead.sourceAttribution,
      observedAt: lead.observedAt,
      isWatched: lead.exactWatchMatch,
      isSimilar: false,
      similarityScore: 0,
      similarityMethod: 'none',
      discoveryReasons: [],
      matchReasons: [],
      autoAdded: false,
      aiSuggested: false,
      discoveryConfidence: lead.confidence,
      discoveryTags: lead.tags,
      media: [],
    })
  }
  return [...merged.values()]
}

function corsHeaders(noStore = false): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
    'Cache-Control': noStore ? 'private, no-store' : 'public, s-maxage=120, stale-while-revalidate=300',
    'Content-Type': 'application/json; charset=utf-8',
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function getRedgifsToken(): Promise<string> {
  if (redgifsTokenCache && redgifsTokenCache.expiresAt > Date.now() + 60_000) {
    return redgifsTokenCache.token
  }
  if (redgifsTokenPromise) return redgifsTokenPromise
  redgifsTokenPromise = (async () => {
    const auth = await fetchWithTimeout(`${REDGIFS_API}/auth/temporary`, {
      headers: { Accept: 'application/json', 'User-Agent': 'MediaCodex/1.0' },
      cache: 'no-store',
    })
    if (!auth.ok) throw new Error(`Redgifs auth returned ${auth.status}`)
    const token = String((await auth.json() as { token?: string }).token || '')
    if (!token) throw new Error('Redgifs did not return a temporary token')
    redgifsTokenCache = { token, expiresAt: Date.now() + TOKEN_TTL_MS }
    return token
  })().finally(() => {
    redgifsTokenPromise = null
  })
  return redgifsTokenPromise
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: corsHeaders(),
    })
  }

  try {
    const requestUrl = new URL(req.url)
    const body = req.method === 'POST'
      ? await req.json().catch(() => ({})) as Record<string, unknown>
      : {}
    const value = (bodyKey: string, queryKey = bodyKey): string | null => {
      const fromBody = body[bodyKey]
      return fromBody === undefined || fromBody === null ? requestUrl.searchParams.get(queryKey) : String(fromBody)
    }
    const count = Math.min(100, Math.max(1, parseBoundedInt(value('count'), 80, 100)))
    const pages = Math.max(1, parseBoundedInt(value('pages'), 2, 3))
    const startPage = Math.max(1, parseBoundedInt(value('page'), 1, 50))
    const query = boundedQuery(String(body.query || value('q') || value('creator') || ''))
    const suppliedWatchlist = Array.isArray(body.watchlist)
      ? parseWatchlistCandidates(body.watchlist.filter((item): item is string => typeof item === 'string'))
      : parseWatchlist(requestUrl)
    const scheduled = requestUrl.searchParams.get('scheduled') === '1'
    // Scheduled (cron) scans warm provider tokens, the edge cache, and the AI
    // result cache. They never substitute a server-side watchlist — radar
    // membership belongs to each user's own client state.
    const watchlist = suppliedWatchlist
    const minViews = parseBoundedInt(value('minViews'), 0, 10_000_000)
    const minLikes = parseBoundedInt(value('minLikes'), 0, 1_000_000)
    const requestedSort = (value('sort') || 'smart').toLowerCase()
    const sort = ['smart', 'views', 'likes', 'newest'].includes(requestedSort) ? requestedSort : 'smart'
    const noStore = req.method === 'POST' || body.forceFresh === true || requestUrl.searchParams.get('refresh') === '1'
    const expandWatchlist = body.expandWatchlist !== false
    const useAI = body.useAI === true || (scheduled && requestUrl.searchParams.get('ai') === '1')
    if ((useAI || body.forceFresh === true) && !consumeScanBudget(clientIp(req))) {
      return new Response(JSON.stringify({
        error: 'rate_limited',
        detail: 'AI and forced scans are limited to 6 per 5 minutes per client. Cached results remain available without these flags.',
      }), { status: 429, headers: { ...corsHeaders(true), 'Retry-After': '60' } })
    }
    const additionalSourcesPromise = collectAdditionalSources(watchlist, { query })

    let received: RedgifsItem[] = []
    let eligible: RedgifsItem[] = []
    let mapped: LiveMediaItem[] = []
    let basePagesScanned = 0
    let redgifsRequestsSucceeded = 0
    let redgifsRequestsAttempted = 0
    let redgifsError = ''
    try {
      const token = await getRedgifsToken()

      const providerHeaders = {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'MediaCodex/1.0',
      }
      const fetchProvider = async (path: string, params: URLSearchParams): Promise<RedgifsItem[]> => {
        const result = await fetchWithTimeout(`${REDGIFS_API}${path}?${params}`, {
          headers: providerHeaders,
          cache: 'no-store',
        })
        if (!result.ok) throw new Error(`Public provider returned ${result.status}`)
        const body = await result.json() as { gifs?: RedgifsItem[] }
        return body.gifs || []
      }

      const providerCount = Math.min(80, Math.max(30, Math.ceil(count / pages * 1.7)))
      const discoveryRequests: Array<Promise<RedgifsItem[]>> = Array.from({ length: pages }, (_, index) => {
      const params = new URLSearchParams({
        type: 'g',
        tags: 'Gay',
        count: String(providerCount),
        page: String(startPage + index),
        order: 'trending',
      })
      return fetchProvider('/gifs/search', params)
      })

      if (query) {
        discoveryRequests.push(fetchProvider('/gifs/search', new URLSearchParams({
        type: 'g',
        tags: query,
        count: String(Math.min(60, providerCount)),
        page: '1',
        order: 'trending',
        })))
        const possibleHandle = canonicalCreator(query)
        if (possibleHandle.length >= 2) {
          discoveryRequests.push(fetchProvider(`/users/${encodeURIComponent(possibleHandle)}/search`, new URLSearchParams({
          count: '40',
          page: '1',
          order: 'recent',
          })).then((items) => items.filter((item) => canonicalCreator(item.userName || '') === possibleHandle)))
        }
      }

      for (const creator of expandWatchlist ? watchlist : []) {
        const handle = canonicalCreator(creator)
        discoveryRequests.push(fetchProvider(`/users/${encodeURIComponent(handle)}/search`, new URLSearchParams({
        count: '30',
        page: '1',
        order: 'recent',
        })).then((items) => items.filter((item) => canonicalCreator(item.userName || '') === handle)))
      }

      const pageResults = await Promise.allSettled(discoveryRequests)
      const successfulPages = pageResults.filter((result): result is PromiseFulfilledResult<RedgifsItem[]> => result.status === 'fulfilled')
      basePagesScanned = pageResults.slice(0, pages).filter((result) => result.status === 'fulfilled').length
      redgifsRequestsAttempted = discoveryRequests.length
      redgifsRequestsSucceeded = successfulPages.length
      if (!successfulPages.length) throw new Error('Public provider search is temporarily unavailable')
      const deduplicated = new Map<string, RedgifsItem>()
      for (const item of successfulPages.flatMap((result) => result.value)) {
        const sanitized = sanitizeProviderItem(item)
        if (sanitized.id) deduplicated.set(sanitized.id, sanitized)
      }
      received = [...deduplicated.values()]
      eligible = received.filter(isEligibleScopedItem)
      mapped = eligible
      .filter((item) => item.id && safeProviderMediaUrl(item.urls?.poster || item.urls?.thumbnail) && (safeProviderMediaUrl(item.urls?.hd) || safeProviderMediaUrl(item.urls?.sd)))
      .map((item): LiveMediaItem => {
        const tags = (item.tags || []).filter(Boolean).slice(0, 12)
        const creator = item.userName || 'Redgifs creator'
        const isWatchedCreator = creatorIsWatched(creator, watchlist)
        const createdAt = toIsoDate(item.createDate)
        const directCandidates = [safeProviderMediaUrl(item.urls?.hd), safeProviderMediaUrl(item.urls?.sd)].filter((url): url is string => Boolean(url))
        const streamCandidates = [...directCandidates.map(proxiedMediaUrl), ...directCandidates]
          .filter((url): url is string => Boolean(url))
          .filter((url, index, list) => list.indexOf(url) === index)
        return {
          id: `rg-${item.id}`,
          title: item.description?.trim() || tags.slice(0, 3).join(' · ') || `Video by ${creator}`,
          thumbnail: proxiedMediaUrl(safeProviderMediaUrl(item.urls?.poster || item.urls?.thumbnail)),
          source: 'Redgifs',
          duration: durationLabel(item.duration),
          isVideo: true,
          category: tags[0] || 'gay male',
          creator,
          tags,
          rating: 0,
          createdAt,
          views: Math.max(0, item.views || 0),
          mediaUrl: proxiedMediaUrl(directCandidates[0]),
          streamCandidates,
          pageUrl: `https://www.redgifs.com/watch/${item.id}`,
          profileUrl: `https://www.redgifs.com/users/${encodeURIComponent(creator)}`,
          description: item.description || undefined,
          likes: Math.max(0, item.likes || 0),
          comments: 0,
          isLiked: false,
          isNew: Boolean(createdAt) && Date.now() - Date.parse(createdAt) < 86_400_000,
          isTrending: false,
          curationScore: 0,
          curationReasons: [],
          isWatchedCreator,
        }
      })
      .filter((item) => matchesQuery({
        userName: item.creator,
        description: item.description,
        tags: item.tags,
      }, query))
        .filter((item) => item.views >= minViews && item.likes >= minLikes)
    } catch (error) {
      redgifsError = error instanceof Error ? error.message : 'request failed'
    }

    const additional = await additionalSourcesPromise
    const additionalFiltered = additional.media
      .filter((item) => !query || [item.creator, item.title, item.description || '', ...item.tags].join(' ').toLowerCase().includes(query.toLowerCase()))
      .filter((item) => item.views >= minViews && item.likes >= minLikes)
    const combined = [...mapped, ...additionalFiltered]
      .filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index)
    if (!combined.length) throw new Error('No connected public source returned playable media')
    const ranked = sortItems(rankCohort(combined).map((item) => ({ ...item, isTrending: item.curationScore >= 65 })), sort)
    const items = diversifySources(ranked, count)
    const similarities = creatorSimilarities(ranked)
    const creatorPool = mergeCreatorLeads(buildCreators(ranked.slice(0, 240), similarities), additional.leads)
    const aiResult = await rankSimilarCreatorsWithAI(creatorPool.map((creator) => ({
      id: creator.id,
      name: creator.name,
      platform: creator.platform,
      tags: creator.discoveryTags || [...new Set((creator.media || []).flatMap((item) => item.tags))].slice(0, 20),
      watched: creator.isWatched,
      mediaCount: creator.mediaCount,
      publicViews: creator.viewCount,
      deterministicScore: creator.similarityScore || creator.discoveryConfidence || 0,
    })), useAI)
    const performers = creatorPool
      .map((creator) => {
        const ai = aiResult.suggestions.get(creator.id)
        return ai ? {
          ...creator,
          isSimilar: true,
          similarityScore: ai.score,
          similarityMethod: 'ai',
          discoveryReasons: ai.reasons,
          matchReasons: [...new Set([...(creator.matchReasons || creator.discoveryReasons || []), ...ai.reasons])].slice(0, 5),
          aiSuggested: aiResult.state === 'model',
          aiReason: ai.reasons[0],
          autoAdded: ai.score >= 70,
          discoveryConfidence: Math.max(creator.discoveryConfidence || 0, ai.score),
        } : creator
      })
      .filter((creator) => creator.mediaCount > 0 || creator.isWatched || creator.isSimilar || creator.discoveryConfidence >= 75)
      .sort((a, b) => Number(b.isWatched) - Number(a.isWatched) || Number(b.autoAdded) - Number(a.autoAdded) || b.similarityScore - a.similarityScore || b.curationScore - a.curationScore)
    const redgifsStatus = {
      id: 'redgifs' as const,
      name: 'Redgifs',
      mode: 'stream' as const,
      state: redgifsError ? 'error' as const : 'connected' as const,
      mediaFound: mapped.length,
      creatorsFound: new Set(mapped.map((item) => canonicalCreator(item.creator))).size,
      detail: redgifsError ? `Public provider unavailable: ${redgifsError}` : 'Public provider API with source links and same-origin streaming fallbacks.',
    }
    return new Response(JSON.stringify({
      items,
      performers,
      source: 'multi-source-public-discovery',
      sources: [redgifsStatus, ...additional.statuses],
      updatedAt: new Date().toISOString(),
      counts: {
        received: received.length + additional.media.length + additional.leads.length,
        eligible: eligible.length + additional.media.length,
        playable: items.length,
        pagesScanned: basePagesScanned,
        providerRequestsSucceeded: redgifsRequestsSucceeded + additional.requestsSucceeded,
        providerRequestsAttempted: redgifsRequestsAttempted + additional.requestsAttempted,
        sourcesConnected: Number(!redgifsError) + additional.statuses.filter((source) => source.state === 'connected').length,
        creatorsDiscovered: performers.length,
      },
      watchlist: {
        requested: watchlist,
        matched: [...new Set(items.filter((item) => item.isWatchedCreator).map((item) => item.creator))],
      },
      aiDiscovery: {
        model: aiResult.model,
        state: aiResult.state === 'model' ? 'ok' : aiResult.state,
        detail: aiResult.detail,
        cacheState: aiResult.cacheState,
        explainable: true,
        suggestedCreators: performers.filter((creator) => creator.isSimilar).length,
        autoAddedCreators: performers.filter((creator) => creator.autoAdded).length,
        sensitiveAttributeInference: false,
      },
      ddg: additional.duckduckgo,
      privacy: { emailsRedacted: true },
      ranking: 'AI-assisted public metadata similarity plus cohort-normalized engagement and freshness; no appearance scoring',
    }), { status: 200, headers: corsHeaders(noStore) })
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'live_media_unavailable',
      detail: error instanceof Error ? error.message : String(error),
      items: [],
      performers: [],
    }), { status: 502, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' } })
  }
}
