/**
 * Creator web leads (metadata only). Uses public DuckDuckGo result links to
 * surface creator PROFILE URLs on well-known platforms. Nothing behind these
 * links is fetched or ingested; subscription platforms are link-only leads.
 */
import type { SourceCreatorHit } from './discovery-types.js'
import { searchDuckDuckGoLinks } from './duckduckgo.js'

export type ParsedProfileUrl = {
  platform: string
  handle: string
  profileUrl: string
  /** True for subscription/paywalled platforms: the link is shown, nothing is fetched. */
  linkOnly: boolean
}

const HANDLE = /^[A-Za-z0-9_.-]{1,50}$/
const RESERVED = new Set([
  'home', 'i', 'search', 'explore', 'hashtag', 'intent', 'share', 'login', 'signup', 'settings', 'about', 'tos',
  'privacy', 'help', 'messages', 'notifications', 'compose', 'tag', 'tags', 'tagged', 'explore', 'watch', 'videos',
  'my', 'posts', 'collections', 'discover', 'terms', 'legal', 'support', 'blog', 'dashboard', 'following', 'new',
  'trending', 'niches', 'creators', 'gifs', 'users', 'user', 'u', 'r', 'search', 'ads', 'web',
])

function okHandle(value: string | undefined): string | null {
  if (!value) return null
  const v = decodeURIComponent(value).replace(/^@/, '')
  return HANDLE.test(v) && !RESERVED.has(v.toLowerCase()) ? v : null
}

/** Map a public profile URL to (platform, handle). Returns null for non-profile URLs. */
export function parseCreatorProfileUrl(raw: string): ParsedProfileUrl | null {
  let url: URL
  try { url = new URL(raw) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile|old|new)\./, '')
  const parts = url.pathname.split('/').filter(Boolean)
  try {
    if (host === 'redgifs.com') {
      if (parts[0] !== 'users') return null
      const h = parts[1] && HANDLE.test(parts[1]) ? parts[1].toLowerCase() : null
      return h ? { platform: 'Redgifs', handle: h, profileUrl: `https://www.redgifs.com/users/${h}`, linkOnly: false } : null
    }
    if (host === 'x.com' || host === 'twitter.com') {
      const h = okHandle(parts[0])
      return h ? { platform: 'X', handle: h, profileUrl: `https://x.com/${h}`, linkOnly: false } : null
    }
    if (host === 'tumblr.com') {
      const h = okHandle(parts[0] === 'blog' ? parts[1] : parts[0])
      return h ? { platform: 'Tumblr', handle: h, profileUrl: `https://${h}.tumblr.com`, linkOnly: false } : null
    }
    if (host.endsWith('.tumblr.com')) {
      const sub = host.slice(0, -'.tumblr.com'.length)
      const h = sub.includes('.') ? null : okHandle(sub)
      return h ? { platform: 'Tumblr', handle: h, profileUrl: `https://${h}.tumblr.com`, linkOnly: false } : null
    }
    if (host === 'reddit.com') {
      if (parts[0] !== 'user' && parts[0] !== 'u') return null
      const h = okHandle(parts[1])
      return h ? { platform: 'Reddit', handle: h, profileUrl: `https://www.reddit.com/user/${h}`, linkOnly: false } : null
    }
    if (host === 'onlyfans.com') {
      const h = okHandle(parts[0])
      return h ? { platform: 'OnlyFans', handle: h, profileUrl: `https://onlyfans.com/${h}`, linkOnly: true } : null
    }
    if (host === 'fansly.com') {
      const h = okHandle(parts[0])
      return h ? { platform: 'Fansly', handle: h, profileUrl: `https://fansly.com/${h}`, linkOnly: true } : null
    }
    if (host === 'justfor.fans') {
      const h = okHandle(parts[0])
      return h ? { platform: 'JustFor.Fans', handle: h, profileUrl: `https://justfor.fans/${h}`, linkOnly: true } : null
    }
  } catch {
    return null
  }
  return null
}

const SITES = ['redgifs.com/users', 'x.com', 'twitter.com', 'tumblr.com', 'reddit.com/user', 'onlyfans.com', 'fansly.com', 'justfor.fans']

/** Web-search leads for a creator query, as link-only/metadata-only hits. */
export async function searchCreatorWebLeads(
  query: string,
  opts: { signal?: AbortSignal; limit?: number } = {},
): Promise<SourceCreatorHit[]> {
  try {
    const q = `${query} ${SITES.map((s) => `site:${s}`).join(' OR ')}`
    const links = await searchDuckDuckGoLinks(q, { signal: opts.signal, limit: 30 })
    const hits: SourceCreatorHit[] = []
    const seen = new Set<string>()
    for (const link of links) {
      const parsed = parseCreatorProfileUrl(link.url)
      if (!parsed) continue
      const key = `${parsed.platform}:${parsed.handle.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      hits.push({
        handle: parsed.handle,
        displayName: parsed.handle,
        platform: parsed.platform,
        profileUrl: parsed.profileUrl,
        followers: null,
        mediaCount: null,
        confidence: parsed.linkOnly ? 0.3 : 0.4,
        matchedBy: 'search',
        sourceAttribution: parsed.linkOnly ? 'DuckDuckGo lead (link only)' : 'DuckDuckGo lead',
      })
      if (hits.length >= (opts.limit ?? 10)) break
    }
    return hits
  } catch {
    return []
  }
}
