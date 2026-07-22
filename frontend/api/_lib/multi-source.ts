import { collectDuckDuckGo } from './duckduckgo.js'
import type { CreatorLead, MultiSourceResult, SourceStatus, UnifiedMediaItem } from './discovery-types.js'
import { isScopedAdultPeerTubeMetadata } from './source-quality.js'

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PROVIDER_TIMEOUT_MS = 6_500
const OPTIONAL_DISCOVERY_BUDGET_MS = 2_500
function sanitize(value = ''): string {
  return value.replace(EMAIL_PATTERN, '').replace(/\s+/g, ' ').trim()
}
function canonical(value = ''): string {
  return value.trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]+/g, '')
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

function watched(creator: string, watchlist: string[]): boolean {
  const target = canonical(creator)
  return Boolean(target) && watchlist.some((item) => canonical(item) === target)
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

type CredentialedDiscovery = {
  media: UnifiedMediaItem[]
  leads: CreatorLead[]
  statuses: SourceStatus[]
  requestsAttempted: number
  requestsSucceeded: number
}

function renderBackendOrigin(): string {
  const configured = (process.env.RENDER_BACKEND_ORIGIN || '').trim()
  try {
    const url = new URL(configured || 'https://codex-research-radar.onrender.com')
    if (url.protocol !== 'https:' || url.username || url.password) return 'https://codex-research-radar.onrender.com'
    return url.origin
  } catch {
    return 'https://codex-research-radar.onrender.com'
  }
}

async function collectCredentialedSources(watchlist: string[], query: string): Promise<CredentialedDiscovery> {
  const fallback: CredentialedDiscovery = {
    media: [],
    leads: [],
    statuses: [{
      id: 'x', name: 'Render provider gateway', mode: 'stream', state: 'limited',
      mediaFound: 0, creatorsFound: 0,
      detail: 'Render credential-backed discovery is temporarily unavailable; public sources remain active.',
    }],
    requestsAttempted: 1,
    requestsSucceeded: 0,
  }
  try {
    const body = await fetchJson(
      renderBackendOrigin() + '/api/discovery/providers',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchlist: watchlist.slice(0, 8), query }),
      },
    ) as Partial<CredentialedDiscovery>
    return {
      media: Array.isArray(body.media) ? body.media : [],
      leads: Array.isArray(body.leads) ? body.leads : [],
      statuses: Array.isArray(body.statuses) ? body.statuses : [],
      requestsAttempted: Number.isFinite(body.requestsAttempted) ? Math.max(0, Number(body.requestsAttempted)) : 0,
      requestsSucceeded: Number.isFinite(body.requestsSucceeded) ? Math.max(0, Number(body.requestsSucceeded)) : 0,
    }
  } catch {
    return fallback
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
  const [credentialed, ddg, peertube] = await Promise.all([
    collectCredentialedSources(watchlist, query),
    ddgPromise,
    withTimeoutFallback(collectPeerTube({ query: query || undefined }), peerTubeFallback, OPTIONAL_DISCOVERY_BUDGET_MS + 1500),
  ])
  const statuses: SourceStatus[] = [
    ...credentialed.statuses,
    peertube.status,
    ...(shouldRunDdg ? [{
      id: 'duckduckgo', name: 'DuckDuckGo', mode: 'discovery',
      state: ddg.section.state, mediaFound: 0, creatorsFound: ddg.leads.length,
      detail: ddg.section.detail,
      searchUrl: ddg.section.searchUrl,
    } as SourceStatus] : []),
  ].filter((source) => source.state !== 'not-configured')
  return {
    media: [...credentialed.media, ...peertube.media],
    leads: [...credentialed.leads, ...ddg.leads],
    statuses,
    duckduckgo: ddg.section,
    requestsAttempted: credentialed.requestsAttempted + ddg.attempted + peertube.attempted,
    requestsSucceeded: credentialed.requestsSucceeded + ddg.succeeded + peertube.succeeded,
  }
}
