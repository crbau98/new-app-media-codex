import { collectDuckDuckGo } from './duckduckgo.js'
import type { CreatorLead, MultiSourceResult, SourceStatus, UnifiedMediaItem } from './discovery-types.js'

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PROVIDER_TIMEOUT_MS = 9_000
// Exclusion-only blocklist: strictly female/straight markers. Trans-related
// terms were removed — trans men are in scope, and identity terms must never
// be used as exclusion signals.
const FEMALE_MARKERS = new Set([
  'female', 'woman', 'women', 'girl', 'girls', 'lesbian', 'straight', 'pussy', 'vagina',
  'wife', 'girlfriend', 'milf', 'femdom',
])
const SCOPE_MARKERS = new Set(['gay', 'male', 'man', 'men', 'mlm', 'boy', 'boys', 'guy', 'guys', 'hunk', 'jock', 'twink', 'daddy', 'bear', 'muscle'])

// Blocked hosts: subscription mirrors, leaked-content aggregators.
// This list is exclusion-only and host-based — no identity inferences are made.
const BLOCKED_HOSTS = new Set([
  'coomer.su', 'coomer.party', 'kemono.su', 'kemono.party',
  'leakedmodels.com', 'modelfansclub.com', 'nudostar.com',
  'thothub.to', 'thothub.vip', 'fapello.com',
])

function sanitize(value = ''): string {
  return value.replace(EMAIL_PATTERN, '').replace(/\s+/g, ' ').trim()
}

function canonical(value = ''): string {
  return value.trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]+/g, '')
}

function isoFromUnix(value: number | undefined): string {
  return value ? new Date(value * 1000).toISOString() : new Date().toISOString()
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'MediaCodex/1.0', ...(init.headers || {}) },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function safeUrl(value: string | undefined, allowed: RegExp): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !allowed.test(url.hostname)) return undefined
    return url.href
  } catch {
    return undefined
  }
}

/** Validate a third-party https URL without host restriction. Rejects credentials, non-https, and blocked hosts. */
function safeHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (BLOCKED_HOSTS.has(host)) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function isBlockedHost(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '')
    return BLOCKED_HOSTS.has(host)
  } catch {
    return false
  }
}

function watched(creator: string, watchlist: string[]): boolean {
  const target = canonical(creator)
  return Boolean(target) && watchlist.some((item) => canonical(item) === target)
}

type XUser = { id?: string; username?: string; name?: string; profile_image_url?: string }
type XTweet = {
  id?: string
  text?: string
  created_at?: string
  public_metrics?: { like_count?: number; retweet_count?: number; reply_count?: number; impression_count?: number }
  attachments?: { media_keys?: string[] }
  author_id?: string
}

// Bounded open-search queries used when token exists but watchlist is limited.
// These run at most once per invocation to stay within rate budgets.
const X_BROAD_QUERIES = [
  '(gay OR twink OR bear OR daddy OR hunk OR jock) male creator has:media -is:retweet lang:en',
]

