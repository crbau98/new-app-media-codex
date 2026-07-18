/**
 * DuckDuckGo discovery connector (metadata-only).
 *
 * DuckDuckGo has no official general-search API, so this connector uses the
 * same lightweight vqd flow the rest of the project already relies on: fetch
 * the public results page to obtain a `vqd` token, then query the JSON
 * endpoints that power duckduckgo.com's own image/video tabs.
 *
 * Hard rules:
 * - Metadata only. This connector NEVER returns playable media and never
 *   rehosts or embeds third-party content. Leads are outbound links with
 *   attribution; media stays at its original source.
 * - Low volume: at most 3 sequential queries per invocation, 120s cache,
 *   single-flight dedupe, descriptive User-Agent.
 * - Graceful degradation: any block/anomaly page/rate limit degrades to a
 *   'limited' state with a private-search handoff URL instead of throwing.
 */
import type { CreatorLead, DuckDuckGoLead, DuckDuckGoSection } from './discovery-types.js'

const DDG_BASE = 'https://duckduckgo.com'
const DDG_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 MediaCodex/1.0 (+source-attributed-discovery)'
const REQUEST_TIMEOUT_MS = 8_000
const CACHE_TTL_MS = 120_000
const MAX_QUERIES = 3
const MAX_LEADS_PER_QUERY = 8
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi

type DuckDuckGoOptions = {
  watchlist: string[]
  query?: string
  creatorFromUrl: (value: string | undefined) => { username: string; platform: string; profileUrl: string } | null
  watched: (creator: string, watchlist: string[]) => boolean
}

export type DuckDuckGoResult = {
  section: DuckDuckGoSection
  leads: CreatorLead[]
  attempted: number
  succeeded: number
}

const responseCache = new Map<string, { at: number; value: DuckDuckGoResult }>()
const inflight = new Map<string, Promise<DuckDuckGoResult>>()

function clean(value = ''): string {
  return value
    .replace(EMAIL_PATTERN, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function canonical(value = ''): string {
  return value.trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]+/g, '')
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': DDG_UA, Accept: 'text/html,application/json' },
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': DDG_UA,
        Accept: 'application/json',
        Referer: `${DDG_BASE}/`,
      },
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/** Extract the vqd token DuckDuckGo requires for its JSON endpoints. */
async function getVqd(query: string): Promise<string | null> {
  try {
    const html = await fetchText(`${DDG_BASE}/?q=${encodeURIComponent(query)}&ia=web`)
    return (
      /vqd="([^"]+)"/.exec(html)?.[1] ||
      /vqd='([^']+)'/.exec(html)?.[1] ||
      /vqd=([\d-]+)&/.exec(html)?.[1] ||
      null
    )
  } catch {
    return null
  }
}

/** Unwrap duckduckgo.com/l/?uddg= redirect links to their real targets. */
function unwrapDuckLink(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value)
    if (/duckduckgo\.com$/i.test(url.hostname)) {
      const uddg = url.searchParams.get('uddg')
      if (uddg) return decodeURIComponent(uddg)
      return undefined
    }
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function hostLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

type DdgImageResult = { title?: string; url?: string; image?: string; source?: string }
type DdgVideoResult = {
  title?: string
  description?: string
  url?: string
  content?: string
  publisher?: string
  published?: string
  duration?: string
}

