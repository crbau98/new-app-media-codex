/**
 * Hybrid API layer.
 *
 * Every function:
 *  1. Tries the real FastAPI backend.
 *  2. Transforms backend DTOs to frontend types.
 *  3. On failure (network, timeout, 5xx) logs a warning and falls back to mock data.
 *
 * This keeps the UI functional even when the backend is unreachable.
 */

import { apiUrl, FETCH_TIMEOUT_MS } from './backendOrigin'
import {
  adaptScreenshot,
  adaptPerformer,
  adaptScreenshotTerm,
  type BrowseScreenshotsPayload,
  type BrowsePerformersPayload,
  type MediaStatsPayload,
  type TrendsPayload,
  type InsightsPayload,
  type SourceHealthPayload,
  type PerformerAnalytics,
  type DashboardPayload,
  type BackendScreenshot,
  type BackendPerformer,
} from './api-adapter'

import {
  mediaItems,
  categories,
  creators,
  type MediaItem,
  type CategoryDef,
  type Creator,
} from './mockData'

/* ───────────────────────────────────────────────
   Types
   ────────────────────────────────────────────── */

export interface MediaFilters {
  category?: string | null
  sourceType?: string | null
  sort?: 'newest' | 'oldest' | 'topRated' | 'az' | 'random' | 'mostViewed'
  tag?: string | null
  search?: string
  creator?: string | null
  minViews?: number
  minLikes?: number
  watchlist?: string[]
}

export interface PaginatedResult<T> {
  items: T[]
  page: number
  perPage: number
  total: number
  hasMore: boolean
}

/* ───────────────────────────────────────────────
   Low-level fetch helper with timeout
   ────────────────────────────────────────────── */

async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    return res
  } finally {
    clearTimeout(id)
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetchWithTimeout(apiUrl(path))
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

async function putJson(path: string, body: unknown): Promise<void> {
  const res = await fetchWithTimeout(apiUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }
}

function warnFallback(error: unknown, label: string): void {
  console.warn('[API Fallback]', label, error)
}

async function fetchLiveMediaFallback(
  filters: MediaFilters,
  page: number,
  perPage: number
): Promise<PaginatedResult<MediaItem>> {
  const params = new URLSearchParams({ count: '100', pages: '3' })
  if (filters.search) params.set('q', filters.search)
  else if (filters.creator) params.set('creator', filters.creator)
  else if (filters.category) params.set('q', filters.category)
  if (filters.minViews) params.set('minViews', String(filters.minViews))
  if (filters.minLikes) params.set('minLikes', String(filters.minLikes))
  for (const creator of (filters.watchlist || []).slice(0, 8)) params.append('watch', creator)
  if (filters.sort === 'mostViewed') params.set('sort', 'views')
  else if (filters.sort === 'newest') params.set('sort', 'newest')
  else if (filters.sort === 'topRated') params.set('sort', 'likes')
  const response = await fetchWithTimeout(`/api/live-media?${params.toString()}`, undefined, 20000)
  if (!response.ok) throw new Error(`Live media fallback returned ${response.status}`)
  const payload = await response.json() as { items?: MediaItem[] }
  // Query terms were applied upstream. Category remains a tag-level client
  // filter because one item may belong to several source tags.
  const filtered = applyClientFilters(payload.items || [], { ...filters, search: undefined, creator: null })
  const sorted = applyClientSort(filtered, filters.sort || 'newest')
  return buildPaginatedResult(sorted, page, perPage)
}

export async function fetchLiveCreatorDirectory(watchlist: string[] = []): Promise<Creator[]> {
  const params = new URLSearchParams({ count: '100', pages: '3', sort: 'smart' })
  for (const creator of watchlist.slice(0, 8)) params.append('watch', creator)
  const response = await fetchWithTimeout(`/api/live-media?${params.toString()}`, undefined, 25000)
  if (!response.ok) throw new Error(`Live creator directory returned ${response.status}`)
  const payload = await response.json() as { performers?: Creator[] }
  return Array.isArray(payload.performers) ? payload.performers : []
}

/* ───────────────────────────────────────────────
   Sort helpers for client-side fallback
   ────────────────────────────────────────────── */

function applyClientSort(
  items: MediaItem[],
  sort: MediaFilters['sort']
): MediaItem[] {
  const copy = [...items]
  switch (sort) {
    case 'oldest':
      copy.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
      break
    case 'topRated':
      copy.sort((a, b) => b.rating - a.rating)
      break
    case 'az':
      copy.sort((a, b) => a.title.localeCompare(b.title))
      break
    case 'random':
      copy.sort(() => Math.random() - 0.5)
      break
    case 'mostViewed':
      copy.sort((a, b) => b.views - a.views)
      break
    case 'newest':
    default:
      copy.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      break
  }
  return copy
}

function applyClientFilters(
  items: MediaItem[],
  filters: MediaFilters
): MediaItem[] {
  let result = [...items]
  if (filters.category) {
    result = result.filter((m) => m.category === filters.category || m.tags.includes(filters.category!))
  }
  if (filters.sourceType) {
    if (filters.sourceType === 'video') result = result.filter((m) => m.isVideo)
    else if (filters.sourceType === 'image') result = result.filter((m) => !m.isVideo)
    else if (filters.sourceType === 'favorites') result = result.filter((m) => m.isLiked)
    else result = result.filter((m) => m.source.toLowerCase() === filters.sourceType!.toLowerCase())
  }
  if (filters.tag) {
    result = result.filter((m) => m.tags.includes(filters.tag!))
  }
  if (filters.search) {
    const q = filters.search.toLowerCase()
    result = result.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.creator.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
    )
  }
  if (filters.creator) {
    result = result.filter((m) => m.creator.toLowerCase() === filters.creator!.toLowerCase())
  }
  if (filters.minViews) result = result.filter((m) => m.views >= filters.minViews!)
  if (filters.minLikes) result = result.filter((m) => (m.likes || 0) >= filters.minLikes!)
  return result
}