async function collectX(watchlist: string[]): Promise<{ media: UnifiedMediaItem[]; leads: CreatorLead[]; status: SourceStatus; attempted: number; succeeded: number }> {
  const token = (process.env.X_BEARER_TOKEN || '').trim()
  const base: SourceStatus = {
    id: 'x', name: 'X', mode: 'stream', state: 'not-configured', mediaFound: 0, creatorsFound: 0,
    detail: 'Set X_BEARER_TOKEN to enable official X API discovery for public posts.',
    searchUrl: 'https://x.com/search?q=gay%20creator&src=typed_query&f=live',
  }
  if (!token) return { media: [], leads: [], status: base, attempted: 0, succeeded: 0 }

  const headers = { Authorization: 'Bearer ' + token }
  const media: UnifiedMediaItem[] = []
  const leads = new Map<string, CreatorLead>()
  let attempted = 0
  let succeeded = 0

  const processResponse = (
    body: { data?: XTweet[]; includes?: { users?: XUser[]; media?: Array<{ media_key?: string; type?: string; url?: string; preview_image_url?: string; variants?: Array<{ url?: string; content_type?: string }> }> } },
    context: 'watchlist' | 'broad',
  ) => {
    const users = new Map((body.includes?.users || []).map((user) => [user.id, user]))
    const assets = new Map((body.includes?.media || []).map((asset) => [asset.media_key, asset]))
    for (const tweet of body.data || []) {
      const text = sanitize(tweet.text || '')
      const tokens = new Set(text.toLowerCase().split(/[^a-z0-9/]+/).filter(Boolean))
      const author = users.get(tweet.author_id)
      const username = sanitize(author?.username || '')
      if (!username) continue
      const exact = watched(username, watchlist)
      const scoped = context === 'broad'
        ? [...SCOPE_MARKERS].some((marker) => tokens.has(marker))
        : exact || [...SCOPE_MARKERS].some((marker) => tokens.has(marker))
      if (!scoped || [...FEMALE_MARKERS].some((marker) => tokens.has(marker))) continue
      const displayName = sanitize(author?.name || username)
      const creatorKey = canonical(username)
      if (creatorKey) {
        leads.set(`x-${creatorKey}`, {
          id: `x-${creatorKey}`,
          name: displayName,
          username,
          platform: 'X',
          profileUrl: `https://x.com/${encodeURIComponent(username)}`,
          avatar: safeUrl(author?.profile_image_url, /(^|\.)twimg\.com$/i),
          tags: ['official api', 'public post'],
          observedAt: tweet.created_at || new Date().toISOString(),
          sourceAttribution: 'Official X API public post metadata; media remains on X',
          confidence: exact ? 88 : context === 'broad' ? 52 : 64,
          exactWatchMatch: exact,
        })
      }
      for (const key of tweet.attachments?.media_keys || []) {
        const asset = assets.get(key)
        if (!asset) continue
        const video = asset.type === 'video' || asset.type === 'animated_gif'
        const stream = video
          ? asset.variants?.filter((variant) => variant.content_type === 'video/mp4' && variant.url).map((variant) => variant.url as string)
          : []
        const pageUrl = `https://x.com/${encodeURIComponent(username)}/status/${tweet.id}`
        const thumbnail = safeUrl(asset.preview_image_url || asset.url, /(^|\.)twimg\.com$/i)
        const mediaUrl = safeUrl(stream?.[0] || asset.url, /(^|\.)twimg\.com$/i)
        if (!thumbnail && !mediaUrl) continue
        media.push({
          id: `x-${tweet.id}-${key}`,
          title: text.slice(0, 96) || `Public X post by @${username}`,
          thumbnail,
          source: 'X',
          duration: '',
          isVideo: video,
          category: 'X public posts',
          creator: username,
          tags: ['x', 'public post'],
          rating: 0,
          createdAt: tweet.created_at || new Date().toISOString(),
          views: tweet.public_metrics?.impression_count || 0,
          mediaUrl,
          streamCandidates: (stream || []).map((url) => safeUrl(url, /(^|\.)twimg\.com$/i)).filter((url): url is string => Boolean(url)),
          pageUrl,
          profileUrl: `https://x.com/${encodeURIComponent(username)}`,
          description: text,
          likes: tweet.public_metrics?.like_count || 0,
          comments: tweet.public_metrics?.reply_count || 0,
          isLiked: false,
          isNew: true,
          isTrending: false,
          curationScore: 0,
          curationReasons: exact ? [`Watched radar creator @${username}`] : [],
          isWatchedCreator: exact,
        })
      }
    }
  }

  // Watchlist-specific queries (up to 4 creators)
  for (const creator of watchlist.slice(0, 4)) {
    const query = sanitize(creator).slice(0, 60)
    if (!query) continue
    attempted += 1
    try {
      const body = await fetchJson(
        `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(`from:${query} has:media -is:retweet`)}&max_results=10&expansions=author_id,attachments.media_keys&user.fields=username,name,profile_image_url&media.fields=url,preview_image_url,type,variants`,
        { headers },
      ) as { data?: XTweet[]; includes?: { users?: XUser[]; media?: Array<{ media_key?: string; type?: string; url?: string; preview_image_url?: string; variants?: Array<{ url?: string; content_type?: string }> }> } }
      succeeded += 1
      processResponse(body, 'watchlist')
    } catch {
      // X failures never block other sources.
    }
  }

  // Bounded open searches: discover public gay male creator media beyond the watchlist.
  // Limited to one broad query per invocation to respect rate limits.
  for (const broadQuery of X_BROAD_QUERIES.slice(0, 1)) {
    attempted += 1
    try {
      const body = await fetchJson(
        `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(broadQuery)}&max_results=10&expansions=author_id,attachments.media_keys&user.fields=username,name,profile_image_url&media.fields=url,preview_image_url,type,variants`,
        { headers },
      ) as { data?: XTweet[]; includes?: { users?: XUser[]; media?: Array<{ media_key?: string; type?: string; url?: string; preview_image_url?: string; variants?: Array<{ url?: string; content_type?: string }> }> } }
      succeeded += 1
      processResponse(body, 'broad')
    } catch {
      // Broad query failures never block watchlist results or other sources.
    }
  }

  const state = succeeded ? 'connected' : attempted ? 'error' : 'not-configured'
  return {
    media,
    leads: [...leads.values()],
    status: { ...base, state, mediaFound: media.length, creatorsFound: leads.size, detail: succeeded ? 'Official X API public-post discovery (watchlist + bounded open search).' : 'X credentials exist, but the recent-search request failed.' },
    attempted,
    succeeded,
  }
}

