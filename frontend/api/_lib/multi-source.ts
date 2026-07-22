import { collectDuckDuckGo } from './duckduckgo.js'
import type { CreatorLead, MultiSourceResult, SourceStatus, UnifiedMediaItem } from './discovery-types.js'
import { isScopedAdultPeerTubeMetadata } from './source-quality.js'

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PROVIDER_TIMEOUT_MS = 6_500
const OPTIONAL_DISCOVERY_BUDGET_MS = 2_500
// Exclusion-only blocklist: strictly female/straight markers. Trans-related
// terms were removed — trans men are in scope, and identity terms must never
// be used as exclusion signals.
const FEMALE_MARKERS = new Set([
  'female', 'woman', 'women', 'girl', 'girls', 'lesbian', 'straight', 'pussy', 'vagina',
  'wife', 'girlfriend', 'milf', 'femdom',
])
const SCOPE_MARKERS = new Set(['gay', 'male', 'man', 'men', 'mlm', 'boy', 'boys', 'guy', 'guys', 'hunk', 'jock', 'twink', 'daddy', 'bear', 'muscle'])

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

async function collectX(watchlist: string[]): Promise<{ media: UnifiedMediaItem[]; leads: CreatorLead[]; status: SourceStatus; attempted: number; succeeded: number }> {
  const token = (process.env.X_BEARER_TOKEN || '').trim()
  const base: SourceStatus = {
    id: 'x', name: 'X', mode: 'stream', state: 'not-configured', mediaFound: 0, creatorsFound: 0,
    detail: 'Set X_BEARER_TOKEN to enable official X API discovery for public posts.',
    searchUrl: 'https://x.com/search?q=gay%20creator&src=typed_query&f=live',
  }
  if (!token) return { media: [], leads: [], status: base, attempted: 0, succeeded: 0 }

  const headers = { Authorization: `Bearer ${token}` }
  const media: UnifiedMediaItem[] = []
  const leads = new Map<string, CreatorLead>()
  let attempted = 0
  let succeeded = 0
  for (const creator of watchlist.slice(0, 4)) {
    const query = sanitize(creator).slice(0, 60)
    if (!query) continue
    attempted += 1
    try {
      const body = await fetchJson(
        `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(`from:${query} has:media -is:retweet`)}&max_results=10&expansions=author_id,attachments.media_keys&user.fields=username,name,profile_image_url&media.fields=url,preview_image_url,type,variants`,
        { headers },
      ) as { data?: XTweet[]; includes?: { users?: XUser[]; media?: Array<{ media_key?: string; type?: string; url?: string; preview_image_url?: string; variants?: Array<{ url?: string; content_type?: string; bit_rate?: number }> }> } }
      succeeded += 1
      const users = new Map((body.includes?.users || []).map((user) => [user.id, user]))
      const assets = new Map((body.includes?.media || []).map((asset) => [asset.media_key, asset]))
      for (const tweet of body.data || []) {
        const text = sanitize(tweet.text || '')
        const tokens = new Set(text.toLowerCase().split(/[^a-z0-9/]+/).filter(Boolean))
        const exact = watched(query, watchlist)
        const scoped = exact || [...SCOPE_MARKERS].some((marker) => tokens.has(marker))
        if (!scoped || [...FEMALE_MARKERS].some((marker) => tokens.has(marker))) continue
        const author = users.get(tweet.author_id)
        const username = sanitize(author?.username || query)
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
            confidence: exact ? 88 : 64,
            exactWatchMatch: exact,
          })
        }
        for (const key of tweet.attachments?.media_keys || []) {
          const asset = assets.get(key)
          if (!asset) continue
          const video = asset.type === 'video' || asset.type === 'animated_gif'
          const stream = video
            ? (asset.variants || [])
              .filter((variant) => variant.content_type === 'video/mp4' && variant.url)
              .sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0))
              .map((variant) => variant.url as string)
            : []
          const pageUrl = `https://x.com/${encodeURIComponent(username)}/status/${tweet.id}`
          const thumbnail = safeUrl(asset.preview_image_url || asset.url, /(^|\.)twimg\.com$/i)
          const mediaUrl = safeUrl(stream[0] || asset.url, /(^|\.)twimg\.com$/i)
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
    } catch {
      // X failures never block other sources.
    }
  }
  const state = succeeded ? 'connected' : attempted ? 'error' : 'not-configured'
  return {
    media,
    leads: [...leads.values()],
    status: { ...base, state, mediaFound: media.length, creatorsFound: leads.size, detail: succeeded ? 'Official X API public-post discovery.' : 'X credentials exist, but the recent-search request failed.' },
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

type SepiaVideo = {
  uuid?: string
  name?: string
  description?: string
  duration?: number
  tags?: string[]
  thumbnailUrl?: string
  url?: string
  publishedAt?: string
  views?: number
  likes?: number
  nsfw?: boolean
  account?: { displayName?: string; name?: string; url?: string; host?: string }
  channel?: { displayName?: string; name?: string }
}

const PEERTUBE_SCOPE_QUERIES = ['gay amateur', 'gay bareback', 'gay muscle', 'gay twink']

function peerTubeSearchBase(): string {
  const configured = (process.env.PEERTUBE_SEARCH_BASE || '').trim()
  const base = configured || 'https://sepiasearch.org'
  try {
    const url = new URL(base)
    if (url.protocol !== 'https:') return 'https://sepiasearch.org'
    return url.origin
  } catch {
    return 'https://sepiasearch.org'
  }
}

function peerTubeItemScope(video: SepiaVideo): boolean {
  return isScopedAdultPeerTubeMetadata({
    name: sanitize(video.name || ''),
    description: sanitize(video.description || ''),
    tags: (video.tags || []).map((tag) => sanitize(tag)),
    accountName: sanitize(video.account?.displayName || video.account?.name || ''),
    channelName: sanitize(video.channel?.displayName || video.channel?.name || ''),
  })
}

function safePublicUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
}

