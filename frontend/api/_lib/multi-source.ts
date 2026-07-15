import type { CreatorLead, MultiSourceResult, SourceStatus, UnifiedMediaItem } from './discovery-types.js'

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PROVIDER_TIMEOUT_MS = 9_000
const FEMALE_MARKERS = new Set([
  'female', 'woman', 'women', 'girl', 'girls', 'lesbian', 'straight', 'pussy', 'vagina',
  'wife', 'girlfriend', 'milf', 'femdom', 'trans', 'transgender', 'shemale', 'ladyboy',
])
const SCOPE_MARKERS = new Set(['gay', 'queer', 'lgbt', 'lgbtq', 'mlm'])

type XUser = { id?: string; username?: string; name?: string; profile_image_url?: string }
type XMedia = {
  media_key?: string
  type?: string
  url?: string
  preview_image_url?: string
  duration_ms?: number
  variants?: Array<{ bit_rate?: number; content_type?: string; url?: string }>
  public_metrics?: { view_count?: number }
}
type XPost = {
  id?: string
  author_id?: string
  text?: string
  created_at?: string
  attachments?: { media_keys?: string[] }
  public_metrics?: { like_count?: number; reply_count?: number; impression_count?: number }
}

type TumblrPost = {
  id?: number | string
  blog_name?: string
  post_url?: string
  timestamp?: number
  date?: string
  summary?: string
  caption?: string
  tags?: string[]
  photos?: Array<{ original_size?: { url?: string }; alt_sizes?: Array<{ url?: string }> }>
  video_url?: string
  thumbnail_url?: string
  duration?: number
  note_count?: number
  content?: Array<{ type?: string; media?: Array<{ url?: string }>; url?: string; text?: string }>
}

type GoogleItem = {
  title?: string
  link?: string
  displayLink?: string
  snippet?: string
  image?: { contextLink?: string; thumbnailLink?: string }
}

function clean(value = ''): string {
  return value.replace(EMAIL_PATTERN, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function canonical(value = ''): string {
  return value.trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]+/g, '')
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
}

function scoped(value: string, exactWatchMatch: boolean): boolean {
  if (exactWatchMatch) return true
  const words = tokens(value)
  return [...SCOPE_MARKERS].some((word) => words.has(word)) && ![...FEMALE_MARKERS].some((word) => words.has(word))
}

function watched(creator: string, watchlist: string[]): boolean {
  const key = canonical(creator)
  return Boolean(key) && watchlist.some((entry) => canonical(entry) === key)
}

function safeUrl(value: string | undefined, hosts: RegExp): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.test(url.hostname)) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function xAsset(value?: string): string | undefined {
  return safeUrl(value, /^(?:pbs|video)\.twimg\.com$/i)
}

function tumblrAsset(value?: string): string | undefined {
  return safeUrl(value, /^(?:\d+\.)?media\.tumblr\.com$|^va\.media\.tumblr\.com$/i)
}

function iso(value?: string | number): string {
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value || '')
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function durationLabel(milliseconds = 0): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function xQuery(watchlist: string[]): string {
  const handles = watchlist.map(canonical).filter((value) => /^[a-z0-9_]{2,15}$/.test(value)).slice(0, 5)
  const watchedClause = handles.length ? ` OR ${handles.map((handle) => `from:${handle}`).join(' OR ')}` : ''
  return `(("gay creator" OR "gay male creator" OR "gay onlyfans" OR "gay fansly")${watchedClause}) (has:images OR has:videos) -is:retweet`
}