async function collectQuery(query: string, options: DuckDuckGoOptions): Promise<{ leads: DuckDuckGoLead[]; creators: CreatorLead[] }> {
  const vqd = await getVqd(query)
  if (!vqd) throw new Error('token_unavailable')
  const leads: DuckDuckGoLead[] = []
  const creators = new Map<string, CreatorLead>()
  const seen = new Set<string>()

  const pushLead = (lead: DuckDuckGoLead) => {
    const key = lead.url
    if (seen.has(key) || leads.length >= MAX_LEADS_PER_QUERY) return
    seen.add(key)
    leads.push(lead)
    const source = options.creatorFromUrl(lead.url)
    if (!source) return
    const username = clean(source.username)
    const creatorKey = canonical(username)
    if (!creatorKey) return
    lead.creatorKey = creatorKey
    lead.kind = lead.kind === 'video' ? 'video' : 'profile'
    const exact = options.watched(username, options.watchlist)
    creators.set(`ddg-${source.platform.toLowerCase()}-${creatorKey}`, {
      id: `ddg-${source.platform.toLowerCase()}-${creatorKey}`,
      name: username,
      username,
      platform: source.platform,
      profileUrl: source.profileUrl,
      tags: ['web discovery'],
      observedAt: new Date().toISOString(),
      sourceAttribution: 'DuckDuckGo public web search result; media remains at its original source',
      confidence: exact ? 78 : 44,
      exactWatchMatch: exact,
    })
  }

  // Video tab results (v.js) — surfaced as attributed outbound video links only.
  try {
    const body = (await fetchJson(
      `${DDG_BASE}/v.js?l=us-en&o=json&vqd=${encodeURIComponent(vqd)}&q=${encodeURIComponent(query)}`,
    )) as { results?: DdgVideoResult[] }
    for (const result of body.results || []) {
      const url = unwrapDuckLink(result.url) || unwrapDuckLink(result.content)
      if (!url) continue
      const title = clean(result.title || '').slice(0, 140) || hostLabel(url)
      if (!title) continue
      pushLead({
        title,
        url,
        snippet: clean(result.description || '').slice(0, 200) || undefined,
        kind: 'video',
      })
    }
  } catch {
    // Video tab failure must not kill the whole query — images may still work.
  }

  // Image tab results (i.js) — only the source page link is used, never the image asset.
  try {
    const body = (await fetchJson(
      `${DDG_BASE}/i.js?l=us-en&o=json&vqd=${encodeURIComponent(vqd)}&q=${encodeURIComponent(query)}&f=,,,&p=1`,
    )) as { results?: DdgImageResult[] }
    for (const result of body.results || []) {
      const url = unwrapDuckLink(result.url)
      if (!url) continue
      const title = clean(result.title || '').slice(0, 140) || hostLabel(url)
      if (!title) continue
      pushLead({ title, url, snippet: hostLabel(url) || undefined, kind: 'post' })
    }
  } catch {
    // tolerate
  }

  return { leads, creators: [...creators.values()] }
}

function buildQueries(options: DuckDuckGoOptions): string[] {
  const queries: string[] = []
  const userQuery = clean(options.query || '').slice(0, 60)
  if (userQuery) queries.push(`${userQuery} gay creator`)
  for (const name of options.watchlist.slice(0, MAX_QUERIES - queries.length)) {
    const display = clean(name).slice(0, 50)
    if (display.length >= 2) queries.push(`"${display}" gay creator profile`)
  }
  if (!queries.length) queries.push('gay male creator public profile')
  return queries.slice(0, MAX_QUERIES)
}

function emptyResult(state: DuckDuckGoSection['state'], detail: string, searchUrl: string): DuckDuckGoResult {
  return { section: { state, detail, leads: [], searchUrl }, leads: [], attempted: 0, succeeded: 0 }
}

async function run(options: DuckDuckGoOptions): Promise<DuckDuckGoResult> {
  const queries = buildQueries(options)
  const searchUrl = `${DDG_BASE}/?q=${encodeURIComponent(queries[0] || 'gay male creator public profile')}`
  const leads: DuckDuckGoLead[] = []
  const creators: CreatorLead[] = []
  let succeeded = 0
  let lastError = ''
  // Sequential by design: keep request volume against DDG minimal.
  for (const query of queries) {
    try {
      const result = await collectQuery(query, options)
      succeeded += 1
      for (const lead of result.leads) {
        if (leads.length >= 24 || leads.some((existing) => existing.url === lead.url)) continue
        leads.push(lead)
      }
      for (const creator of result.creators) {
        if (!creators.some((existing) => existing.id === creator.id)) creators.push(creator)
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'request failed'
    }
  }
  if (!succeeded) {
    return {
      section: {
        state: 'limited',
        detail: `DuckDuckGo public endpoints are unreachable from this deployment (${lastError || 'blocked'}). Use the private-search handoff instead.`,
        leads: [],
        searchUrl,
      },
      leads: [],
      attempted: queries.length,
      succeeded: 0,
    }
  }
  return {
    section: {
      state: 'connected',
      detail: 'Public web/video search via DuckDuckGo; results are outbound links only — nothing is copied, embedded, or rehosted.',
      leads,
      searchUrl,
    },
    leads: creators,
    attempted: queries.length,
    succeeded,
  }
}

export async function collectDuckDuckGo(options: DuckDuckGoOptions): Promise<DuckDuckGoResult> {
  const key = `${options.watchlist.map(canonical).filter(Boolean).sort().join(',')}|${canonical(options.query || '')}`
  const cached = responseCache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value
  const pending = inflight.get(key)
  if (pending) return pending
  const promise = run(options)
    .then((value) => {
      responseCache.set(key, { at: Date.now(), value })
      if (responseCache.size > 256) responseCache.clear()
      return value
    })
    .catch(() => emptyResult('error', 'DuckDuckGo discovery failed unexpectedly; handoff link preserved.', `${DDG_BASE}/?q=gay+male+creator`))
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, promise)
  return promise
}