type TumblrPost = {
  id_string?: string
  post_url?: string
  blog_name?: string
  summary?: string
  caption?: string
  tags?: string[]
  timestamp?: number
  note_count?: number
  photos?: Array<{ original_size?: { url?: string }; alt_sizes?: Array<{ url?: string }> }>
}

async function collectTumblr(watchlist: string[]): Promise<{ media: UnifiedMediaItem[]; leads: CreatorLead[]; status: SourceStatus; attempted: number; succeeded: number }> {
  const key = (process.env.TUMBLR_API_KEY || '').trim()
  const base: SourceStatus = {
    id: 'tumblr', name: 'Tumblr', mode: 'stream', state: 'not-configured', mediaFound: 0, creatorsFound: 0,
    detail: 'Set TUMBLR_API_KEY to enable official Tumblr API discovery for public posts.',
    searchUrl: 'https://www.tumblr.com/search/gay%20creator',
  }
  if (!key) return { media: [], leads: [], status: base, attempted: 0, succeeded: 0 }

  const media: UnifiedMediaItem[] = []
  const leads = new Map<string, CreatorLead>()
  let attempted = 0
  let succeeded = 0
  for (const creator of watchlist.slice(0, 4)) {
    const query = sanitize(creator).slice(0, 60)
    if (!query) continue
    attempted += 1
    try {
      const body = await fetchJson(`https://api.tumblr.com/v2/tagged?tag=${encodeURIComponent(query)}&limit=12&api_key=${encodeURIComponent(key)}`) as { response?: TumblrPost[] }
      succeeded += 1
      for (const post of body.response || []) {
        const text = sanitize(`${post.summary || ''} ${(post.tags || []).join(' ')} ${post.caption || ''}`)
        const tokens = new Set(text.toLowerCase().split(/[^a-z0-9/]+/).filter(Boolean))
        const exact = watched(query, watchlist) || watched(post.blog_name || '', watchlist)
        const scoped = exact || [...SCOPE_MARKERS].some((marker) => tokens.has(marker))
        if (!scoped || [...FEMALE_MARKERS].some((marker) => tokens.has(marker))) continue
        const username = sanitize(post.blog_name || query)
        const creatorKey = canonical(username)
        if (creatorKey) {
          leads.set(`tumblr-${creatorKey}`, {
            id: `tumblr-${creatorKey}`,
            name: username,
            username,
            platform: 'Tumblr',
            profileUrl: `https://${encodeURIComponent(username)}.tumblr.com/`,
            tags: ['official api', 'public post'],
            observedAt: isoFromUnix(post.timestamp),
            sourceAttribution: 'Official Tumblr API public post metadata; media remains on Tumblr',
            confidence: exact ? 86 : 62,
            exactWatchMatch: exact,
          })
        }
        for (const photo of post.photos || []) {
          const thumbnail = safeUrl(photo.alt_sizes?.[1]?.url || photo.alt_sizes?.[0]?.url || photo.original_size?.url, /(^|\.)media\.tumblr\.com$/i)
          const mediaUrl = safeUrl(photo.original_size?.url, /(^|\.)media\.tumblr\.com$/i)
          if (!thumbnail && !mediaUrl) continue
          media.push({
            id: `tumblr-${post.id_string}-${mediaUrl || thumbnail}`,
            title: sanitize(post.summary || '').slice(0, 96) || `Public Tumblr post by ${username}`,
            thumbnail,
            source: 'Tumblr',
            duration: '',
            isVideo: false,
            category: 'Tumblr public posts',
            creator: username,
            tags: (post.tags || []).slice(0, 8),
            rating: 0,
            createdAt: isoFromUnix(post.timestamp),
            views: 0,
            mediaUrl,
            streamCandidates: [],
            pageUrl: post.post_url || `https://www.tumblr.com/${encodeURIComponent(username)}`,
            profileUrl: `https://${encodeURIComponent(username)}.tumblr.com/`,
            description: sanitize(post.summary || ''),
            likes: post.note_count || 0,
            comments: 0,
            isLiked: false,
            isNew: true,
            isTrending: false,
            curationScore: 0,
            curationReasons: exact ? [`Watched radar creator ${username}`] : [],
            isWatchedCreator: exact,
          })
        }
      }
    } catch {
      // Tumblr failures never block other sources.
    }
  }
  const state = succeeded ? 'connected' : attempted ? 'error' : 'not-configured'
  return {
    media,
    leads: [...leads.values()],
    status: { ...base, state, mediaFound: media.length, creatorsFound: leads.size, detail: succeeded ? 'Official Tumblr API public-post discovery.' : 'Tumblr credentials exist, but the tagged-post request failed.' },
    attempted,
    succeeded,
  }
}