async function collectX(watchlist: string[]): Promise<{ media: UnifiedMediaItem[]; leads: CreatorLead[]; status: SourceStatus; attempted: number; succeeded: number }> {
  const token = (process.env.X_BEARER_TOKEN || '').trim()
  if (!token) return {
    media: [], leads: [], attempted: 0, succeeded: 0,
    status: { id: 'x', name: 'X', mode: 'stream', state: 'not-configured', mediaFound: 0, creatorsFound: 0, detail: 'Add X_BEARER_TOKEN to use the official recent-search API.' },
  }
  try {
    const params = new URLSearchParams({
      query: xQuery(watchlist),
      max_results: '100',
      expansions: 'author_id,attachments.media_keys',
      'tweet.fields': 'created_at,public_metrics,attachments,author_id',
      'user.fields': 'id,name,username,profile_image_url',
      'media.fields': 'media_key,type,url,preview_image_url,duration_ms,variants,public_metrics',
    })
    const raw = await fetchJson(`https://api.x.com/2/tweets/search/recent?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }) as { data?: XPost[]; includes?: { users?: XUser[]; media?: XMedia[] } }
    const users = new Map((raw.includes?.users || []).map((user) => [user.id || '', user]))
    const mediaByKey = new Map((raw.includes?.media || []).map((media) => [media.media_key || '', media]))
    const items: UnifiedMediaItem[] = []
    const leads = new Map<string, CreatorLead>()
    for (const post of raw.data || []) {
      const user = users.get(post.author_id || '')
      const creator = clean(user?.username || user?.name || '')
      const creatorKey = canonical(creator)
      if (!post.id || !creatorKey) continue
      const exact = watched(creator, watchlist)
      if (!scoped(post.text || '', exact)) continue
      const profileUrl = `https://x.com/${encodeURIComponent(creator)}`
      leads.set(`x-${creatorKey}`, {
        id: `x-${creatorKey}`, name: clean(user?.name || creator), username: creator, platform: 'X', profileUrl,
        avatar: xAsset(user?.profile_image_url), tags: ['gay creator', 'public social'], observedAt: post.created_at || '',
        sourceAttribution: 'Public X post via the official X API', confidence: exact ? 100 : 72, exactWatchMatch: exact,
      })
      for (const key of post.attachments?.media_keys || []) {
        const media = mediaByKey.get(key)
        if (!media) continue
        const variants = (media.variants || [])
          .filter((variant) => variant.content_type === 'video/mp4')
          .sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0))
          .map((variant) => xAsset(variant.url))
          .filter((url): url is string => Boolean(url))
        const isVideo = media.type === 'video' || media.type === 'animated_gif'
        const image = xAsset(media.url || media.preview_image_url)
        const video = variants[0]
        if ((!isVideo && !image) || (isVideo && (!image || !video))) continue
        const metrics = post.public_metrics || {}
        items.push({
          id: `x-${post.id}-${key}`, title: clean(post.text || `Public post by ${creator}`).slice(0, 220), thumbnail: image,
          source: 'X', duration: isVideo ? durationLabel(media.duration_ms) : '', isVideo, category: 'gay creator', creator,
          tags: ['Gay', 'Public social', isVideo ? 'Video' : 'Photo'], rating: 0, createdAt: post.created_at || '',
          views: Math.max(0, metrics.impression_count || media.public_metrics?.view_count || 0), mediaUrl: isVideo ? video : undefined,
          streamCandidates: isVideo ? variants : [], pageUrl: `https://x.com/${encodeURIComponent(creator)}/status/${post.id}`,
          profileUrl, description: clean(post.text || '').slice(0, 500) || undefined, likes: Math.max(0, metrics.like_count || 0),
          comments: Math.max(0, metrics.reply_count || 0), isLiked: false, isNew: Boolean(post.created_at) && Date.now() - Date.parse(post.created_at || '') < 86_400_000,
          isTrending: false, curationScore: 0, curationReasons: [], isWatchedCreator: exact,
        })
      }
    }
    return {
      media: items, leads: [...leads.values()], attempted: 1, succeeded: 1,
      status: { id: 'x', name: 'X', mode: 'stream', state: 'connected', mediaFound: items.length, creatorsFound: leads.size, detail: 'Official recent-search API; public posts from the last seven days.' },
    }
  } catch (error) {
    return {
      media: [], leads: [], attempted: 1, succeeded: 0,
      status: { id: 'x', name: 'X', mode: 'stream', state: 'error', mediaFound: 0, creatorsFound: 0, detail: `Official API unavailable: ${error instanceof Error ? error.message : 'request failed'}` },
    }
  }
}

function tumblrText(post: TumblrPost): string {
  const blocks = (post.content || []).map((block) => block.text || '').join(' ')
  return clean([post.summary, post.caption, ...(post.tags || []), blocks].filter(Boolean).join(' '))
}

function tumblrAssets(post: TumblrPost): { images: string[]; video?: string; poster?: string } {
  const images = [
    ...(post.photos || []).map((photo) => tumblrAsset(photo.original_size?.url || photo.alt_sizes?.[0]?.url)),
    ...(post.content || []).flatMap((block) => (block.media || []).map((asset) => tumblrAsset(asset.url))),
  ].filter((url): url is string => Boolean(url))
  return { images: [...new Set(images)], video: tumblrAsset(post.video_url), poster: tumblrAsset(post.thumbnail_url) || images[0] }
}

