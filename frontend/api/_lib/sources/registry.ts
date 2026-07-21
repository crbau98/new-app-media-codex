/**
 * Source registry + connector SDK skeleton.
 *
 * Every connector must declare what it is allowed to do before it can enrich the
 * feed. This is the compliance seam: playable media, metadata-only leads, auth
 * requirements, cache policy, attribution, and terms are explicit — and blocked
 * sources stay blocked.
 */
export type SourceCapability =
  | 'playable'
  | 'metadataOnly'
  | 'requiresAuth'
  | 'rss'
  | 'jsonld'
  | 'oembed'
  | 'activitypub'
  | 'peertube'

export type SourceCachePolicy = 'cdn-public' | 'private-short' | 'no-store'

export type SourceRegistryEntry = {
  id: string
  name: string
  capabilities: SourceCapability[]
  rateLimit: string
  cachePolicy: SourceCachePolicy
  attributionFormat: string
  termsUrl: string
  complianceNote: string
  blocked?: boolean
}

const BLOCKED_NOTE = 'Blocked: leaked, subscription-only, paywall-mirror, DRM, or non-consensual sources are never imported.'

const REGISTRY: readonly SourceRegistryEntry[] = [
  {
    id: 'redgifs',
    name: 'Redgifs',
    capabilities: ['playable'],
    rateLimit: 'provider token + bounded pages; 6.5s request timeout',
    cachePolicy: 'cdn-public',
    attributionFormat: 'source page + creator profile links',
    termsUrl: 'https://www.redgifs.com/terms',
    complianceNote: 'Public provider API only; posters/streams may use the same-origin proxy fallback with source attribution.',
  },
  {
    id: 'x',
    name: 'X',
    capabilities: ['playable', 'metadataOnly', 'requiresAuth'],
    rateLimit: 'official API bearer token; watchlist-intent only',
    cachePolicy: 'private-short',
    attributionFormat: 'tweet URL + author URL',
    termsUrl: 'https://x.com/en/tos',
    complianceNote: 'Official API only; no scraping and no sensitive-attribute inference.',
  },
  {
    id: 'tumblr',
    name: 'Tumblr',
    capabilities: ['playable', 'metadataOnly', 'requiresAuth'],
    rateLimit: 'official API key; watchlist-intent only',
    cachePolicy: 'private-short',
    attributionFormat: 'post URL + blog URL',
    termsUrl: 'https://www.tumblr.com/policy',
    complianceNote: 'Official API only; media remains attributed to the source blog/post.',
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    capabilities: ['metadataOnly'],
    rateLimit: 'explicit search/radar intent only; 2.5s fast-discovery budget',
    cachePolicy: 'no-store',
    attributionFormat: 'outbound result link + host label',
    termsUrl: 'https://duckduckgo.com/privacy',
    complianceNote: 'Metadata-only public web/video search; never returns playable media and never rehosts assets.',
  },
  {
    id: 'rss',
    name: 'RSS/Atom/JSON Feed',
    capabilities: ['metadataOnly', 'rss'],
    rateLimit: 'user-supplied or curated feeds only; no crawling',
    cachePolicy: 'cdn-public',
    attributionFormat: 'feed title + item link + publisher',
    termsUrl: 'about:blank',
    complianceNote: 'Parse only explicitly supplied feeds; store metadata/provider URLs only.',
  },
  {
    id: 'subscription-mirrors',
    name: 'Subscription mirrors',
    capabilities: [],
    rateLimit: 'blocked',
    cachePolicy: 'no-store',
    attributionFormat: 'none',
    termsUrl: 'about:blank',
    complianceNote: BLOCKED_NOTE,
    blocked: true,
  },
]

export function listSources(): SourceRegistryEntry[] {
  return [...REGISTRY]
}

export function getSource(id: string): SourceRegistryEntry | null {
  const normalized = id.trim().toLowerCase()
  return REGISTRY.find((source) => source.id === normalized) || null
}

export function assertSourceAllowed(id: string): SourceRegistryEntry {
  const source = getSource(id)
  if (!source) throw new Error(`unknown_source:${id}`)
  if (source.blocked) throw new Error(`blocked_source:${id}`)
  return source
}