export function creatorFromUrl(value: string | undefined): { username: string; platform: string; profileUrl: string } | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const parts = url.pathname.split('/').filter(Boolean)
    if (host === 'x.com' || host === 'twitter.com') return parts[0] ? { username: parts[0], platform: 'X', profileUrl: `https://x.com/${parts[0]}` } : null
    if (host.endsWith('.tumblr.com')) return { username: host.replace('.tumblr.com', ''), platform: 'Tumblr', profileUrl: `https://${host}/` }
    if (host === 'www.redgifs.com' && parts[0] === 'users' && parts[1]) return { username: parts[1], platform: 'Redgifs', profileUrl: `https://www.redgifs.com/users/${parts[1]}` }
    if (host === 'redgifs.com' && parts[0]) return { username: parts[0], platform: 'Redgifs', profileUrl: `https://www.redgifs.com/users/${parts[0]}` }
    return null
  } catch {
    return null
  }
}

async function collectGoogle(watchlist: string[]): Promise<{ leads: CreatorLead[]; status: SourceStatus; attempted: number; succeeded: number }> {
  const apiKey = (process.env.GOOGLE_CSE_API_KEY || '').trim()
  const cx = (process.env.GOOGLE_CSE_ID || '').trim()
  const base: SourceStatus = {
    id: 'google', name: 'Google profile leads', mode: 'discovery', state: 'not-configured', mediaFound: 0, creatorsFound: 0,
    detail: 'Set GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID for licensed-image profile discovery.',
    searchUrl: 'https://www.google.com/search?q=gay+male+creator+public+profile',
  }
  if (!apiKey || !cx) return { leads: [], status: base, attempted: 0, succeeded: 0 }

  const leads = new Map<string, CreatorLead>()
  let attempted = 0
  let succeeded = 0
  for (const creator of watchlist.slice(0, 4)) {
    const display = sanitize(creator).slice(0, 50)
    if (display.length < 2) continue
    attempted += 1
    try {
      const query = `${display} gay male creator public profile`
      const body = await fetchJson(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&searchType=image&safe=off&num=6&q=${encodeURIComponent(query)}`) as { items?: Array<{ title?: string; link?: string; image?: { contextLink?: string } }> }
      succeeded += 1
      for (const item of body.items || []) {
        const source = creatorFromUrl(item.image?.contextLink || item.link)
        if (!source) continue
        const username = sanitize(source.username)
        const creatorKey = canonical(username)
        if (!creatorKey) continue
        const exact = watched(username, watchlist)
        leads.set(`google-${source.platform.toLowerCase()}-${creatorKey}`, {
          id: `google-${source.platform.toLowerCase()}-${creatorKey}`,
          name: username,
          username,
          platform: source.platform,
          profileUrl: source.profileUrl,
          tags: ['licensed image search'],
          observedAt: new Date().toISOString(),
          sourceAttribution: 'Google Programmable Search licensed-image result; media remains at its original source',
          confidence: exact ? 82 : 58,
          exactWatchMatch: exact,
        })
      }
    } catch {
      // Google failures never block other sources.
    }
  }
  const state = succeeded ? 'connected' : attempted ? 'error' : 'not-configured'
  return {
    leads: [...leads.values()],
    status: { ...base, state, creatorsFound: leads.size, detail: succeeded ? 'Google licensed-image profile discovery.' : 'Google credentials exist, but the CSE request failed.' },
    attempted,
    succeeded,
  }
}

// SerpApi shared query exclusions for subscription/leaked-content mirrors.
const SERPAPI_EXCLUSIONS = '-site:coomer.su -site:coomer.party -site:kemono.su -site:kemono.party -site:leakedmodels.com -site:thothub.to'

type SerpApiImageResult = {
  title?: string
  original?: string
  thumbnail?: string
  source?: string
  link?: string
  position?: number
}

type SerpApiOrganicResult = {
  title?: string
  link?: string
  snippet?: string
  position?: number
}

type SerpApiResponse = {
  images_results?: SerpApiImageResult[]
  organic_results?: SerpApiOrganicResult[]
  error?: string
}

/**
 * SerpApi Google Images adapter.
 *
 * Uses the SerpApi google_images engine to discover source-attributed photos
 * of public gay male creators. Thumbnails are included as third-party URLs
 * intended to be rendered by the browser with referrerpolicy=no-referrer.
 * No media is proxied, archived, or rehosted. Subscription mirrors, leaked-
 * content aggregators, and paywall pages are excluded via query terms.
 *
 * Requires SERPAPI_API_KEY.
 */
async function collectSerpApiGoogleImages(watchlist: string[]): Promise<{ media: UnifiedMediaItem[]; leads: CreatorLead[]; status: SourceStatus; attempted: number; succeeded: number }> {
  const apiKey = (process.env.SERPAPI_API_KEY || '').trim()
  const base: SourceStatus = {
    id: 'serpapi-google-images',
    name: 'Google Images (SerpApi)',
    mode: 'discovery',
    state: 'not-configured',
    mediaFound: 0,
    creatorsFound: 0,
    detail: 'Set SERPAPI_API_KEY to enable Google Images discovery via SerpApi. Results are source-attributed leads; thumbnails are rendered by the browser only.',
    searchUrl: 'https://www.google.com/search?tbm=isch&q=gay+male+creator+public',
  }
  if (!apiKey) return { media: [], leads: [], status: base, attempted: 0, succeeded: 0 }

  const media: UnifiedMediaItem[] = []
  const leads = new Map<string, CreatorLead>()
  let attempted = 0
  let succeeded = 0

  // Build queries: one per watched creator, plus one general discovery query.
  const queries: Array<{ q: string; context: 'watchlist' | 'broad' }> = []
  for (const creator of watchlist.slice(0, 3)) {
    const display = sanitize(creator).slice(0, 50)
    if (display.length >= 2) queries.push({ q: `${display} gay male creator ${SERPAPI_EXCLUSIONS}`, context: 'watchlist' })
  }
  queries.push({ q: `gay male creator public photos ${SERPAPI_EXCLUSIONS}`, context: 'broad' })

  for (const { q, context } of queries.slice(0, 4)) {
    attempted += 1
    try {
      const url = `https://serpapi.com/search?engine=google_images&q=${encodeURIComponent(q)}&safe=active&num=8&api_key=${encodeURIComponent(apiKey)}`
      const body = await fetchJson(url) as SerpApiResponse
      if (body.error) throw new Error(body.error)
      succeeded += 1
      for (const result of body.images_results || []) {
        const pageUrl = safeHttpsUrl(result.link)
        if (!pageUrl || isBlockedHost(pageUrl)) continue
        const thumbnail = safeHttpsUrl(result.thumbnail)
        const title = sanitize(result.title || '').slice(0, 140) || sanitize(result.source || '').slice(0, 80)
        if (!title) continue
        const creatorSource = creatorFromUrl(pageUrl)
        const mediaId = `serpapi-gi-${Buffer.from(pageUrl).toString('base64').slice(0, 16)}`
        media.push({
          id: mediaId,
          title,
          thumbnail,
          source: 'Google Images (SerpApi)',
          duration: '',
          isVideo: false,
          category: 'Web discovery',
          creator: creatorSource?.username || sanitize(result.source || '').slice(0, 40),
          tags: ['serpapi', 'google images', 'web discovery'],
          rating: 0,
          createdAt: new Date().toISOString(),
          views: 0,
          mediaUrl: undefined,
          streamCandidates: [],
          pageUrl,
          profileUrl: creatorSource?.profileUrl,
          description: `Source: ${sanitize(result.source || pageUrl).slice(0, 120)}`,
          likes: 0,
          comments: 0,
          isLiked: false,
          isNew: true,
          isTrending: false,
          curationScore: 0,
          curationReasons: [],
          isWatchedCreator: Boolean(creatorSource && watched(creatorSource.username, watchlist)),
        })
        if (creatorSource) {
          const username = sanitize(creatorSource.username)
          const creatorKey = canonical(username)
          if (creatorKey) {
            const exact = watched(username, watchlist)
            leads.set(`serpapi-gi-${creatorSource.platform.toLowerCase()}-${creatorKey}`, {
              id: `serpapi-gi-${creatorSource.platform.toLowerCase()}-${creatorKey}`,
              name: username,
              username,
              platform: creatorSource.platform,
              profileUrl: creatorSource.profileUrl,
              tags: ['serpapi google images'],
              observedAt: new Date().toISOString(),
              sourceAttribution: 'SerpApi Google Images result; thumbnail from third-party source, not proxied or rehosted',
              confidence: exact ? 76 : context === 'watchlist' ? 60 : 42,
              exactWatchMatch: exact,
            })
          }
        }
      }
    } catch {
      // SerpApi Google Images failures never block other sources.
    }
  }
  const state = succeeded ? 'connected' : attempted ? 'error' : 'not-configured'
  return {
    media,
    leads: [...leads.values()],
    status: {
      ...base,
      state,
      mediaFound: media.length,
      creatorsFound: leads.size,
      detail: succeeded
        ? 'SerpApi Google Images discovery: source-attributed photo leads. Thumbnails are third-party browser-rendered only; no media is proxied or rehosted.'
        : 'SERPAPI_API_KEY set but Google Images request failed.',
    },
    attempted,
    succeeded,
  }
}

/**
 * SerpApi DuckDuckGo adapter.
 *
 * Uses the SerpApi duckduckgo engine to discover public creator profile and
 * post leads. Results that resolve to a known official source (X/Tumblr/Redgifs)
 * via creatorFromUrl are returned as CreatorLeads; others are discarded.
 * No media is ingested or proxied. Requires SERPAPI_API_KEY.
 */
async function collectSerpApiDuckDuckGo(watchlist: string[]): Promise<{ leads: CreatorLead[]; status: SourceStatus; attempted: number; succeeded: number }> {
  const apiKey = (process.env.SERPAPI_API_KEY || '').trim()
  const base: SourceStatus = {
    id: 'serpapi-duckduckgo',
    name: 'DuckDuckGo (SerpApi)',
    mode: 'discovery',
    state: 'not-configured',
    mediaFound: 0,
    creatorsFound: 0,
    detail: 'Set SERPAPI_API_KEY to enable DuckDuckGo discovery via SerpApi for public creator/profile leads.',
    searchUrl: 'https://duckduckgo.com/?q=gay+male+creator+public+profile',
  }
  if (!apiKey) return { leads: [], status: base, attempted: 0, succeeded: 0 }

  const leads = new Map<string, CreatorLead>()
  let attempted = 0
  let succeeded = 0

  const queries: string[] = []
  for (const creator of watchlist.slice(0, 2)) {
    const display = sanitize(creator).slice(0, 50)
    if (display.length >= 2) queries.push(`"${display}" gay creator public profile ${SERPAPI_EXCLUSIONS}`)
  }
  queries.push(`gay male creator public profile site:x.com OR site:tumblr.com OR site:redgifs.com`)

  for (const q of queries.slice(0, 3)) {
    attempted += 1
    try {
      const url = `https://serpapi.com/search?engine=duckduckgo&q=${encodeURIComponent(q)}&api_key=${encodeURIComponent(apiKey)}`
      const body = await fetchJson(url) as SerpApiResponse
      if (body.error) throw new Error(body.error)
      succeeded += 1
      for (const result of body.organic_results || []) {
        const pageUrl = safeHttpsUrl(result.link)
        if (!pageUrl || isBlockedHost(pageUrl)) continue
        const creatorSource = creatorFromUrl(pageUrl)
        if (!creatorSource) continue
        const username = sanitize(creatorSource.username)
        const creatorKey = canonical(username)
        if (!creatorKey) continue
        const exact = watched(username, watchlist)
        leads.set(`serpapi-ddg-${creatorSource.platform.toLowerCase()}-${creatorKey}`, {
          id: `serpapi-ddg-${creatorSource.platform.toLowerCase()}-${creatorKey}`,
          name: username,
          username,
          platform: creatorSource.platform,
          profileUrl: creatorSource.profileUrl,
          tags: ['serpapi duckduckgo'],
          observedAt: new Date().toISOString(),
          sourceAttribution: 'SerpApi DuckDuckGo result; lead resolves to an official platform source',
          confidence: exact ? 74 : 46,
          exactWatchMatch: exact,
        })
      }
    } catch {
      // SerpApi DuckDuckGo failures never block other sources.
    }
  }
  const state = succeeded ? 'connected' : attempted ? 'error' : 'not-configured'
  return {
    leads: [...leads.values()],
    status: {
      ...base,
      state,
      creatorsFound: leads.size,
      detail: succeeded
        ? 'SerpApi DuckDuckGo discovery: public creator/profile leads resolving to official platform sources.'
        : 'SERPAPI_API_KEY set but DuckDuckGo request failed.',
    },
    attempted,
    succeeded,
  }
}

// Firecrawl module-scope metadata cache (short-lived, never persisted).
const FIRECRAWL_CACHE_TTL_MS = 5 * 60_000
const firecrawlCache = new Map<string, { at: number; ogImage?: string; title?: string; description?: string; canonicalUrl?: string }>()

type FirecrawlMetadata = {
  title?: string
  description?: string
  ogImage?: string
  canonicalUrl?: string
}

type FirecrawlResponse = {
  success?: boolean
  data?: { metadata?: FirecrawlMetadata }
  error?: string
}

/**
 * Firecrawl public-page metadata adapter.
 *
 * Fetches OG image, title, and canonical URL from PUBLIC pages only.
 * Used to enrich creator profile leads discovered by other adapters.
 * Never accesses paywalled, subscription, or login-required pages.
 * Blocked hosts are refused before any request is made.
 * Cache is module-scope and short-lived; nothing is persisted.
 *
 * Requires FIRECRAWL_API_KEY.
 */
async function collectFirecrawl(watchlist: string[]): Promise<{ leads: CreatorLead[]; status: SourceStatus; attempted: number; succeeded: number }> {
  const apiKey = (process.env.FIRECRAWL_API_KEY || '').trim()
  const base: SourceStatus = {
    id: 'firecrawl',
    name: 'Firecrawl metadata',
    mode: 'discovery',
    state: 'not-configured',
    mediaFound: 0,
    creatorsFound: 0,
    detail: 'Set FIRECRAWL_API_KEY to enrich public creator profile pages with OG metadata and preview thumbnails.',
    searchUrl: undefined,
  }
  if (!apiKey) return { leads: [], status: base, attempted: 0, succeeded: 0 }

  const leads: CreatorLead[] = []
  let attempted = 0
  let succeeded = 0

  // Build public profile URLs from watchlist creators to enrich.
  const profileUrls: string[] = []
  for (const creator of watchlist.slice(0, 4)) {
    const handle = canonical(creator)
    if (handle.length >= 2) {
      profileUrls.push(`https://x.com/${encodeURIComponent(handle)}`)
      profileUrls.push(`https://www.redgifs.com/users/${encodeURIComponent(handle)}`)
    }
  }

  const now = Date.now()
  // Purge stale cache entries.
  for (const [k, v] of firecrawlCache) {
    if (now - v.at > FIRECRAWL_CACHE_TTL_MS) firecrawlCache.delete(k)
  }

  for (const profileUrl of profileUrls.slice(0, 6)) {
    if (isBlockedHost(profileUrl)) continue
    const cached = firecrawlCache.get(profileUrl)
    if (cached && now - cached.at < FIRECRAWL_CACHE_TTL_MS) {
      if (cached.ogImage || cached.title) {
        const creatorSource = creatorFromUrl(profileUrl)
        if (!creatorSource) continue
        const username = sanitize(creatorSource.username)
        const creatorKey = canonical(username)
        if (!creatorKey) continue
        leads.push({
          id: `firecrawl-${creatorSource.platform.toLowerCase()}-${creatorKey}`,
          name: sanitize(cached.title || username).slice(0, 80),
          username,
          platform: creatorSource.platform,
          profileUrl: cached.canonicalUrl || creatorSource.profileUrl,
          avatar: safeHttpsUrl(cached.ogImage),
          tags: ['firecrawl', 'og metadata'],
          observedAt: new Date().toISOString(),
          sourceAttribution: 'Firecrawl OG metadata from public page; preview thumbnail is transient and not archived',
          confidence: watched(username, watchlist) ? 85 : 55,
          exactWatchMatch: watched(username, watchlist),
        })
      }
      continue
    }
    attempted += 1
    try {
      const body = await fetchJson('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: profileUrl, formats: ['metadata'] }),
      }) as FirecrawlResponse
      if (!body.success) throw new Error(body.error || 'firecrawl_failed')
      succeeded += 1
      const meta = body.data?.metadata || {}
      const entry = {
        at: Date.now(),
        ogImage: safeHttpsUrl(meta.ogImage),
        title: sanitize(meta.title || '').slice(0, 80) || undefined,
        description: sanitize(meta.description || '').slice(0, 200) || undefined,
        canonicalUrl: safeHttpsUrl(meta.canonicalUrl),
      }
      if (firecrawlCache.size > 512) firecrawlCache.clear()
      firecrawlCache.set(profileUrl, entry)
      const creatorSource = creatorFromUrl(profileUrl)
      if (!creatorSource) continue
      const username = sanitize(creatorSource.username)
      const creatorKey = canonical(username)
      if (!creatorKey) continue
      if (entry.ogImage || entry.title) {
        leads.push({
          id: `firecrawl-${creatorSource.platform.toLowerCase()}-${creatorKey}`,
          name: entry.title || username,
          username,
          platform: creatorSource.platform,
          profileUrl: entry.canonicalUrl || creatorSource.profileUrl,
          avatar: entry.ogImage,
          tags: ['firecrawl', 'og metadata'],
          observedAt: new Date().toISOString(),
          sourceAttribution: 'Firecrawl OG metadata from public page; preview thumbnail is transient and not archived',
          confidence: watched(username, watchlist) ? 85 : 55,
          exactWatchMatch: watched(username, watchlist),
        })
      }
    } catch {
      // Firecrawl failures never block other sources.
    }
  }
  const state = succeeded ? 'connected' : attempted ? 'error' : 'not-configured'
  return {
    leads,
    status: {
      ...base,
      state,
      creatorsFound: leads.length,
      detail: succeeded
        ? 'Firecrawl public-page OG metadata enrichment. Thumbnails are transient previews only; no media archived.'
        : 'FIRECRAWL_API_KEY set but metadata request failed.',
    },
    attempted,
    succeeded,
  }
}