async function collectTumblr(watchlist: string[]): Promise<{ media: UnifiedMediaItem[]; leads: CreatorLead[]; status: SourceStatus; attempted: number; succeeded: number }> {
  const apiKey = (process.env.TUMBLR_API_KEY || '').trim()
  if (!apiKey) return {
    media: [], leads: [], attempted: 0, succeeded: 0,
    status: { id: 'tumblr', name: 'Tumblr', mode: 'stream', state: 'not-configured', mediaFound: 0, creatorsFound: 0, detail: 'Add TUMBLR_API_KEY to use Tumblr API v2.' },
  }
  const requests: Array<Promise<unknown>> = [
    fetchJson(`https://api.tumblr.com/v2/tagged?${new URLSearchParams({ tag: 'gaycreator', limit: '20', filter: 'raw', api_key: apiKey })}`),
    ...watchlist.map(canonical).filter(Boolean).slice(0, 4).map((handle) =>
      fetchJson(`https://api.tumblr.com/v2/blog/${encodeURIComponent(handle)}.tumblr.com/posts?${new URLSearchParams({ limit: '20', filter: 'raw', npf: 'true', api_key: apiKey })}`)
    ),
  ]
  const settled = await Promise.allSettled(requests)
  const posts: TumblrPost[] = []
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue
    const body = result.value as { response?: TumblrPost[] | { posts?: TumblrPost[] } }
    if (Array.isArray(body.response)) posts.push(...body.response)
    else posts.push(...(body.response?.posts || []))
  }
  const items: UnifiedMediaItem[] = []
  const leads = new Map<string, CreatorLead>()
  const seen = new Set<string>()
  for (const post of posts) {
    const creator = clean(post.blog_name || '')
    const creatorKey = canonical(creator)
    const postId = String(post.id || '')
    if (!creatorKey || !postId || seen.has(postId)) continue
    seen.add(postId)
    const exact = watched(creator, watchlist)
    const text = tumblrText(post)
    if (!scoped(`${text} ${(post.tags || []).join(' ')}`, exact)) continue
    const profileUrl = `https://${creatorKey}.tumblr.com/`
    const assets = tumblrAssets(post)
    leads.set(`tumblr-${creatorKey}`, {
      id: `tumblr-${creatorKey}`, name: creator, username: creator, platform: 'Tumblr', profileUrl,
      tags: ['gay creator', ...(post.tags || []).map(clean).filter(Boolean).slice(0, 6)], observedAt: iso(post.timestamp || post.date),
      sourceAttribution: 'Public Tumblr post via Tumblr API v2', confidence: exact ? 100 : 70, exactWatchMatch: exact,
    })
    const common = {
      title: text.slice(0, 220) || `Public Tumblr post by ${creator}`, source: 'Tumblr', category: clean(post.tags?.[0] || 'gay creator'),
      creator, tags: ['Gay', ...(post.tags || []).map(clean).filter(Boolean).slice(0, 10)], rating: 0, createdAt: iso(post.timestamp || post.date),
      views: 0, pageUrl: post.post_url || profileUrl, profileUrl, description: text.slice(0, 500) || undefined,
      likes: Math.max(0, post.note_count || 0), comments: 0, isLiked: false as const,
      isNew: Boolean(post.timestamp) && Date.now() - (post.timestamp || 0) * 1000 < 86_400_000,
      isTrending: false, curationScore: 0, curationReasons: [], isWatchedCreator: exact,
    }
    if (assets.video && assets.poster) {
      items.push({ id: `tumblr-${postId}-video`, ...common, thumbnail: assets.poster, duration: durationLabel((post.duration || 0) * 1000), isVideo: true, mediaUrl: assets.video, streamCandidates: [assets.video] })
    }
    for (const [index, image] of assets.images.slice(0, 4).entries()) {
      items.push({ id: `tumblr-${postId}-photo-${index}`, ...common, thumbnail: image, duration: '', isVideo: false, streamCandidates: [] })
    }
  }
  const succeeded = settled.filter((result) => result.status === 'fulfilled').length
  return {
    media: items, leads: [...leads.values()], attempted: requests.length, succeeded,
    status: {
      id: 'tumblr', name: 'Tumblr', mode: 'stream', state: succeeded ? 'connected' : 'error', mediaFound: items.length, creatorsFound: leads.size,
      detail: succeeded ? 'Official Tumblr API v2 public posts.' : 'Tumblr API did not return a successful response.',
    },
  }
}

function creatorFromUrl(value: string | undefined): { username: string; platform: string; profileUrl: string } | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const segments = url.pathname.split('/').filter(Boolean)
    if (/^(?:www\.)?x\.com$/i.test(url.hostname) && segments[0] && !['home', 'search', 'explore'].includes(segments[0])) return { username: segments[0], platform: 'X', profileUrl: `https://x.com/${segments[0]}` }
    if (/\.tumblr\.com$/i.test(url.hostname)) return { username: url.hostname.split('.')[0], platform: 'Tumblr', profileUrl: `https://${url.hostname}/` }
    if (/^(?:www\.)?tumblr\.com$/i.test(url.hostname) && segments[0]) return { username: segments[0], platform: 'Tumblr', profileUrl: `https://www.tumblr.com/${segments[0]}` }
    if (/^(?:www\.)?(?:onlyfans|fansly)\.com$/i.test(url.hostname) && segments[0]) return { username: segments[0], platform: /fansly/i.test(url.hostname) ? 'Fansly' : 'OnlyFans', profileUrl: `${url.origin}/${segments[0]}` }
  } catch {
    return null
  }
  return null
}

