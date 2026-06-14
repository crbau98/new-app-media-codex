/**
 * API Adapter layer: transforms backend DTOs into frontend-friendly types.
 *
 * The frontend types (MediaItem, Creator, CategoryDef) live in mockData.ts
 * and MUST NOT be changed — components depend on them.
 */

import type { MediaItem, Creator, CategoryDef } from './mockData'
import { resolvePublicUrl } from './backendOrigin'

/* ───────────────────────────────────────────────
   Backend types (mirrored from FastAPI schema)
   ────────────────────────────────────────────── */

export interface BackendScreenshot {
  id: number
  term: string
  source: string
  page_url: string
  local_path: string
  local_url: string | null
  preview_url?: string | null
  source_url?: string | null
  thumbnail_url?: string | null
  captured_at: string
  ai_summary?: string | null
  ai_tags?: string | null
  rating?: number
  user_tags?: string | null
  performer_id?: number | null
  performer_username?: string | null
  likes_count?: number
  views_count?: number
  comments_count?: number
  is_liked?: boolean
}

export interface BackendScreenshotTerm {
  term: string
  count: number
}

export interface BackendPerformer {
  id: number
  username: string
  display_name: string | null
  platform: string
  profile_url: string | null
  avatar_url: string | null
  avatar_local: string | null
  bio: string | null
  tags: string | null
  follower_count: number | null
  media_count: number | null
  is_verified: number
  is_favorite: number
  status: string
  notes: string | null
  first_seen_at: string
  screenshots_count?: number
  followers_count?: number
}

export interface BrowseScreenshotsPayload {
  screenshots: BackendScreenshot[]
  total: number
  offset: number
  limit: number
  has_more: boolean
}

export interface BrowsePerformersPayload {
  performers: BackendPerformer[]
  total: number
  has_more: boolean
}

export interface MediaStatsPayload {
  total: number
  by_source: Record<string, number>
  by_type: Record<string, number>
  rated: number
  described: number
  with_performer: number
  avg_rating: number
  storage_mb: number
  recent_24h: number
  recent_7d: number
  favorites_count: number
}

export interface PerformerStats {
  total: number
  verified: number
  with_media: number
  active_24h: number
  active_7d: number
}

export interface PerformerAnalytics {
  top_performers: Array<{
    id: number
    username: string
    display_name: string | null
    media_count: number
    views_total: number
  }>
  platform_breakdown: Record<string, number>
  recent_added: Array<{
    id: number
    username: string
    first_seen_at: string
  }>
}

export interface TrendsPayload {
  dates: string[]
  screenshots: number[]
  performers: number[]
  views: number[]
}

export interface InsightsPayload {
  top_terms: Array<{ term: string; count: number }>
  growth_rate: number
  avg_daily_captures: number
  sources_health: Record<string, number>
}

export interface SourceHealthPayload {
  sources: Array<{
    name: string
    status: 'healthy' | 'degraded' | 'down'
    last_crawl: string | null
    success_rate: number
    avg_response_ms: number
  }>
}

export interface UnifiedSearchResult {
  type: 'media' | 'performer' | 'category'
  id: number | string
  title: string
  thumbnail?: string | null
  subtitle?: string
  meta?: Record<string, unknown>
}

export interface DashboardPayload {
  total_media: number
  total_performers: number
  total_categories: number
  recent_media: BackendScreenshot[]
  top_performers: BackendPerformer[]
  trends: TrendsPayload
}

/* ───────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────── */

const VALID_SOURCES = new Set(['Tube', 'Redgifs', 'Imgur', 'Local', 'Xtube'])

function normalizeSource(src: string): MediaItem['source'] {
  if (VALID_SOURCES.has(src)) return src as MediaItem['source']
  // Try common aliases
  const lower = src.toLowerCase()
  if (lower.includes('tube')) return 'Tube'
  if (lower.includes('redgifs')) return 'Redgifs'
  if (lower.includes('imgur')) return 'Imgur'
  if (lower.includes('local')) return 'Local'
  if (lower.includes('xtube')) return 'Xtube'
  return 'Local'
}

function parseTags(tagField: string | null | undefined): string[] {
  if (!tagField) return []
  try {
    const parsed = JSON.parse(tagField)
    if (Array.isArray(parsed)) return parsed.filter((t) => typeof t === 'string')
  } catch {
    // not JSON — treat as comma-separated
  }
  return tagField
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function generateDuration(sourceUrl: string | null | undefined, source: string): string {
  const isVideoLike =
    !!sourceUrl &&
    /\.(mp4|webm|mov|mkv|avi|m4v|gifv)(\?|$)/i.test(sourceUrl)
  if (!isVideoLike && source !== 'Redgifs' && source !== 'Tube' && source !== 'Xtube') {
    return ''
  }
  const mins = Math.floor(Math.random() * 15) + 1
  const secs = Math.floor(Math.random() * 59)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function isNewlyCaptured(capturedAt: string): boolean {
  const then = new Date(capturedAt).getTime()
  const now = Date.now()
  return now - then < 24 * 60 * 60 * 1000
}

function capitalizeFirst(str: string): string {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/* ───────────────────────────────────────────────
   Adapters
   ────────────────────────────────────────────── */

export function adaptScreenshot(s: BackendScreenshot): MediaItem {
  const thumbnail =
    resolvePublicUrl(s.thumbnail_url) ||
    resolvePublicUrl(s.local_url) ||
    resolvePublicUrl(s.preview_url) ||
    '/placeholder.jpg'

  const source = normalizeSource(s.source)
  const creator = s.performer_username || 'Unknown'
  const tags = parseTags(s.ai_tags || s.user_tags)
  const duration = generateDuration(s.source_url, source)

  return {
    id: String(s.id),
    title: capitalizeFirst(s.term),
    thumbnail,
    source,
    duration,
    isVideo: duration !== '',
    category: s.term,
    creator,
    tags,
    rating: s.rating ?? 0,
    createdAt: s.captured_at,
    views: s.views_count ?? 0,
    isNew: isNewlyCaptured(s.captured_at),
    isTrending: (s.views_count ?? 0) > 100,
  }
}

export function adaptPerformer(p: BackendPerformer): Creator {
  const avatar =
    resolvePublicUrl(p.avatar_url) ||
    resolvePublicUrl(p.avatar_local) ||
    '/placeholder-avatar.jpg'

  return {
    id: String(p.id),
    name: p.display_name || p.username,
    avatar,
    followers: p.follower_count ?? p.followers_count ?? 0,
    hasStory: (p.media_count ?? 0) > 0,
    storySeen: false,
  }
}

export function adaptScreenshotTerm(t: BackendScreenshotTerm): CategoryDef {
  return {
    id: t.term.toLowerCase().replace(/\s+/g, '-'),
    name: t.term,
    count: t.count,
  }
}