function buildPaginatedResult<T>(
  all: T[],
  page: number,
  perPage: number
): PaginatedResult<T> {
  const start = (page - 1) * perPage
  const end = start + perPage
  return {
    items: all.slice(start, end),
    page,
    perPage,
    total: all.length,
    hasMore: end < all.length,
  }
}

/* ───────────────────────────────────────────────
   API: Media (Screenshots)
   ────────────────────────────────────────────── */

export async function fetchMedia(
  filters: MediaFilters = {},
  page = 1,
  perPage = 12
): Promise<PaginatedResult<MediaItem>> {
  try {
    // The browse experience intentionally begins with the source-attributed
    // public feed. Private archive rows are not a substitute for creator
    // permission or provenance.
    return await fetchLiveMediaFallback(filters, page, perPage)
  } catch (liveError) {
    warnFallback(liveError, 'fetchLiveMedia')
    throw liveError
  }
}

export async function fetchCategories(): Promise<CategoryDef[]> {
  try {
    const response = await fetchWithTimeout('/api/live-media?count=100&pages=3&sort=smart', undefined, 20000)
    if (!response.ok) throw new Error(`Live categories returned ${response.status}`)
    const payload = await response.json() as { items?: MediaItem[] }
    const counts = new Map<string, number>()
    for (const item of payload.items || []) {
      for (const tag of item.tags.slice(0, 5)) {
        const normalized = tag.trim()
        if (normalized) counts.set(normalized, (counts.get(normalized) || 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([name, count]) => ({ id: name.toLowerCase().replace(/\s+/g, '-'), name, count }))
  } catch (err) {
    warnFallback(err, 'fetchLiveCategories')
    return []
  }
}

export async function fetchTrending(): Promise<MediaItem[]> {
  try {
    const result = await fetchLiveMediaFallback({ sort: 'mostViewed' }, 1, 8)
    return result.items
  } catch (err) {
    warnFallback(err, 'fetchTrending')
    return []
  }
}

export async function searchMedia(
  query: string,
  filters: MediaFilters = {}
): Promise<PaginatedResult<MediaItem>> {
  try {
    return await fetchLiveMediaFallback({ ...filters, search: query }, 1, 24)
  } catch (liveError) {
    warnFallback(liveError, 'searchMedia live fallback')
    return buildPaginatedResult([], 1, 24)
  }
}

export async function fetchMediaById(id: string): Promise<MediaItem | null> {
  try {
    const screenshot = await getJson<BackendScreenshot>(`/api/screenshots/${id}`)
    return adaptScreenshot(screenshot)
  } catch (err) {
    warnFallback(err, `fetchMediaById(${id})`)
    return mediaItems.find((m) => m.id === id) ?? null
  }
}

/* ───────────────────────────────────────────────
   API: Creators (Performers)
   ────────────────────────────────────────────── */

export async function fetchCreators(): Promise<Creator[]> {
  try {
    return await fetchLiveCreatorDirectory()
  } catch (err) {
    warnFallback(err, 'fetchLiveCreatorDirectory')
    return []
  }
}

export async function fetchCreatorById(id: string): Promise<Creator | null> {
  try {
    const performer = await getJson<BackendPerformer>(`/api/performers/${id}`)
    return adaptPerformer(performer)
  } catch (err) {
    warnFallback(err, `fetchCreatorById(${id})`)
    return creators.find((c) => c.id === id) ?? null
  }
}

export async function fetchCreatorMedia(
  id: string
): Promise<PaginatedResult<MediaItem>> {
  try {
    const payload = await getJson<BrowseScreenshotsPayload>(
      `/api/performers/${id}/media?limit=24`
    )
    return {
      items: payload.screenshots.map(adaptScreenshot),
      page: 1,
      perPage: 24,
      total: payload.total,
      hasMore: payload.has_more,
    }
  } catch (err) {
    warnFallback(err, `fetchCreatorMedia(${id})`)
    const filtered = mediaItems.filter(
      (m) => m.creator === creators.find((c) => c.id === id)?.name
    )
    return buildPaginatedResult(filtered, 1, 24)
  }
}

/* ───────────────────────────────────────────────
   API: Stats / Analytics
   ────────────────────────────────────────────── */

export async function fetchMediaStats(): Promise<MediaStatsPayload> {
  try {
    return await getJson<MediaStatsPayload>('/api/screenshots/media-stats')
  } catch (err) {
    warnFallback(err, 'fetchMediaStats')
    // Compute mock stats
    const bySource: Record<string, number> = {}
    const byType: Record<string, number> = { video: 0, image: 0 }
    let rated = 0
    let withPerformer = 0
    let totalRating = 0

    for (const m of mediaItems) {
      bySource[m.source] = (bySource[m.source] || 0) + 1
      byType[m.isVideo ? 'video' : 'image']++
      if (m.rating > 0) {
        rated++
        totalRating += m.rating
      }
      if (m.creator && m.creator !== 'Unknown') withPerformer++
    }

    return {
      total: mediaItems.length,
      by_source: bySource,
      by_type: byType,
      rated,
      described: Math.floor(mediaItems.length * 0.6),
      with_performer: withPerformer,
      avg_rating: +(totalRating / (rated || 1)).toFixed(2),
      storage_mb: Math.floor(mediaItems.length * 2.5),
      recent_24h: Math.floor(mediaItems.length * 0.1),
      recent_7d: Math.floor(mediaItems.length * 0.3),
      favorites_count: Math.floor(mediaItems.length * 0.42),
    }
  }
}

export interface CombinedAnalytics {
  insights: InsightsPayload | null
  trends: TrendsPayload | null
  performers: PerformerAnalytics | null
  sourceHealth: SourceHealthPayload | null
}

export async function fetchAnalytics(): Promise<CombinedAnalytics> {
  // Fire independent requests concurrently
  const [insights, trends, performers, sourceHealth] = await Promise.allSettled([
    getJson<InsightsPayload>('/api/stats/insights'),
    getJson<TrendsPayload>('/api/stats/trends?days=30'),
    getJson<PerformerAnalytics>('/api/performers/analytics'),
    getJson<SourceHealthPayload>('/api/stats/source-health'),
  ])

  const result: CombinedAnalytics = {
    insights: insights.status === 'fulfilled' ? insights.value : null,
    trends: trends.status === 'fulfilled' ? trends.value : null,
    performers: performers.status === 'fulfilled' ? performers.value : null,
    sourceHealth: sourceHealth.status === 'fulfilled' ? sourceHealth.value : null,
  }

  // If ALL failed, log a single fallback warning
  if (
    insights.status === 'rejected' &&
    trends.status === 'rejected' &&
    performers.status === 'rejected'
  ) {
    warnFallback(insights.reason, 'fetchAnalytics (all endpoints failed)')
  }

  return result
}

/* ───────────────────────────────────────────────
   API: Dashboard
   ────────────────────────────────────────────── */

export async function fetchDashboard(): Promise<DashboardPayload | null> {
  try {
    return await getJson<DashboardPayload>('/api/dashboard')
  } catch (err) {
    warnFallback(err, 'fetchDashboard')
    return null
  }
}

/* ───────────────────────────────────────────────
   API: Settings
   ────────────────────────────────────────────── */

export async function fetchSettings(): Promise<Record<string, unknown>> {
  try {
    return await getJson<Record<string, unknown>>('/api/settings')
  } catch (err) {
    warnFallback(err, 'fetchSettings')
    return {
      theme: 'dark',
      accentColor: 'rose',
      autoplayVideos: true,
      muteOnStart: false,
      defaultQuality: 'auto',
      preferredPlayer: 'lightbox',
      notificationsEnabled: true,
    }
  }
}

export async function updateSettings(
  settings: Record<string, unknown>
): Promise<void> {
  try {
    await putJson('/api/settings', settings)
  } catch (err) {
    warnFallback(err, 'updateSettings')
    // No persistent mock for settings — just swallow error
    throw err
  }
}
