/**
 * Shared domain types for Media Codex.
 *
 * The media/creator shapes mirror what the Vercel edge function
 * (`frontend/api/live-media.ts`) returns. Optional fields are defensive:
 * sources degrade independently, so any of them may be absent.
 */

export interface MediaItem {
  id: string
  title: string
  thumbnail: string
  source: string
  duration: string
  isVideo: boolean
  category: string
  creator: string
  tags: string[]
  rating: number
  createdAt: string
  views: number
  mediaUrl?: string
  /** Ordered playback fallbacks supplied by the public provider adapter. */
  streamCandidates?: string[]
  pageUrl?: string
  description?: string
  likes?: number
  comments?: number
  isLiked?: boolean
  isNew?: boolean
  isTrending?: boolean
  /** Explainable 0–100 ordering signal based on public engagement and freshness. */
  curationScore?: number
  /** Short, source-derived explanation for why the item is surfaced. */
  curationReasons?: string[]
  /** On-device recommendation score derived from the user's local feedback. */
  personalizedScore?: number
  /** Human-readable explanation of the recommendation. */
  recommendationReasons?: string[]
}

export interface CreatorProfileLink {
  label: string
  url: string
}

export interface Creator {
  id: string
  name: string
  avatar: string
  /** Real follower count when the provider exposes it; null/absent otherwise. Never a fake 0. */
  followers?: number | null
  username?: string
  platform?: string
  platforms?: string[]
  profileUrl?: string
  /** All known profile/post links with source attribution. */
  profileLinks?: CreatorProfileLink[]
  mediaCount?: number
  viewCount?: number
  likeCount?: number
  curationScore?: number
  sourceAttribution?: string
  observedAt?: string
  isWatched?: boolean
  isSimilar?: boolean
  similarityScore?: number
  similarityMethod?: 'ai' | 'metadata' | 'none'
  discoveryReasons?: string[]
  autoAdded?: boolean
  discoveryConfidence?: number
  discoveryTags?: string[]
  /** Human-readable match evidence, e.g. "Shares #tag with your radar", "Trending on Redgifs (top 8% views)". */
  matchReasons?: string[]
  /** Number of media items supporting this directory entry. */
  evidenceCount?: number
  /** ISO timestamp of the newest item observed for this creator. */
  lastSeenAt?: string | null
  /** True ONLY when aiDiscovery.state === 'ok'. */
  aiSuggested?: boolean
  /** Model-provided reason (max ~140 chars). */
  aiReason?: string
  media?: MediaItem[]
}

export interface CategoryDef {
  id: string
  name: string
  count: number
}

/* ───────────────────────────────────────────────
   /api/live-media payload (shared edge contract)
   ────────────────────────────────────────────── */

export type SourceState = 'connected' | 'not-configured' | 'limited' | 'error'

export interface SourceStatus {
  id: 'redgifs' | 'x' | 'tumblr' | 'google' | 'duckduckgo' | string
  state: SourceState | (string & {})
  /** Short diagnostic detail for operators and backward-compatible payloads. */
  detail?: string
  items?: number
  leads?: number
  /** Legacy fields tolerated from earlier payload revisions. */
  name?: string
  mode?: string
  mediaFound?: number
  creatorsFound?: number
  searchUrl?: string
}

export type AiDiscoveryState = 'ok' | 'fallback' | 'not-requested'

export interface AiDiscovery {
  /** Resolved model id actually used. */
  model: string
  state: AiDiscoveryState
  /** Human-readable reason when fallback/not-requested. */
  detail: string
  cacheState?: 'hit' | 'miss'
  /** Contract guarantee: suggestions are explainable metadata-only. */
  explainable?: true
  /** Count of AI-suggested creators (the names ride on performer entries). */
  suggestedCreators: number
  /** Count of auto-added radar entries. */
  autoAddedCreators: number
  /** Contract guarantee: no appearance/sensitive-trait inference. */
  sensitiveAttributeInference?: false
}

export interface DuckDuckGoLead {
  title: string
  url: string
  snippet?: string
  kind: 'profile' | 'post' | 'video'
  creatorKey?: string
}

export interface DuckDuckGoSection {
  state: 'connected' | 'limited' | 'error'
  detail: string
  leads: DuckDuckGoLead[]
  /** DDG search handoff link (always present). */
  searchUrl: string
}

export interface LiveDiscoveryPayload {
  items: MediaItem[]
  performers: Creator[]
  updatedAt: string
  counts: {
    received: number
    eligible: number
    playable: number
    pagesScanned: number
    providerRequestsSucceeded?: number
    providerRequestsAttempted?: number
    sourcesConnected?: number
    creatorsDiscovered?: number
  }
  watchlist: {
    requested: string[]
    matched: string[]
  }
  aiDiscovery: AiDiscovery
  sources: SourceStatus[]
  ddg?: DuckDuckGoSection
}
