export type UnifiedMediaItem = {
  id: string
  title: string
  thumbnail?: string
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
  streamCandidates: string[]
  pageUrl: string
  profileUrl?: string
  description?: string
  likes: number
  comments: number
  isLiked: false
  isNew: boolean
  isTrending: boolean
  curationScore: number
  curationReasons: string[]
  isWatchedCreator: boolean
  /* media-intelligence contract (optional; only when knowable) */
  width?: number
  height?: number
  aspect?: number
  durationSeconds?: number
  posterUrl?: string
  hlsUrl?: string
  mimeType?: string
  codec?: string
  hasAudio?: boolean
  dominantColor?: string
  lqip?: string
}

export type CreatorLead = {
  id: string
  name: string
  username: string
  platform: string
  profileUrl: string
  avatar?: string
  tags: string[]
  observedAt: string
  sourceAttribution: string
  confidence: number
  exactWatchMatch: boolean
  /** Public follower count when the provider reports one (X public_metrics); optional. */
  followers?: number
  /** Public profile bio with emails/phone numbers already redacted; optional. */
  description?: string
}

export type SourceStatus = {
  id: 'redgifs' | 'x' | 'tumblr' | 'google' | 'duckduckgo' | 'peertube' | 'bluesky' | 'mastodon' | 'lemmy' | 'reddit'
  name: string
  mode: 'stream' | 'discovery'
  state: 'connected' | 'not-configured' | 'limited' | 'error'
  mediaFound: number
  creatorsFound: number
  detail: string
  searchUrl?: string
}

export type DuckDuckGoLead = {
  title: string
  url: string
  snippet?: string
  kind: 'profile' | 'post' | 'video'
  creatorKey?: string
}

export type DuckDuckGoSection = {
  state: 'connected' | 'limited' | 'error'
  detail: string
  leads: DuckDuckGoLead[]
  searchUrl: string
}

export type MultiSourceResult = {
  media: UnifiedMediaItem[]
  leads: CreatorLead[]
  statuses: SourceStatus[]
  duckduckgo: DuckDuckGoSection
  requestsAttempted: number
  requestsSucceeded: number
}

/** A creator/channel/account found by searching a public source by name or handle. */
export type SourceCreatorHit = {
  /** Provider-native handle used to address the creator on `platform` (e.g. Redgifs username). */
  handle: string
  displayName: string
  platform: string
  profileUrl: string
  avatar?: string
  followers?: number | null
  mediaCount?: number | null
  /** 0..1 — how sure we are this is the creator that was searched for. */
  confidence: number
  matchedBy: 'exact' | 'variant' | 'alias' | 'search'
  sourceAttribution: string
}
