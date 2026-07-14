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
const FEMALE_MARKERS = [
  'female', 'woman', 'women', 'girl', 'lesbian', 'straight', 'pussy',
  'vagina', 'shemale', 'ladyboy', 'femboy', 'bisexual', 'hetero',
  'girlfriend', 'wife', 'b/g', 'm/f', 'ftm', 'boob', 'breast', 'tits',
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
  pageUrl: string
  description?: string
  likes: number
  comments: number
  isLiked: false
  isNew: boolean
  isTrending: boolean
  curationScore: number
  curationReasons: string[]
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
  // Inclusion is established by the exact canonical Gay tag search. These
  // exclusions protect the feed when a provider record is mislabelled.
  const text = textFor(item)
  return !FEMALE_MARKERS.some((marker) => text.includes(marker))
}

function durationLabel(seconds = 0): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}

function toIsoDate(value?: number): string {
  if (!value || !Number.isFinite(value)) return new Date().toISOString()
  const milliseconds = value > 1_000_000_000_000 ? value : value * 1000
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function proxiedMediaUrl(url?: string): string | undefined {
  return url ? `/api/archiver-proxy?url=${encodeURIComponent(url)}` : undefined
}

function curation(item: RedgifsItem, createdAt: string): { score: number; reasons: string[] } {
  const views = Math.max(0, item.views || 0)
  const likes = Math.max(0, item.likes || 0)
  const hoursOld = Math.max(0, (Date.now() - Date.parse(createdAt)) / 3_600_000)
  const freshness = Math.max(0, 16 - Math.log2(hoursOld + 1) * 2.25)
  const engagement = Math.log1p(views) * 5.5 + Math.log1p(likes) * 9
  const score = Math.max(0, Math.min(100, Math.round(engagement + freshness)))
  const reasons: string[] = []
  if (views >= 10_000) reasons.push('high public view count')
  if (likes >= 500) reasons.push('strong public engagement')
  if (hoursOld <= 72) reasons.push('recently published')
  if (!reasons.length) reasons.push('matches the current public creator feed')
  return { score, reasons }
}

function parseBoundedInt(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(0, Math.floor(parsed)))
}

function canonicalCreator(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
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
  if (sort === 'newest') return sorted.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return sorted.sort((a, b) => b.curationScore - a.curationScore || b.views - a.views)
}

function buildCreators(items: LiveMediaItem[]) {
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
        media: ranked.slice(0, 12),
      }
    })
    .sort((a, b) => (b.curationScore - a.curationScore) || (b.viewCount - a.viewCount))
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
    const count = Math.min(80, Math.max(20, parseBoundedInt(requestUrl.searchParams.get('count'), 60, 80)))
    const query = (requestUrl.searchParams.get('q') || requestUrl.searchParams.get('creator') || '').trim()
    const minViews = parseBoundedInt(requestUrl.searchParams.get('minViews'), 0, 10_000_000)
    const minLikes = parseBoundedInt(requestUrl.searchParams.get('minLikes'), 0, 1_000_000)
    const sort = (requestUrl.searchParams.get('sort') || 'smart').toLowerCase()

    const auth = await fetch(`${REDGIFS_API}/auth/temporary`, {
      headers: { Accept: 'application/json', 'User-Agent': 'MediaCodex/1.0' },
      cache: 'no-store',
    })
    if (!auth.ok) throw new Error(`Redgifs auth returned ${auth.status}`)
    const token = String((await auth.json() as { token?: string }).token || '')
    if (!token) throw new Error('Redgifs did not return a temporary token')

    const params = new URLSearchParams({
      // `tags`, not `search_text`, is the provider's canonical tag filter.
      type: 'g',
      tags: 'Gay',
      count: String(count),
      page: '1',
      order: 'trending',
    })
    const result = await fetch(`${REDGIFS_API}/gifs/search?${params}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'MediaCodex/1.0',
      },
      cache: 'no-store',
    })
    if (!result.ok) throw new Error(`Redgifs search returned ${result.status}`)

    const body = await result.json() as { gifs?: RedgifsItem[] }
    const received = body.gifs || []
    const eligible = received.filter(isEligibleMaleItem)
    const mapped = eligible
      .filter((item) => item.id && item.urls?.poster && (item.urls.hd || item.urls.sd))
      .map((item): LiveMediaItem => {
        const tags = (item.tags || []).filter(Boolean).slice(0, 12)
        const creator = item.userName || 'Redgifs creator'
        const createdAt = toIsoDate(item.createDate)
        const ranked = curation(item, createdAt)
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
          pageUrl: `https://www.redgifs.com/watch/${item.id}`,
          description: item.description || undefined,
          likes: Math.max(0, item.likes || 0),
          comments: 0,
          isLiked: false,
          isNew: Date.now() - Date.parse(createdAt) < 86_400_000,
          isTrending: ranked.score >= 65,
          curationScore: ranked.score,
          curationReasons: ranked.reasons,
        }
      })
      .filter((item) => matchesQuery({
        userName: item.creator,
        description: item.description,
        tags: item.tags,
      }, query))
      .filter((item) => item.views >= minViews && item.likes >= minLikes)

    const items = sortItems(mapped, sort)
    return new Response(JSON.stringify({
      items,
      performers: buildCreators(items),
      source: 'public-redgifs-api',
      updatedAt: new Date().toISOString(),
      counts: { received: received.length, eligible: eligible.length, playable: items.length },
      ranking: 'public engagement and freshness; no appearance scoring',
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
