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
    result = result.filter((m) => m.category === filters.category)
  }
  if (filters.sourceType) {
    result = result.filter((m) => m.source === filters.sourceType)
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
  const offset = (page - 1) * perPage
  const sort = filters.sort ?? 'newest'

  // Build query params
  const params = new URLSearchParams()
  params.set('offset', String(offset))
  params.set('limit', String(perPage))
  if (filters.category) params.set('term', filters.category)
  if (filters.sourceType) params.set('source', filters.sourceType)
  params.set('sort', sort)

  try {
    const payload = await getJson<BrowseScreenshotsPayload>(
      `/api/screenshots?${params.toString()}`
    )

    const items = payload.screenshots.map(adaptScreenshot)
    return {
      items,
      page,
      perPage,
      total: payload.total,
      hasMore: payload.has_more,
    }
  } catch (err) {
    warnFallback(err, 'fetchMedia')
    // Fallback to mock data with client-side filtering/sorting
    const filtered = applyClientFilters(mediaItems, filters)
    const sorted = applyClientSort(filtered, sort)
    return buildPaginatedResult(sorted, page, perPage)
  }
}

export async function fetchCategories(): Promise<CategoryDef[]> {
  try {
    const payload = await getJson<{ terms: Array<{ term: string; count: number }> }>(
      '/api/screenshots/terms'
    )
    return payload.terms.map(adaptScreenshotTerm)
  } catch (err) {
    warnFallback(err, 'fetchCategories')
    return [...categories]
  }
}

export async function fetchTrending(): Promise<MediaItem[]> {
  try {
    const payload = await getJson<BrowseScreenshotsPayload>(
      '/api/screenshots?sort=views&limit=8'
    )
    return payload.screenshots.map(adaptScreenshot)
  } catch (err) {
    warnFallback(err, 'fetchTrending')
    return mediaItems
      .filter((m) => m.isTrending)
      .sort(() => Math.random() - 0.5)
      .slice(0, 8)
  }
}

export async function searchMedia(
  query: string,
  filters: MediaFilters = {}
): Promise<PaginatedResult<MediaItem>> {
  try {
    // Primary: dedicated screenshots search endpoint
    const screenshots = await getJson<BackendScreenshot[]>(
      `/api/screenshots/search?q=${encodeURIComponent(query)}&limit=24`
    )

    // If backend returns results, adapt them
    if (Array.isArray(screenshots) && screenshots.length > 0) {
      const items = screenshots.map(adaptScreenshot)
      return {
        items,
        page: 1,
        perPage: 24,
        total: items.length,
        hasMore: false,
      }
    }

    // Empty array from backend = no results, return empty (valid, not fallback)
    if (Array.isArray(screenshots)) {
      return { items: [], page: 1, perPage: 24, total: 0, hasMore: false }
    }
  } catch (err) {
    warnFallback(err, 'searchMedia (screenshots/search)')
  }

  // Fallback: client-side mock search
  const filtered = applyClientFilters(mediaItems, { ...filters, search: query })
  const sorted = applyClientSort(filtered, filters.sort)
  return buildPaginatedResult(sorted, 1, 24)
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
    const payload = await getJson<BrowsePerformersPayload>(
      '/api/performers?limit=50'
    )
    return payload.performers.map(adaptPerformer)
  } catch (err) {
    warnFallback(err, 'fetchCreators')
    return [...creators]
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