export async function collectAdditionalSources(watchlist: string[], opts: { query?: string } = {}): Promise<MultiSourceResult> {
  const ddgOptions = { watchlist, query: opts.query, creatorFromUrl, watched }
  const [x, tumblr, google, ddg, serpGoogleImages, serpDdg, firecrawl] = await Promise.all([
    collectX(watchlist),
    collectTumblr(watchlist),
    collectGoogle(watchlist),
    collectDuckDuckGo(ddgOptions),
    collectSerpApiGoogleImages(watchlist),
    collectSerpApiDuckDuckGo(watchlist),
    collectFirecrawl(watchlist),
  ])
  const statuses: SourceStatus[] = [
    x.status,
    tumblr.status,
    google.status,
    {
      id: 'duckduckgo', name: 'DuckDuckGo', mode: 'discovery',
      state: ddg.section.state, mediaFound: 0, creatorsFound: ddg.leads.length,
      detail: ddg.section.detail,
      searchUrl: ddg.section.searchUrl,
    },
    serpGoogleImages.status,
    serpDdg.status,
    firecrawl.status,
    {
      id: 'subscription-mirrors', name: 'Subscription mirrors', mode: 'blocked', state: 'blocked', mediaFound: 0, creatorsFound: 0,
      detail: 'Coomer/Kemono and other paywall mirrors are excluded. The app will not import leaked or subscription-only media.',
    },
  ]
  return {
    media: [...x.media, ...tumblr.media, ...serpGoogleImages.media],
    leads: [...x.leads, ...tumblr.leads, ...google.leads, ...ddg.leads, ...serpGoogleImages.leads, ...serpDdg.leads, ...firecrawl.leads],
    statuses,
    duckduckgo: ddg.section,
    requestsAttempted: x.attempted + tumblr.attempted + google.attempted + ddg.attempted + serpGoogleImages.attempted + serpDdg.attempted + firecrawl.attempted,
    requestsSucceeded: x.succeeded + tumblr.succeeded + google.succeeded + ddg.succeeded + serpGoogleImages.succeeded + serpDdg.succeeded + firecrawl.succeeded,
  }
}

function sanitize(value = ''): string {
  return value.replace(EMAIL_PATTERN, '').replace(/\s+/g, ' ').trim()
}

function canonical(value = ''): string {
  return value.trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]+/g, '')
}

function isoFromUnix(value: number | undefined): string {
  return value ? new Date(value * 1000).toISOString() : new Date().toISOString()
}