async function collectGoogle(watchlist: string[]): Promise<{ leads: CreatorLead[]; status: SourceStatus; attempted: number; succeeded: number }> {
  const apiKey = (process.env.GOOGLE_CSE_API_KEY || '').trim()
  const cx = (process.env.GOOGLE_CSE_ID || '').trim()
  if (!apiKey || !cx) return {
    leads: [], attempted: 0, succeeded: 0,
    status: { id: 'google', name: 'Google Images', mode: 'discovery', state: 'not-configured', mediaFound: 0, creatorsFound: 0, detail: 'Existing Custom Search customers can add GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID; discovered images remain source links.' },
  }
  try {
    const seeds = watchlist.slice(0, 4).map((entry) => `"${clean(entry)}"`).join(' OR ')
    const query = `${seeds ? `(${seeds}) OR ` : ''}"gay male creator" (site:x.com OR site:tumblr.com OR site:onlyfans.com OR site:fansly.com)`
    const params = new URLSearchParams({ key: apiKey, cx, q: query, num: '10', safe: 'off', searchType: 'image', rights: 'cc_publicdomain|cc_attribute|cc_sharealike' })
    const raw = await fetchJson(`https://customsearch.googleapis.com/customsearch/v1?${params}`) as { items?: GoogleItem[] }
    const leads = new Map<string, CreatorLead>()
    for (const item of raw.items || []) {
      const source = creatorFromUrl(item.image?.contextLink || item.link)
      if (!source) continue
      const username = clean(source.username)
      const key = canonical(username)
      if (!key) continue
      const exact = watched(username, watchlist)
      leads.set(`google-${source.platform.toLowerCase()}-${key}`, {
        id: `google-${source.platform.toLowerCase()}-${key}`, name: username, username, platform: source.platform,
        profileUrl: source.profileUrl, tags: ['gay creator', 'web discovery'], observedAt: new Date().toISOString(),
        sourceAttribution: 'Google Programmable Search discovery result; media remains at its original source',
        confidence: exact ? 95 : 58, exactWatchMatch: exact,
      })
    }
    return {
      leads: [...leads.values()], attempted: 1, succeeded: 1,
      status: { id: 'google', name: 'Google Images', mode: 'discovery', state: 'connected', mediaFound: 0, creatorsFound: leads.size, detail: 'Licensed-image search is used to discover canonical public profiles; images are not copied or rehosted.' },
    }
  } catch (error) {
    return {
      leads: [], attempted: 1, succeeded: 0,
      status: { id: 'google', name: 'Google Images', mode: 'discovery', state: 'error', mediaFound: 0, creatorsFound: 0, detail: `Search API unavailable: ${error instanceof Error ? error.message : 'request failed'}` },
    }
  }
}

export async function collectAdditionalSources(watchlist: string[]): Promise<MultiSourceResult> {
  const [x, tumblr, google] = await Promise.all([collectX(watchlist), collectTumblr(watchlist), collectGoogle(watchlist)])
  const duckQuery = encodeURIComponent(`${watchlist.slice(0, 4).join(' OR ')} gay male creator public profile`.trim())
  const statuses: SourceStatus[] = [
    x.status,
    tumblr.status,
    google.status,
    {
      id: 'duckduckgo', name: 'DuckDuckGo', mode: 'discovery', state: 'limited', mediaFound: 0, creatorsFound: 0,
      detail: 'DuckDuckGo does not offer a supported general-search ingestion API. Open a private source search without copying results.',
      searchUrl: `https://duckduckgo.com/?q=${duckQuery}`,
    },
    {
      id: 'subscription-mirrors', name: 'Subscription mirrors', mode: 'blocked', state: 'blocked', mediaFound: 0, creatorsFound: 0,
      detail: 'Coomer/Kemono and other paywall mirrors are excluded. The app will not import leaked or subscription-only media.',
    },
  ]
  return {
    media: [...x.media, ...tumblr.media],
    leads: [...x.leads, ...tumblr.leads, ...google.leads],
    statuses,
    requestsAttempted: x.attempted + tumblr.attempted + google.attempted,
    requestsSucceeded: x.succeeded + tumblr.succeeded + google.succeeded,
  }
}
