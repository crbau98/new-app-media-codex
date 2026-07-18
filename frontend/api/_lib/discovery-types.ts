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
}

export type SourceStatus = {
  id: 'redgifs' | 'x' | 'tumblr' | 'google' | 'duckduckgo' | 'serpapi-google-images' | 'serpapi-duckduckgo' | 'firecrawl' | 'subscription-mirrors'
  name: string
  mode: 'stream' | 'discovery' | 'blocked'
  state: 'connected' | 'not-configured' | 'limited' | 'error' | 'blocked'
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
