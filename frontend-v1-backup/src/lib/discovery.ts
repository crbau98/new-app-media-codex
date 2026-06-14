import type { Screenshot, Performer, Playlist } from "./api"

// ── Mock discovery data (will be replaced with real APIs later) ──────────

export interface TrendingItem {
  id: number
  type: "screenshot"
  title: string
  thumbnail_url: string
  views_count: number
  likes_count: number
  performer_username: string | null
}

export interface PopularCreator {
  id: number
  username: string
  display_name: string | null
  avatar_url: string | null
  follower_count: number
  media_count: number
  platform: string
}

export interface FeaturedPlaylist {
  id: number
  name: string
  description: string | null
  cover_url: string | null
  item_count: number
  is_smart: boolean
}

export interface TrendingTag {
  tag: string
  count: number
  trending: boolean
}

export interface NewThisWeekItem {
  id: number
  type: "screenshot"
  title: string
  thumbnail_url: string
  created_at: string
  performer_username: string | null
}

function mockScreenshotToTrending(s: Screenshot, _idx: number): TrendingItem {
  return {
    id: s.id,
    type: "screenshot",
    title: s.term,
    thumbnail_url: s.thumbnail_url ?? s.preview_url ?? s.local_url ?? "",
    views_count: s.views_count || Math.floor(Math.random() * 5000) + 100,
    likes_count: s.likes_count || Math.floor(Math.random() * 500) + 10,
    performer_username: s.performer_username ?? null,
  }
}

function mockPerformerToPopular(p: Performer): PopularCreator {
  return {
    id: p.id,
    username: p.username,
    display_name: p.display_name,
    avatar_url: p.avatar_url || p.avatar_local || null,
    follower_count: p.follower_count || p.followers_count || Math.floor(Math.random() * 50000) + 1000,
    media_count: p.media_count || p.media_count_actual || p.screenshots_count || Math.floor(Math.random() * 200) + 10,
    platform: p.platform,
  }
}

function mockPlaylistToFeatured(p: Playlist): FeaturedPlaylist {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    cover_url: p.cover_url,
    item_count: p.item_count,
    is_smart: p.is_smart,
  }
}

const MOCK_TRENDING_SEARCHES = [
  "summer vibes",
  "neon lights",
  "beach sunset",
  "urban exploration",
  "portrait mode",
  "cinematic",
  "aesthetic",
  "golden hour",
  "night photography",
  "street style",
]

const MOCK_TRENDING_TAGS: TrendingTag[] = [
  { tag: "aesthetic", count: 1243, trending: true },
  { tag: "portrait", count: 982, trending: true },
  { tag: "neon", count: 876, trending: true },
  { tag: "vintage", count: 754, trending: false },
  { tag: "minimal", count: 621, trending: false },
  { tag: "urban", count: 543, trending: true },
  { tag: "nature", count: 512, trending: false },
  { tag: "abstract", count: 498, trending: false },
  { tag: "moody", count: 432, trending: true },
  { tag: "cinematic", count: 387, trending: false },
  { tag: "film", count: 354, trending: false },
  { tag: "dark", count: 321, trending: false },
]

// ── Discovery API functions ─────────────────────────────────────────────

export async function fetchTrendingMedia(): Promise<TrendingItem[]> {
  // In the future: return api.discovery.trending()
  // For now, return mock data wrapped in a promise
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(
        Array.from({ length: 10 }).map((_, i) => ({
          id: i + 1,
          type: "screenshot" as const,
          title: `Trending media ${i + 1}`,
          thumbnail_url: "",
          views_count: Math.floor(Math.random() * 10000) + 500,
          likes_count: Math.floor(Math.random() * 1000) + 50,
          performer_username: i % 3 === 0 ? `creator_${i}` : null,
        }))
      )
    }, 300)
  })
}

export async function fetchPopularCreators(): Promise<PopularCreator[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(
        Array.from({ length: 12 }).map((_, i) => ({
          id: i + 1,
          username: `creator_${i + 1}`,
          display_name: `Creator ${i + 1}`,
          avatar_url: null,
          follower_count: Math.floor(Math.random() * 100000) + 1000,
          media_count: Math.floor(Math.random() * 500) + 20,
          platform: ["OnlyFans", "Twitter/X", "Instagram", "Reddit", "Fansly"][i % 5],
        }))
      )
    }, 300)
  })
}

export async function fetchFeaturedPlaylists(): Promise<FeaturedPlaylist[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(
        Array.from({ length: 6 }).map((_, i) => ({
          id: i + 1,
          name: [`Favorites`, `Watch Later`, `Summer Vibes`, `Neon Nights`, `Portrait Collection`, `Cinematic`][i],
          description: `Curated playlist ${i + 1}`,
          cover_url: null,
          item_count: Math.floor(Math.random() * 100) + 10,
          is_smart: i % 2 === 0,
        }))
      )
    }, 300)
  })
}

export async function fetchTrendingTags(): Promise<TrendingTag[]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(MOCK_TRENDING_TAGS), 200)
  })
}

export async function fetchNewThisWeek(): Promise<NewThisWeekItem[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(
        Array.from({ length: 10 }).map((_, i) => ({
          id: i + 1,
          type: "screenshot" as const,
          title: `New item ${i + 1}`,
          thumbnail_url: "",
          created_at: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
          performer_username: i % 2 === 0 ? `creator_${i}` : null,
        }))
      )
    }, 300)
  })
}

export function getTrendingSearches(): string[] {
  return MOCK_TRENDING_SEARCHES
}

// ── Helpers to transform real API data when available ───────────────────

export function transformScreenshotsToTrending(screenshots: Screenshot[]): TrendingItem[] {
  return screenshots.slice(0, 10).map(mockScreenshotToTrending)
}

export function transformPerformersToPopular(performers: Performer[]): PopularCreator[] {
  return performers.slice(0, 12).map(mockPerformerToPopular)
}

export function transformPlaylistsToFeatured(playlists: Playlist[]): FeaturedPlaylist[] {
  return playlists.slice(0, 6).map(mockPlaylistToFeatured)
}
