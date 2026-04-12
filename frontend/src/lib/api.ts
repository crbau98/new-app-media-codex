import { getBackendOrigin } from "./backendOrigin"

// Empty = same-origin. Set VITE_BACKEND_ORIGIN when the UI is hosted separately (e.g. Vercel).
const BASE = getBackendOrigin()
const API_TIMEOUT_MS = 20_000

export type ApiError = Error & {
  status?: number
  retryable?: boolean
}

function buildQuery(params?: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams(
    Object.entries(params ?? {})
      .filter(([, value]) => value !== "" && value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  ).toString()

  return search ? `?${search}` : ""
}

function mergeAbortSignals(source: AbortSignal | null | undefined, fallback: AbortController): AbortSignal {
  if (!source) return fallback.signal
  if (source.aborted) {
    fallback.abort()
    return fallback.signal
  }
  source.addEventListener("abort", () => fallback.abort(), { once: true })
  return fallback.signal
}

async function readErrorMessage(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    try {
      const payload = await res.json() as { detail?: unknown; message?: unknown }
      if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail
      if (typeof payload.message === "string" && payload.message.trim()) return payload.message
    } catch {
      // Fall through to status text.
    }
  } else {
    try {
      const text = (await res.text()).trim()
      if (text) return text
    } catch {
      // Fall through to status text.
    }
  }
  return res.statusText || "Request failed"
}

function createApiError(status: number, message: string): ApiError {
  const error = new Error(`${status} ${message}`) as ApiError
  error.status = status
  error.retryable = status === 408 || status === 429 || status >= 500
  return error
}

