export const config = { runtime: 'edge' }

const REDGIFS_API = 'https://api.redgifs.com/v2'
const FEMALE_MARKERS = [
  'female', 'woman', 'women', 'girl', 'lesbian', 'straight', 'pussy',
  'vagina', 'shemale', 'ladyboy', 'femboy', 'bisexual', 'hetero',
  'girlfriend', 'wife', 'b/g', 'm/f', 'ftm', 'boob', 'breast', 'tits',
  'petite', 'bbw', 'milf', 'femdom', 'pornstar',
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
  width?: number
  urls?: {
    hd?: string
    sd?: string
    poster?: string
    thumbnail?: string
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
  const text = textFor(item)
  // Inclusion is established by the exact canonical `Gay` tag search below.
  // Redgifs does not repeat the searched tag in every result's metadata, so a
  // second positive keyword requirement would reject valid records. Metadata
  // remains useful as a strict exclusion guard for mislabeled/mixed results.
  return !FEMALE_MARKERS.some((marker) => text.includes(marker))
}

function durationLabel(seconds = 0): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
    'Content-Type': 'application/json; charset=utf-8',
  }
}

function proxiedMediaUrl(url?: string): string | undefined {
  return url ? `/api/archiver-proxy?url=${encodeURIComponent(url)}` : undefined
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
    const auth = await fetch(`${REDGIFS_API}/auth/temporary`, {
      headers: { Accept: 'application/json', 'User-Agent': 'MediaCodex/1.0' },
      cache: 'no-store',
    })
    if (!auth.ok) throw new Error(`Redgifs auth returned ${auth.status}`)
    const token = String((await auth.json() as { token?: string }).token || '')
    if (!token) throw new Error('Redgifs did not return a temporary token')

    const requestUrl = new URL(req.url)
    const count = Math.min(60, Math.max(12, Number(requestUrl.searchParams.get('count')) || 36))
    const params = new URLSearchParams({
      // Redgifs v2 filters GIF search with `tags` (not `search_text`). Sending
      // the latter silently returns general trending media.
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
    const now = new Date().toISOString()
    const received = body.gifs || []
    const eligible = received.filter(isEligibleMaleItem)
    const items = eligible
      .filter((item) => item.id && item.urls?.poster && (item.urls.hd || item.urls.sd))
      .map((item) => {
        const tags = (item.tags || []).filter(Boolean).slice(0, 12)
        const creator = item.userName || 'Redgifs creator'
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
          createdAt: item.createDate ? new Date(item.createDate * 1000).toISOString() : now,
          views: item.views || 0,
          mediaUrl: proxiedMediaUrl(item.urls?.hd || item.urls?.sd),
          pageUrl: `https://www.redgifs.com/watch/${item.id}`,
          description: item.description || undefined,
          likes: item.likes || 0,
          comments: 0,
          isLiked: false,
          isNew: false,
          isTrending: true,
        }
      })

    return new Response(JSON.stringify({
      items,
      source: 'redgifs-live',
      updatedAt: now,
      counts: { received: received.length, eligible: eligible.length, playable: items.length },
    }), {
      status: 200,
      headers: corsHeaders(),
    })
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'live_media_unavailable',
      detail: error instanceof Error ? error.message : String(error),
      items: [],
    }), { status: 502, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' } })
  }
}