async function collectPeerTube(opts: { query?: string } = {}): Promise<{ media: UnifiedMediaItem[]; status: SourceStatus; attempted: number; succeeded: number }> {
  const base: SourceStatus = {
    id: 'peertube', name: 'PeerTube', mode: 'stream', state: 'error', mediaFound: 0, creatorsFound: 0,
    detail: 'The public PeerTube index is temporarily unreachable.',
    searchUrl: `https://sepiasearch.org/search?q=${encodeURIComponent(opts.query || 'gay')}`,
  }
  const queries = [...(opts.query ? [sanitize(opts.query).slice(0, 60)] : []), ...PEERTUBE_SCOPE_QUERIES]
    .filter((value, index, list) => value && list.indexOf(value) === index)
    .slice(0, 4)
  const media: UnifiedMediaItem[] = []
  const seen = new Set<string>()
  let attempted = 0
  let succeeded = 0
  const baseUrl = peerTubeSearchBase()
  await Promise.all(queries.map(async (query) => {
    attempted += 1
    try {
      const params = new URLSearchParams({ search: query, count: '8', nsfw: 'both', resultType: 'videos' })
      const body = await fetchJson(`${baseUrl}/api/v1/search/videos?${params}`) as { data?: SepiaVideo[] }
      succeeded += 1
      for (const video of (body.data || []).slice(0, 8)) {
        const uuid = String(video.uuid || '')
        const pageUrl = safePublicUrl(video.url)
        const thumbnail = safePublicUrl(video.thumbnailUrl)
        if (!uuid || !pageUrl || !thumbnail || seen.has(uuid)) continue
        // A publisher NSFW flag alone is noisy on a general federated index.
        // Pair it with explicit, publisher-provided scope metadata.
        if (video.nsfw !== true) continue
        if (!peerTubeItemScope(video)) continue
        seen.add(uuid)
        const creator = sanitize(video.account?.displayName || video.account?.name || '') || 'PeerTube creator'
        const host = video.account?.host || (() => { try { return new URL(pageUrl).hostname } catch { return '' } })()
        const whole = Math.max(0, Math.floor(video.duration || 0))
        media.push({
          id: `pt-${uuid}`,
          title: sanitize(video.name || '').slice(0, 96) || `PeerTube video by ${creator}`,
          thumbnail,
          source: 'PeerTube',
          duration: `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`,
          isVideo: true,
          category: 'PeerTube federated',
          creator,
          tags: (video.tags || []).map((tag) => sanitize(tag)).filter(Boolean).slice(0, 8),
          rating: 0,
          createdAt: typeof video.publishedAt === 'string' ? video.publishedAt : new Date().toISOString(),
          views: Math.max(0, video.views || 0),
          streamCandidates: [],
          pageUrl,
          profileUrl: safePublicUrl(video.account?.url),
          description: sanitize(video.description || '').slice(0, 400) || undefined,
          likes: Math.max(0, video.likes || 0),
          comments: 0,
          isLiked: false,
          isNew: false,
          isTrending: false,
          curationScore: 0,
          curationReasons: [`federated public video on ${host || 'a PeerTube instance'}`],
          isWatchedCreator: false,
        })
      }
    } catch {
      // One failed query never blocks the other lanes or sources.
    }
  }))
  const state = succeeded ? 'connected' : 'error'
  return {
    media,
    status: {
      ...base,
      state,
      mediaFound: media.length,
      detail: succeeded
        ? 'Public PeerTube videos matched from explicit publisher metadata.'
        : base.detail,
    },
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

function withTimeoutFallback<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch(() => {
        clearTimeout(timer)
        resolve(fallback)
      })
  })
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

