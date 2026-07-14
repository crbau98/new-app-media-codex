/**
 * Source-attributed public media discovery.
 *
 * This endpoint deliberately uses a public provider API and preserves a link
 * back to the original post. It does not scrape, cache, or rehost subscription
 * creator libraries. Ranking is explainable (public engagement + freshness),
 * never a model's judgement about a person's appearance.
 */
export const config = { runtime: 'edge' }

const REDGIFS_API = 'https://api.redgifs.com/v2'
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const EMAIL_TEST = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const GENERIC_SIMILARITY_TAGS = new Set(['gay', 'male', 'men', 'man', 'video', 'verified'])
const FEMALE_MARKERS = [
  'female', 'woman', 'women', 'girl', 'lesbian', 'straight', 'pussy',
  'vagina', 'shemale', 'ladyboy', 'hetero',
  'girlfriend', 'wife', 'b/g', 'm/f', 'boob', 'breast', 'tits',
  'petite', 'bbw', 'milf', 'femdom',
]

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

type LiveMediaItem = {
  id: string
  title: string
  thumbnail?: string
  source: 'Redgifs'
  duration: string
  isVideo: true
  category: string
  creator: string
  tags: string[]
  rating: number
  createdAt: string
  views: number
  mediaUrl?: string
  streamCandidates: string[]
  pageUrl: string
  description?: string
  likes: number
  comments: number
  isLiked: false
  isNew: boolean
  isTrending: boolean
  curationScore: number
  curationReasons: string[]
  isWatchedCreator: boolean
}

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

