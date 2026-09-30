/**
 * Source registry + connector SDK skeleton.
 *
 * Every connector must declare what it is allowed to do before it can enrich the
 * feed. This is the compliance seam: playable media, metadata-only leads, auth
 * requirements, cache policy, attribution, and terms are explicit.
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
  | 'linkOnly'

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
}

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
    id: 'peertube',
    name: 'PeerTube',
    capabilities: ['metadataOnly', 'peertube'],
    rateLimit: 'public sepiasearch index; bounded queries; 4s optional budget',
    cachePolicy: 'no-store',
    attributionFormat: 'video URL + account URL + origin instance host',
    termsUrl: 'https://joinpeertube.org/',
    complianceNote: 'Public federated index only; items link back to the origin instance, media is never rehosted, and playback stays on the source.',
  },
  {
    id: 'peertube-creators',
    name: 'PeerTube creator search',
    capabilities: ['metadataOnly', 'peertube'],
    rateLimit: 'GET /api/v1/search/video-channels (+ /api/v1/accounts/{name@host} for handles); nsfw=both; 4s per instance, 3 in parallel; part of the 7s creator-search budget',
    cachePolicy: 'no-store',
    attributionFormat: 'channel/account URL + origin instance host',
    termsUrl: 'https://joinpeertube.org/',
    complianceNote: 'Public unauthenticated channel/account search on sepiasearch.org and a documented instance list; returns public counts and the instance avatar URL only; nothing is rehosted.',
  },
  {
    id: 'activitypub',
    name: 'ActivityPub / Mastodon accounts',
    capabilities: ['metadataOnly', 'activitypub'],
    rateLimit: 'WebFinger + /api/v1/accounts/lookup for @user@host queries; GET /api/v2/search?type=accounts on a short instance list; 4s per request, 3 in parallel',
    cachePolicy: 'no-store',
    attributionFormat: 'account URL + home instance host',
    termsUrl: 'https://docs.joinmastodon.org/',
    complianceNote: 'Unauthenticated public APIs only (instances requiring auth are skipped); locked, suspended and non-discoverable accounts are never returned; no follower lists or other PII.',
  },
  {
    id: 'creator-web-leads',
    name: 'Creator web leads',
    capabilities: ['metadataOnly', 'linkOnly'],
    rateLimit: 'one DuckDuckGo HTML query per creator search; 4s timeout; results cached 10 min',
    cachePolicy: 'no-store',
    attributionFormat: 'DuckDuckGo lead (+ "link only" for subscription platforms)',
    termsUrl: 'https://duckduckgo.com/privacy',
    complianceNote: 'Only public profile URLs are parsed to (platform, handle). OnlyFans/Fansly/JustFor.Fans leads are link-only: never fetched, ingested or rehosted. Lower confidence than first-party API hits.',
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
  return source
}