export async function collectAdditionalSources(watchlist: string[], opts: { query?: string } = {}): Promise<MultiSourceResult> {
  const query = sanitize(opts.query || '')
  const shouldRunDdg = Boolean(query) || watchlist.some((creator) => canonical(creator).length > 0)
  const ddgFallback = {
    section: {
      state: 'limited' as const,
      detail: shouldRunDdg
        ? `DuckDuckGo discovery was deferred by the ${OPTIONAL_DISCOVERY_BUDGET_MS}ms optional budget so playable media can return first.`
        : 'DuckDuckGo discovery skipped for the default feed (no query/watchlist).',
      leads: [],
      searchUrl: `https://duckduckgo.com/?q=${encodeURIComponent(query || 'gay male creator public profile')}`,
    },
    leads: [],
    attempted: 0,
    succeeded: 0,
  }
  const ddgPromise = shouldRunDdg
    ? withTimeoutFallback(
      collectDuckDuckGo({ watchlist, query: query || undefined, creatorFromUrl, watched }),
      ddgFallback,
      OPTIONAL_DISCOVERY_BUDGET_MS,
    )
    : Promise.resolve(ddgFallback)
  const peerTubeFallback = {
    media: [] as UnifiedMediaItem[],
    status: {
      id: 'peertube', name: 'PeerTube', mode: 'stream', state: 'limited',
      mediaFound: 0, creatorsFound: 0,
      detail: `PeerTube discovery was deferred by the optional budget so core sources return first.`,
      searchUrl: 'https://sepiasearch.org/search?q=gay',
    } as SourceStatus,
    attempted: 0,
    succeeded: 0,
  }
  const [x, tumblr, google, ddg, peertube] = await Promise.all([
    collectX(watchlist),
    collectTumblr(watchlist),
    collectGoogle(watchlist),
    ddgPromise,
    withTimeoutFallback(collectPeerTube({ query: query || undefined }), peerTubeFallback, OPTIONAL_DISCOVERY_BUDGET_MS + 1500),
  ])
  const statuses: SourceStatus[] = [
    x.status,
    tumblr.status,
    peertube.status,
    google.status,
    ...(shouldRunDdg ? [{
      id: 'duckduckgo', name: 'DuckDuckGo', mode: 'discovery',
      state: ddg.section.state, mediaFound: 0, creatorsFound: ddg.leads.length,
      detail: ddg.section.detail,
      searchUrl: ddg.section.searchUrl,
    } as SourceStatus] : []),
  ].filter((source) => source.state !== 'not-configured')
  return {
    media: [...x.media, ...tumblr.media, ...peertube.media],
    leads: [...x.leads, ...tumblr.leads, ...google.leads, ...ddg.leads],
    statuses,
    duckduckgo: ddg.section,
    requestsAttempted: x.attempted + tumblr.attempted + google.attempted + ddg.attempted + peertube.attempted,
    requestsSucceeded: x.succeeded + tumblr.succeeded + google.succeeded + ddg.succeeded + peertube.succeeded,
  }
}