function isEligibleMaleItem(item: RedgifsItem): boolean {
  // Discovery is established by the canonical Gay tag or an explicit user
  // watchlist. These exclusions protect the feed when a source is mislabelled.
  const tokens = new Set(textFor(item).split(/[^a-z0-9/]+/).filter(Boolean))
  return !FEMALE_MARKERS.some((marker) => tokens.has(marker))
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

function parseWatchlist(url: URL): string[] {
  const candidates = [
    ...url.searchParams.getAll('watch'),
    ...(url.searchParams.get('watchlist') || '').split(','),
  ]
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
      return {
        id: `redgifs-${key}`,
        name: first.creator,
        username: first.creator,
        avatar: first.thumbnail,
        followers: 0,
        hasStory: false,
        storySeen: true,
        platform: 'Redgifs',
        profileUrl: `https://www.redgifs.com/users/${encodeURIComponent(first.creator)}`,
        mediaCount: creatorItems.length,
        viewCount: views,
        likeCount: likes,
        curationScore: Math.max(...creatorItems.map((item) => item.curationScore)),
        sourceAttribution: 'Public Redgifs source',
        observedAt: first.createdAt,
        isWatched: creatorItems.some((item) => item.isWatchedCreator),
        isSimilar: Boolean(similarity),
        similarityScore: similarity?.score || 0,
        discoveryReasons: similarity?.reasons || [],
        media: ranked.slice(0, 12),
      }
    })
    .sort((a, b) => Number(b.isWatched) - Number(a.isWatched) || (b.similarityScore - a.similarityScore) || (b.curationScore - a.curationScore) || (b.viewCount - a.viewCount))
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
    'Content-Type': 'application/json; charset=utf-8',
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: corsHeaders(),
    })
  }

  try {
    const requestUrl = new URL(req.url)
    const count = Math.min(100, Math.max(20, parseBoundedInt(requestUrl.searchParams.get('count'), 80, 100)))
    const pages = Math.max(1, parseBoundedInt(requestUrl.searchParams.get('pages'), 2, 3))
    const startPage = Math.max(1, parseBoundedInt(requestUrl.searchParams.get('page'), 1, 50))
    const query = boundedQuery(requestUrl.searchParams.get('q') || requestUrl.searchParams.get('creator') || '')
    const watchlist = parseWatchlist(requestUrl)
    const minViews = parseBoundedInt(requestUrl.searchParams.get('minViews'), 0, 10_000_000)
    const minLikes = parseBoundedInt(requestUrl.searchParams.get('minLikes'), 0, 1_000_000)
    const requestedSort = (requestUrl.searchParams.get('sort') || 'smart').toLowerCase()
    const sort = ['smart', 'views', 'likes', 'newest'].includes(requestedSort) ? requestedSort : 'smart'

    const auth = await fetch(`${REDGIFS_API}/auth/temporary`, {
      headers: { Accept: 'application/json', 'User-Agent': 'MediaCodex/1.0' },
      cache: 'no-store',
    })
    if (!auth.ok) throw new Error(`Redgifs auth returned ${auth.status}`)
    const token = String((await auth.json() as { token?: string }).token || '')
    if (!token) throw new Error('Redgifs did not return a temporary token')

    const providerHeaders = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'MediaCodex/1.0',
    }
    const fetchProvider = async (path: string, params: URLSearchParams): Promise<RedgifsItem[]> => {
      const result = await fetch(`${REDGIFS_API}${path}?${params}`, {
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
        search_text: query,
        count: String(Math.min(60, providerCount)),
        page: '1',
        order: 'trending',
      })))
    }

    for (const creator of watchlist) {
      const handle = canonicalCreator(creator)
      discoveryRequests.push(fetchProvider(`/users/${encodeURIComponent(handle)}/search`, new URLSearchParams({
        count: '30',
        page: '1',
        order: 'recent',
      })).then((items) => items.filter((item) => canonicalCreator(item.userName || '') === handle)))
    }

    const pageResults = await Promise.allSettled(discoveryRequests)
    const successfulPages = pageResults.filter((result): result is PromiseFulfilledResult<RedgifsItem[]> => result.status === 'fulfilled')
    if (!successfulPages.length) throw new Error('Public provider search is temporarily unavailable')
    const deduplicated = new Map<string, RedgifsItem>()
    for (const item of successfulPages.flatMap((result) => result.value)) {
      const sanitized = sanitizeProviderItem(item)
      if (sanitized.id) deduplicated.set(sanitized.id, sanitized)
    }
    const received = [...deduplicated.values()]
    const eligible = received.filter(isEligibleMaleItem)
    const mapped = eligible
      .filter((item) => item.id && item.urls?.poster && (item.urls.hd || item.urls.sd))
      .map((item): LiveMediaItem => {
        const tags = (item.tags || []).filter(Boolean).slice(0, 12)
        const creator = item.userName || 'Redgifs creator'
        const isWatchedCreator = creatorIsWatched(creator, watchlist)
        const createdAt = toIsoDate(item.createDate)
        const directCandidates = [item.urls?.hd, item.urls?.sd].filter((url): url is string => Boolean(url))
        const streamCandidates = [...directCandidates.map(proxiedMediaUrl), ...directCandidates]
          .filter((url): url is string => Boolean(url))
          .filter((url, index, list) => list.indexOf(url) === index)
        return {
          id: `rg-${item.id}`,
          title: item.description?.trim() || tags.slice(0, 3).join(' · ') || `Video by ${creator}`,
          thumbnail: proxiedMediaUrl(item.urls?.poster || item.urls?.thumbnail),
          source: 'Redgifs',
          duration: durationLabel(item.duration),
          isVideo: true,
          category: tags[0] || 'gay male',
          creator,
          tags,
          rating: 0,
          createdAt,
          views: Math.max(0, item.views || 0),
          mediaUrl: proxiedMediaUrl(item.urls?.hd || item.urls?.sd),
          streamCandidates,
          pageUrl: `https://www.redgifs.com/watch/${item.id}`,
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

    const ranked = sortItems(rankCohort(mapped).map((item) => ({ ...item, isTrending: item.curationScore >= 65 })), sort)
    const items = ranked.slice(0, count)
    const similarities = creatorSimilarities(ranked)
    const performers = buildCreators(items, similarities)
    return new Response(JSON.stringify({
      items,
      performers,
      source: 'public-redgifs-api',
      updatedAt: new Date().toISOString(),
      counts: { received: received.length, eligible: eligible.length, playable: items.length, pagesScanned: successfulPages.length },
      watchlist: {
        requested: watchlist,
        matched: [...new Set(items.filter((item) => item.isWatchedCreator).map((item) => item.creator))],
      },
      aiDiscovery: {
        model: 'tf-idf-cosine-v1',
        explainable: true,
        suggestedCreators: performers.filter((creator) => creator.isSimilar).length,
        sensitiveAttributeInference: false,
      },
      privacy: { emailsRedacted: true },
      ranking: 'cohort-normalized public engagement and freshness; no appearance scoring',
    }), { status: 200, headers: corsHeaders() })
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'live_media_unavailable',
      detail: error instanceof Error ? error.message : String(error),
      items: [],
      performers: [],
    }), { status: 502, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' } })
  }
}