async function fetchWithTimeout(path: string, init?: RequestInit, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const signal = mergeAbortSignals(init?.signal, controller)
  let timedOut = false
  const timeoutHandle = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    return await fetch(`${BASE}${path}`, {
      ...init,
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (timedOut) {
        const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`) as ApiError
        timeoutError.retryable = true
        throw timeoutError
      }
      throw error
    }
    throw error
  } finally {
    window.clearTimeout(timeoutHandle)
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithTimeout(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const message = await readErrorMessage(res)
    throw createApiError(res.status, message)
  }
  if (res.status === 204) {
    return undefined as T
  }
  return res.json() as Promise<T>
}

async function fetchCaptureStatus(): Promise<{ status: string }> {
  const res = await fetchWithTimeout("/api/screenshots/capture", {
    method: "POST",
    headers: { Accept: "application/json" },
  })

  if (res.status === 409) {
    return { status: "already_running" }
  }
  if (!res.ok) {
    const message = await readErrorMessage(res)
    throw createApiError(res.status, message)
  }
  return res.json() as Promise<{ status: string }>
}

// Types
export interface ResearchItem { id: number; title: string; url: string; summary: string; content: string; author: string; published_at: string | null; domain: string; image_url: string; source_type: string; theme: string; query: string; score: number; review_status: string; is_saved: boolean; user_note: string; compounds: string[]; mechanisms: string[]; first_seen_at: string; last_seen_at: string; queued_at: string | null }
export interface ImageRecord { id: number; source_type: string; theme: string; title: string; image_url: string; page_url: string; thumb_url: string; local_url: string; local_path: string; original_path: string; created_at: string }
export interface Hypothesis { id: number; run_id: number; theme: string; title: string; rationale: string; evidence: string; body?: string; novelty_score: number; safety_flags: string; review_status: string; is_saved: boolean; user_note: string; created_at: string }
export interface Run { id: number; status: string; started_at: string; finished_at: string | null; notes: Record<string, unknown> }
export interface Stats {
  totals: {
    item_count: number
    image_count: number
    hypothesis_count: number
    run_count: number
    saved_item_count: number
    saved_hypothesis_count: number
  }
  themes: { theme: string; count: number }[]
  top_compounds: { name: string; count: number }[]
  top_mechanisms: { name: string; count: number }[]
  source_mix: { source_type: string; count: number }[]
  review_statuses: { review_status: string; count: number }[]
  hypothesis_review_statuses: { review_status: string; count: number }[]
  theme_summaries: { theme: string; count: number; avg_score: number; last_seen_at: string }[]
}
export interface DashboardPayload { app_name: string; stats: Stats; last_run: Run | null; recent_runs: Run[]; items: ResearchItem[]; images: ImageRecord[]; hypotheses: Hypothesis[]; themes: { slug: string; label: string }[]; source_types: string[]; is_running: boolean }
export interface AppShellSummaryPayload {
  app_name: string
  last_run: Run | null
  stats: {
    totals: {
      item_count?: number
      image_count?: number
      hypothesis_count?: number
      run_count?: number
      saved_item_count?: number
      saved_hypothesis_count?: number
    }
  }
  is_running: boolean
}
export interface BrowseItemsPayload { items: ResearchItem[]; total: number; offset: number; limit: number }
export interface BrowseImagesPayload { images: ImageRecord[]; total: number; offset: number; limit: number; has_more: boolean }
export interface Screenshot {
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
}

export interface ScreenshotTerm {
  term: string
  count: number
}

export interface BrowseScreenshotsPayload {
  screenshots: Screenshot[]
  total: number
  offset: number
  limit: number
  has_more: boolean
  next_offset?: number
}
export interface ScreenshotSourceSummary {
  source: string
  count: number
}

export interface UserTagCount { tag: string; count: number }

export interface Tag { id: number; name: string; color: string; usage_count?: number }
export interface Collection { id: number; name: string; color: string; icon: string; created_at: string; item_count: number }
export interface CollectionItemsPayload { items: ResearchItem[]; total: number; offset: number; limit: number }
export interface ActivityEvent { event_type: 'item' | 'hypothesis' | 'screenshot'; id: number; title?: string; term?: string; source_type?: string; theme?: string; created_at: string }
export interface SearchResult { result_type: 'item' | 'hypothesis'; id: number; title?: string; body?: string; source_type?: string; theme?: string; score?: number; created_at?: string }
export interface SourceHealthItem {
  name: string
  total_items: number
  last_item_at: string | null
  items_last_7d: number
  items_last_30d: number
  trend: "up" | "down" | "flat"
  status: "healthy" | "stale" | "inactive" | "new"
}
export interface SourceHealthPayload { sources: SourceHealthItem[] }
export interface TrendsPayload { dates: string[]; series: Record<string, number[]> }
export interface BrowseHypothesesPayload {
  hypotheses: Hypothesis[]
  total: number
  offset: number
  limit: number
}
export interface ScoreHistogram {
  buckets: { range: string; count: number }[]
}

export interface InsightsPayload {
  source_breakdown: { source: string; count: number; percentage: number }[]
  top_themes: { theme: string; count: number }[]
  review_funnel: { total: number; new: number; reviewing: number; shortlisted: number; archived: number }
  growth: { items_last_7d: number; items_last_30d: number; growth_rate: number }
  top_compounds: { name: string; count: number }[]
}

export interface RecommendedItem {
  id: number
  title: string
  url: string
  summary: string
  source_type: string
  theme: string
  score: number
  overlap_count: number
  overlapping_compounds: string[]
  overlapping_mechanisms: string[]
}

export interface RecommendationsPayload {
  items: RecommendedItem[]
  reason: string
}

export interface DuplicateItem {
  id: number
  title: string
  url: string
  source_type: string
  theme: string
  score: number
  review_status: string
  first_seen_at: string
}

export interface DuplicateGroup {
  reason: string
  items: DuplicateItem[]
}

export interface DuplicatesPayload {
  groups: DuplicateGroup[]
  total_groups: number
}

export interface Performer {
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
  discovered_via: string | null
  first_seen_at: string
  last_checked_at: string | null
  created_at: string
  links?: PerformerLink[]
  link_count?: number
  media_count_actual?: number
  media_total?: number
  subscription_price?: number | null
  is_subscribed?: number | null
  subscription_renewed_at?: string | null
  reddit_username?: string | null
  twitter_username?: string | null
  screenshots_count?: number
}

export interface PerformerLink {
  id: number
  performer_id: number
  platform: string
  url: string
  username: string | null
}

export interface PerformerMedia {
  id: number
  performer_id: number
  media_type: string
  source_url: string | null
  local_path: string | null
  thumbnail_path: string | null
  width: number | null
  height: number | null
  duration: number | null
  file_size: number | null
  caption: string | null
  ai_summary: string | null
  is_favorite: number
  captured_at: string
  local_url?: string
}

export interface PerformerStats {
  total: number
  by_platform: Record<string, number>
  favorites: number
  with_media: number
  subscribed_count: number
  monthly_spend: number
  stale_count: number
  renewing_soon_count: number
}

export interface PerformerAnalytics {
  platform_distribution: { platform: string; count: number }[]
  top_by_media: { id: number; username: string; platform: string; media_count: number }[]
  recent_additions: { id: number; username: string; platform: string; created_at: string }[]
  tag_cloud: { tag: string; count: number }[]
  growth: { total: number; this_week: number; this_month: number }
  media_stats: { total_photos: number; total_videos: number; avg_per_performer: number }
}

export interface PerformerActivityBucket {
  week: string
  count: number
}

export interface PerformerActivity {
  weeks: PerformerActivityBucket[]
  total: number
}

export interface BrowsePerformersPayload {
  performers: Performer[]
  total: number
  has_more: boolean
}

export interface DiscoveredCreator {
  username: string
  display_name: string
  platform: string
  bio: string
  tags: string[]
  reason?: string
  exists?: boolean
}

export interface BulkImportResult {
  created: number
  skipped: number
  performers: Performer[]
}

export interface ImportDiscoveredResult {
  created: number
  existing: number
  skipped: number
  performers: Performer[]
  existing_performers: Performer[]
}

export interface CaptureQueueEntry {
  id: number
  performer_id: number
  status: 'queued' | 'running' | 'done' | 'failed'
  created_at: string
  started_at: string | null
  finished_at: string | null
  captured_count: number
  error_msg: string | null
  username: string
  display_name: string | null
  platform: string
  avatar_local: string | null
  avatar_url: string | null
}

export interface TelegramChannel {
  id: number
  username: string
  display_name: string
  member_count: number | null
  description: string | null
  enabled: number
  auto_discovered: number
  last_scanned_at: string | null
  added_at: string
}

export interface TelegramChannelCandidate {
  username: string
  display_name?: string
  member_count?: number | null
  description?: string | null
  valid: boolean
}

export interface TelegramMedia {
  id: number
  channel_username: string
  message_id: number
  media_type: 'photo' | 'video' | 'gif'
  width: number | null
  height: number | null
  duration: number | null
  file_size: number | null
  caption: string | null
  local_path: string | null
  passes_filter: number
  posted_at: string | null
  created_at: string
}

export interface BrowseTelegramMediaPayload {
  items: TelegramMedia[]
  total: number
  offset: number
  limit: number
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

export interface SmartRules {
  source?: string
  term?: string
  has_ai_summary?: boolean
  media_type?: "video" | "image"
  min_date?: string
  performer_id?: number
  limit?: number
}

export interface Playlist {
  id: number
  name: string
  description: string | null
  cover_url: string | null
  is_smart: boolean
  smart_rules: SmartRules | null
  item_count: number
  total_duration: number
  created_at: string
  updated_at: string
}

export interface PlaylistDetailPayload {
  playlist: Playlist
  screenshots: Screenshot[]
  total: number
  offset: number
  limit: number
}

export async function fetchSettings(): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout("/api/settings", {
    headers: { Accept: "application/json" },
  })
  if (!res.ok) {
    const message = await readErrorMessage(res)
    throw new Error(`${res.status} ${message}`)
  }
  return res.json()
}

export async function updateSettings(settings: Record<string, unknown>): Promise<void> {
  const res = await fetchWithTimeout("/api/settings", {
    method: 'PUT',
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  })
  if (!res.ok) {
    const message = await readErrorMessage(res)
    throw new Error(`${res.status} ${message}`)
  }
}

// API functions
export const api = {
  dashboard: () => apiFetch<DashboardPayload>("/api/dashboard"),
  appShellSummary: () => apiFetch<AppShellSummaryPayload>("/api/app-shell-summary"),
  items: (params?: Record<string, string | number | boolean>) => apiFetch<ResearchItem[]>(`/api/items${buildQuery(params)}`),
  browseItems: (params?: Record<string, string | number | boolean>) => apiFetch<BrowseItemsPayload>(`/api/browse/items${buildQuery(params)}`),
  item: (id: number) => apiFetch<ResearchItem>(`/api/items/${id}`),
  updateItem: (id: number, patch: { review_status?: string; is_saved?: boolean; user_note?: string; queued_at?: string | null }) => apiFetch<ResearchItem>(`/api/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  bulkUpdateItems: (item_ids: number[], patch: { review_status?: string; is_saved?: boolean; queued_at?: string | null }) => apiFetch<{ updated: number }>("/api/items/bulk", { method: "POST", body: JSON.stringify({ item_ids, ...patch }) }),
  images: (params?: Record<string, string | number>) => apiFetch<ImageRecord[]>(`/api/images${buildQuery(params)}`),
  browseImages: (params?: Record<string, string | number>) => apiFetch<BrowseImagesPayload>(`/api/browse/images${buildQuery(params)}`),
  hypotheses: (limit?: number) => apiFetch<Hypothesis[]>(`/api/hypotheses${limit ? `?limit=${limit}` : ""}`),
  updateHypothesis: (id: number, patch: { review_status?: string; is_saved?: boolean; user_note?: string }) => apiFetch<Hypothesis>(`/api/hypotheses/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  runs: (limit?: number) => apiFetch<Run[]>(`/api/runs${limit ? `?limit=${limit}` : ""}`),
  run: (id: number) => apiFetch<Run>(`/api/runs/${id}`),
  triggerCrawl: () => apiFetch<{ status: string }>("/api/run", { method: "POST" }),
  browseScreenshots: (
    params?: Record<string, string | number | boolean>,
    options?: { signal?: AbortSignal },
  ) => apiFetch<BrowseScreenshotsPayload>(`/api/screenshots${buildQuery(params)}`, { signal: options?.signal }),
  screenshotStatus: () => apiFetch<{ running: boolean; current_term?: string; terms_done?: number; terms_total?: number; items_found?: number }>("/api/screenshots/status"),
  triggerCapture: () => fetchCaptureStatus(),
  recoverVideos: () => apiFetch<{ recovered: number; skipped: number }>('/api/screenshots/recover-videos', { method: 'POST' }),
  purgeWomen: () => apiFetch<{ status: string; to_scan: number }>('/api/screenshots/purge-women', { method: 'POST' }),
  captureVideos: () => apiFetch<{ status: string; terms: number }>('/api/screenshots/capture-videos', { method: 'POST' }),
  screenshotTerms: () =>
    apiFetch<{ terms: ScreenshotTerm[] }>("/api/screenshots/terms").then((r) => r.terms),
  summarizeScreenshot: (id: number) =>
    apiFetch<{ summary: string | null; tags?: Record<string, unknown>; refused?: boolean; message?: string }>(`/api/screenshots/${id}/summarize`, { method: "POST" }),
  searchScreenshots: (q: string) =>
    apiFetch<Screenshot[]>(`/api/screenshots/search?q=${encodeURIComponent(q)}`),
  findSimilarScreenshots: (id: number) =>
    apiFetch<Screenshot[]>(`/api/screenshots/${id}/similar`),
  relatedScreenshots: (id: number) =>
    apiFetch<Screenshot[]>(`/api/screenshots/${id}/related`),
  mediaStats: () =>
    apiFetch<MediaStatsPayload>("/api/screenshots/media-stats"),
  screenshotSources: () =>
    apiFetch<{ sources: ScreenshotSourceSummary[] }>("/api/screenshots/sources").then((r) => r.sources),
  screenshotDelete: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/screenshots/${id}`, { method: "DELETE" }),
  bulkDeleteScreenshots: (ids: number[]) =>
    apiFetch<{ deleted: number }>("/api/screenshots/bulk", { method: "DELETE", body: JSON.stringify({ ids }) }),
  batchDescribeScreenshots: (ids: number[], limit = 10) =>
    apiFetch<{ processed: number; failed: number; results: { id: number; summary: string | null; tags: Record<string, unknown>; refused?: boolean }[] }>(
      "/api/screenshots/batch-describe",
      { method: "POST", body: JSON.stringify({ ids, limit }) },
    ),
  triggerScan: () =>
    apiFetch<{ status: string }>("/api/screenshots/scan", { method: "POST" }),
  scanStatus: () =>
    apiFetch<{ running: boolean; last_result: { removed: number; kept: number } | null }>("/api/screenshots/scan/status"),
  rateScreenshot: (id: number, rating: number) =>
    apiFetch<Screenshot>(`/api/screenshots/${id}/rate`, { method: "PATCH", body: JSON.stringify({ rating }) }),
  bulkRateScreenshots: (ids: number[], rating: number) =>
    apiFetch<{ updated: number }>("/api/screenshots/bulk-rate", {
      method: "PATCH",
      body: JSON.stringify({ ids, rating }),
    }),
  topRatedScreenshots: () =>
    apiFetch<{ screenshots: Screenshot[] }>("/api/screenshots/top-rated").then((r) => r.screenshots),
  screenshotAllTags: () =>
    apiFetch<{ tags: UserTagCount[] }>("/api/screenshots/all-tags").then((r) => r.tags),
  updateScreenshotTags: (id: number, tags: string[]) =>
    apiFetch<Screenshot>(`/api/screenshots/${id}/tags`, { method: "PATCH", body: JSON.stringify({ tags }) }),
  activity: () => apiFetch<ActivityEvent[]>('/api/activity'),
  search: (q: string, limit = 20, signal?: AbortSignal) =>
    apiFetch<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`, { signal }),
  statsTrends: (days = 30) => apiFetch<TrendsPayload>(`/api/stats/trends?days=${days}`),
  exportItemsUrl: (format: 'csv' | 'json', params?: Record<string, string | number | boolean>) => {
    return `/api/export/items.${format}${buildQuery(params)}`
  },
  browseHypotheses: (params?: Record<string, string | number | boolean>) =>
    apiFetch<BrowseHypothesesPayload>(`/api/browse/hypotheses${buildQuery(params)}`),
  hypothesesExportUrl: (params?: Record<string, string>) =>
    `/api/hypotheses/export${buildQuery({ format: 'md', ...params })}`,
  hypothesesExportMarkdown: async (params?: Record<string, string>) => {
    const res = await fetchWithTimeout(`/api/hypotheses/export${buildQuery({ format: 'md', ...params })}`)
    if (!res.ok) {
      const message = await readErrorMessage(res)
      throw new Error(`${res.status} ${message}`)
    }
    return res.text()
  },
  relatedItems: (item: ResearchItem, limit = 6) => {
    const params: Record<string, string | number> = { limit: limit + 1, offset: 0 }
    if (item.theme) params.theme = item.theme
    return apiFetch<BrowseItemsPayload>(`/api/browse/items${buildQuery(params)}`)
      .then((r) => ({ ...r, items: r.items.filter((i) => i.id !== item.id).slice(0, limit) }))
  },
  scoreHistogram: () => apiFetch<ScoreHistogram>('/api/stats/histogram'),
  insights: () => apiFetch<InsightsPayload>('/api/stats/insights'),
  sourceHealth: () => apiFetch<SourceHealthPayload>('/api/stats/source-health'),
  createTheme: (slug: string, label: string) =>
    apiFetch<{ slug: string; label: string }>('/api/themes', { method: 'POST', body: JSON.stringify({ slug, label }) }),
  deleteTheme: (slug: string) =>
    apiFetch<{ ok: boolean }>(`/api/themes/${slug}`, { method: 'DELETE' }),
  itemOembed: (id: number) => apiFetch<{ html?: string; error?: string }>(`/api/items/${id}/oembed`),
  telegramChannels: () =>
    apiFetch<TelegramChannel[]>('/api/telegram/channels'),
  addTelegramChannel: (username: string) =>
    apiFetch<{ username: string; display_name: string }>('/api/telegram/channels', {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),
  removeTelegramChannel: (username: string) =>
    apiFetch<{ ok: boolean }>(`/api/telegram/channels/${username}`, { method: 'DELETE' }),
  toggleTelegramChannel: (username: string, enabled: boolean) =>
    apiFetch<{ ok: boolean }>(`/api/telegram/channels/${username}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  discoverTelegramChannels: (query: string) =>
    apiFetch<{ candidates: TelegramChannelCandidate[] }>('/api/telegram/channels/discover', {
      method: 'POST',
      body: JSON.stringify({ query }),
    }),
  triggerTelegramScan: () =>
    apiFetch<{ status: string }>('/api/telegram/scan', { method: 'POST' }),
  telegramScanStatus: () =>
    apiFetch<{ running: boolean; last_result: { photos: number; videos: number; errors: number } | null }>(
      '/api/telegram/scan/status'
    ),
  browseTelegramMedia: (params?: Record<string, string | number>) =>
    apiFetch<BrowseTelegramMediaPayload>(`/api/telegram/media${buildQuery(params)}`),
  telegramStreamUrl: (mediaId: number) => `/api/telegram/media/${mediaId}/stream`,
  queueCount: () => apiFetch<{ count: number }>("/api/items/queue/count"),
  suggest: (q: string, field: "compound" | "mechanism") =>
    apiFetch<{ suggestions: string[] }>(`/api/items/suggest${buildQuery({ q, field })}`),
  recommendations: () => apiFetch<RecommendationsPayload>("/api/recommendations"),
  duplicates: () => apiFetch<DuplicatesPayload>("/api/items/duplicates"),
  mergeItems: (keep_id: number, remove_ids: number[]) =>
    apiFetch<{ merged: number }>("/api/items/merge", { method: "POST", body: JSON.stringify({ keep_id, remove_ids }) }),
  // Tags
  tags: () => apiFetch<Tag[]>('/api/tags'),
  createTag: (name: string, color: string) =>
    apiFetch<Tag>('/api/tags', { method: 'POST', body: JSON.stringify({ name, color }) }),
  deleteTag: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/tags/${id}`, { method: 'DELETE' }),
  itemTags: (itemId: number) =>
    apiFetch<Tag[]>(`/api/items/${itemId}/tags`),
  addItemTag: (itemId: number, payload: { tag_id?: number; tag_name?: string; color?: string }) =>
    apiFetch<Tag[]>(`/api/items/${itemId}/tags`, { method: 'POST', body: JSON.stringify(payload) }),
  removeItemTag: (itemId: number, tagId: number) =>
    apiFetch<Tag[]>(`/api/items/${itemId}/tags/${tagId}`, { method: 'DELETE' }),
  // Collections
  collections: () => apiFetch<Collection[]>('/api/collections'),
  createCollection: (data: { name: string; color?: string; icon?: string }) =>
    apiFetch<Collection>('/api/collections', { method: 'POST', body: JSON.stringify(data) }),
  updateCollection: (id: number, data: { name?: string; color?: string; icon?: string }) =>
    apiFetch<Collection>(`/api/collections/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCollection: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/collections/${id}`, { method: 'DELETE' }),
  addToCollection: (collectionId: number, itemIds: number[]) =>
    apiFetch<{ added: number }>(`/api/collections/${collectionId}/items`, { method: 'POST', body: JSON.stringify({ item_ids: itemIds }) }),
  removeFromCollection: (collectionId: number, itemIds: number[]) =>
    apiFetch<{ removed: number }>(`/api/collections/${collectionId}/items`, { method: 'DELETE', body: JSON.stringify({ item_ids: itemIds }) }),
  collectionItems: (collectionId: number, params?: Record<string, string | number>) =>
    apiFetch<CollectionItemsPayload>(`/api/collections/${collectionId}/items${buildQuery(params)}`),
  // Performers
  browsePerformers: (params?: Record<string, string | number | boolean>) =>
    apiFetch<BrowsePerformersPayload>(`/api/performers${buildQuery(params)}`),
  addPerformer: (data: { username: string; platform: string; display_name?: string; profile_url?: string; tags?: string[]; bio?: string }) =>
    apiFetch<Performer>('/api/performers', { method: 'POST', body: JSON.stringify(data) }),
  getPerformer: (id: number) =>
    apiFetch<Performer>(`/api/performers/${id}`),
  updatePerformer: (id: number, updates: Partial<Performer>) =>
    apiFetch<Performer>(`/api/performers/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  deletePerformer: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/performers/${id}`, { method: 'DELETE' }),
  addPerformerLink: (id: number, data: { platform: string; url: string; username?: string }) =>
    apiFetch<PerformerLink>(`/api/performers/${id}/links`, { method: 'POST', body: JSON.stringify(data) }),
  deletePerformerLink: (id: number, linkId: number) =>
    apiFetch<{ ok: boolean }>(`/api/performers/${id}/links/${linkId}`, { method: 'DELETE' }),
  browsePerformerMedia: (id: number, params?: Record<string, string | number>) =>
    apiFetch<{ items: PerformerMedia[]; total: number; offset: number; limit: number; has_more: boolean }>(`/api/performers/${id}/media${buildQuery(params)}`),
  performerActivity: (id: number, weeks = 12) =>
    apiFetch<PerformerActivity>(`/api/performers/${id}/activity?weeks=${weeks}`),
  performerStats: () =>
    apiFetch<PerformerStats>('/api/performers/stats'),
  performerAnalytics: () =>
    apiFetch<PerformerAnalytics>('/api/performers/analytics'),
  discoverPerformers: (query: string, platform?: string, options?: { seed_performer_id?: number; seed_term?: string; limit?: number }) =>
    apiFetch<{ suggestions: DiscoveredCreator[] }>('/api/performers/discover', {
      method: 'POST',
      body: JSON.stringify({
        query,
        platform: platform || undefined,
        seed_performer_id: options?.seed_performer_id,
        seed_term: options?.seed_term,
        limit: options?.limit,
      }),
    }).then((r) => r.suggestions),
  importDiscoveredPerformers: (creators: DiscoveredCreator[], captureExisting = true) =>
    apiFetch<ImportDiscoveredResult>('/api/performers/discover/import', {
      method: 'POST',
      body: JSON.stringify({ creators, capture_existing: captureExisting }),
    }),
  importPerformerUrl: (url: string) =>
    apiFetch<Performer>('/api/performers/import-url', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  bulkImportPerformers: (usernames: string[], platform: string) =>
    apiFetch<BulkImportResult>('/api/performers/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ usernames, platform }),
    }),
  capturePerformerMedia: (id: number) =>
    apiFetch<{ status: string; performer_id: number }>(`/api/performers/${id}/capture`, { method: 'POST' }),
  autoLinkPerformers: () =>
    apiFetch<{ linked: number; performers_matched: number }>('/api/performers/auto-link', { method: 'POST' }),
  getWatchlist: () =>
    apiFetch<{ performers: Performer[]; total: number }>('/api/performers/watchlist'),
  captureWatchlist: () =>
    apiFetch<{ status: string; queued: number; performer_ids?: number[] }>('/api/performers/watchlist/capture-all', { method: 'POST' }),
  captureAllPerformers: () =>
    apiFetch<{ status: string; queued: number }>('/api/performers/capture-all', { method: 'POST' }),
  getCaptureQueue: () =>
    apiFetch<{ queue: CaptureQueueEntry[] }>('/api/performers/capture-queue'),
  cancelQueueEntry: (entryId: number) =>
    apiFetch<{ ok: boolean }>(`/api/performers/capture-queue/${entryId}`, { method: 'DELETE' }),
  captureStale: (staleDays = 7) =>
    apiFetch<{ queued: number; total_stale: number }>(`/api/performers/capture-stale?stale_days=${staleDays}`, { method: 'POST' }),
  enrichPerformer: (id: number) =>
    apiFetch<{ avatar_url: string | null; updated: boolean }>(`/api/performers/enrich/${id}`, { method: 'POST' }),
  similarPerformers: (id: number, limit = 6) =>
    apiFetch<Performer[]>(`/api/performers/${id}/similar${buildQuery({ limit })}`),
  searchPerformers: (query: string, limit = 6) =>
    apiFetch<{ performers: Performer[]; total: number }>('/api/performers/search', {
      method: 'POST',
      body: JSON.stringify({ query, limit }),
    }),
  exportPerformersUrl: () => `/api/performers/export.csv`,
  // Playlists
  playlists: () => apiFetch<Playlist[]>('/api/playlists'),
  createPlaylist: (data: { name: string; description?: string; is_smart?: boolean; smart_rules?: SmartRules }) =>
    apiFetch<Playlist>('/api/playlists', { method: 'POST', body: JSON.stringify(data) }),
  getPlaylist: (id: number, params?: Record<string, string | number>) =>
    apiFetch<PlaylistDetailPayload>(`/api/playlists/${id}${buildQuery(params)}`),
  updatePlaylist: (id: number, data: { name?: string; description?: string; is_smart?: boolean; smart_rules?: SmartRules }) =>
    apiFetch<Playlist>(`/api/playlists/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deletePlaylist: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/playlists/${id}`, { method: 'DELETE' }),
  addToPlaylist: (playlistId: number, screenshotIds: number[]) =>
    apiFetch<{ added: number }>(`/api/playlists/${playlistId}/items`, { method: 'POST', body: JSON.stringify({ screenshot_ids: screenshotIds }) }),
  removeFromPlaylist: (playlistId: number, screenshotIds: number[]) =>
    apiFetch<{ removed: number }>(`/api/playlists/${playlistId}/items`, { method: 'DELETE', body: JSON.stringify({ screenshot_ids: screenshotIds }) }),
  reorderPlaylist: (playlistId: number, orderedIds: number[]) =>
    apiFetch<{ ok: boolean }>(`/api/playlists/${playlistId}/reorder`, { method: 'POST', body: JSON.stringify({ ordered_ids: orderedIds }) }),
  populatePlaylist: (playlistId: number) =>
    apiFetch<{ populated: number }>(`/api/playlists/${playlistId}/populate`, { method: 'POST' }),
  // Auto-tag & URL capture
  mediaAnalytics: (days = 30) =>
    apiFetch<{
      daily_captures: { date: string; count: number }[]
      top_terms: { term: string; count: number }[]
      source_dist: { source: string; count: number }[]
      rating_dist: { rating: number; count: number }[]
      tag_cloud: { tag: string; count: number }[]
      type_over_time: { date: string; videos: number; images: number }[]
    }>(`/api/screenshots/analytics?days=${days}`),
  autoTagScreenshots: (limit?: number) =>
    apiFetch<{ tagged: number; results: { id: number; tags: string[] }[] }>(
      "/api/screenshots/auto-tag",
      { method: "POST", body: JSON.stringify({ limit: limit ?? 50 }) },
    ),
  captureFromUrl: (url: string, term?: string, performer_id?: number) =>
    apiFetch<Screenshot>(
      "/api/screenshots/capture-url",
      { method: "POST", body: JSON.stringify({ url, term: term || undefined, performer_id: performer_id || undefined }) },
    ),
  backfillPerformerLinks: () =>
    apiFetch<{ ok: boolean; linked: number }>("/api/screenshots/backfill-performers", { method: "POST" }),
}
