import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { creatorKey, type DiscoveryMode } from '@/lib/discovery'

export type Theme = 'dark' | 'light' | 'auto'
export type GridDensity = 'compact' | 'normal' | 'spacious'
export type ToastType = 'success' | 'error' | 'info'
export type FontSize = 'small' | 'default' | 'large'
export type VideoQuality = 'auto' | '720p' | '1080p'
export type DiscoveryFeedback = 'view' | 'more' | 'less' | 'hide'

export interface DiscoverySignalItem {
  id: string
  creator: string
  tags: string[]
}

export interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
}

export interface Filters {
  search: string
  sourceType: string | null
  sort: 'newest' | 'oldest' | 'topRated' | 'az' | 'random' | 'mostViewed'
  tag: string | null
  category: string | null
}

function containsEmail(value: string): boolean {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)
}

export function sanitizeCreatorWatchlist(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const unique = new Map<string, string>()
  for (const raw of values) {
    if (typeof raw !== 'string' || containsEmail(raw)) continue
    const display = raw.trim().replace(/^@/, '').replace(/\s+/g, ' ').slice(0, 50)
    const key = creatorKey(display)
    if (key.length >= 2 && !unique.has(key)) unique.set(key, display)
    if (unique.size >= 8) break
  }
  return [...unique.values()]
}

interface AppState {
  // Theme (DOM application lives in Layout + the pre-hydration script)
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void

  // Sidebar
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void

  // Toasts
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => string
  removeToast: (id: string) => void

  // Search
  searchQuery: string
  setSearchQuery: (q: string) => void

  // Filters (intentionally NOT persisted — fresh session, fresh filters)
  filters: Filters
  setFilters: (f: Partial<Filters>) => void
  resetFilters: () => void

  // Recently viewed
  recentlyViewed: string[]
  addRecentlyViewed: (id: string) => void

  // Like cache
  likeCache: Record<string, boolean>
  toggleLike: (id: string) => void

  // Follow cache — ids use the unified `creator-<canonical>` scheme
  followCache: Record<string, boolean>
  toggleFollow: (id: string) => void

  // Creator radar: user-curated public-source lookups. Empty by default —
  // the Creators page onboards the user into building it.
  creatorWatchlist: string[]
  addCreatorToWatchlist: (creator: string) => void
  removeCreatorFromWatchlist: (creator: string) => void

  // Private, on-device discovery profile
  tagPreferences: Record<string, number>
  creatorPreferences: Record<string, number>
  hiddenMedia: string[]
  discoveryMode: DiscoveryMode
  recordDiscoveryFeedback: (item: DiscoverySignalItem, signal: DiscoveryFeedback) => void
  setDiscoveryMode: (mode: DiscoveryMode) => void
  resetDiscoveryProfile: () => void

  // Command palette
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void
  toggleCommandPalette: () => void

  // Grid density
  gridDensity: GridDensity
  setGridDensity: (d: GridDensity) => void

  // Settings
  fontSize: FontSize
  setFontSize: (s: FontSize) => void
  reduceMotion: boolean
  setReduceMotion: (v: boolean) => void
  autoplayVideos: boolean
  setAutoplayVideos: (v: boolean) => void
  defaultQuality: VideoQuality
  setDefaultQuality: (q: VideoQuality) => void
  muteOnStart: boolean
  setMuteOnStart: (v: boolean) => void
  pictureInPicture: boolean
  setPictureInPicture: (v: boolean) => void

  // Full local wipe (Delete Account)
  wipeLocalData: () => void
}

const initialFilters: Filters = {
  search: '',
  sourceType: null,
  sort: 'newest',
  tag: null,
  category: null,
}

/** Every persisted/transient data field at its factory default. */
function defaultDataState() {
  return {
    theme: 'dark' as Theme,
    sidebarCollapsed: false,
    toasts: [] as Toast[],
    searchQuery: '',
    filters: { ...initialFilters },
    recentlyViewed: [] as string[],
    likeCache: {} as Record<string, boolean>,
    followCache: {} as Record<string, boolean>,
    creatorWatchlist: [] as string[],
    tagPreferences: {} as Record<string, number>,
    creatorPreferences: {} as Record<string, number>,
    hiddenMedia: [] as string[],
    discoveryMode: 'balanced' as DiscoveryMode,
    commandPaletteOpen: false,
    gridDensity: 'normal' as GridDensity,
    fontSize: 'default' as FontSize,
    reduceMotion: false,
    autoplayVideos: false,
    defaultQuality: 'auto' as VideoQuality,
    muteOnStart: true,
    pictureInPicture: true,
  }
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...defaultDataState(),

      toggleTheme: () => {
        const current = get().theme
        const resolved = current === 'auto'
          ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
          : current
        set({ theme: resolved === 'dark' ? 'light' : 'dark' })
      },
      setTheme: (theme) => set({ theme }),

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

      addToast: (toast) => {
        const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
        set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
        setTimeout(() => {
          get().removeToast(id)
        }, 4000)
        return id
      },
      removeToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      setSearchQuery: (searchQuery) => set({ searchQuery }),

      setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
      resetFilters: () => set({ filters: { ...initialFilters } }),

      addRecentlyViewed: (id) =>
        set((s) => ({
          recentlyViewed: [id, ...s.recentlyViewed.filter((x) => x !== id)].slice(0, 20),
        })),

      toggleLike: (id) =>
        set((s) => ({
          likeCache: { ...s.likeCache, [id]: !s.likeCache[id] },
        })),

      toggleFollow: (id) =>
        set((s) => ({
          followCache: { ...s.followCache, [id]: !s.followCache[id] },
        })),

      addCreatorToWatchlist: (creator) => set((state) => {
        if (containsEmail(creator)) return state
        const display = creator.trim().replace(/^@/, '').replace(/\s+/g, ' ').slice(0, 50)
        const key = creatorKey(display)
        if (key.length < 2 || state.creatorWatchlist.some((item) => creatorKey(item) === key) || state.creatorWatchlist.length >= 8) return state
        return { creatorWatchlist: [...state.creatorWatchlist, display] }
      }),
      removeCreatorFromWatchlist: (creator) => set((state) => ({
        creatorWatchlist: state.creatorWatchlist.filter((item) => creatorKey(item) !== creatorKey(creator)),
      })),

      recordDiscoveryFeedback: (item, signal) => set((state) => {
        const delta = signal === 'more' ? 2 : signal === 'less' || signal === 'hide' ? -2 : 0.2
        const tagPreferences = { ...state.tagPreferences }
        for (const tag of item.tags.slice(0, 8)) {
          const tagKey = creatorKey(tag)
          if (tagKey) tagPreferences[tagKey] = Math.max(-8, Math.min(12, (tagPreferences[tagKey] || 0) + delta))
        }
        const key = creatorKey(item.creator)
        const creatorPreferences = { ...state.creatorPreferences }
        if (key) creatorPreferences[key] = Math.max(-5, Math.min(8, (creatorPreferences[key] || 0) + delta))
        const hiddenMedia = signal === 'hide'
          ? [item.id, ...state.hiddenMedia.filter((id) => id !== item.id)].slice(0, 200)
          : state.hiddenMedia
        return { tagPreferences, creatorPreferences, hiddenMedia }
      }),
      setDiscoveryMode: (discoveryMode) => set({ discoveryMode }),
      resetDiscoveryProfile: () => set({ tagPreferences: {}, creatorPreferences: {}, hiddenMedia: [], discoveryMode: 'balanced' }),

      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),

      setGridDensity: (gridDensity) => set({ gridDensity }),
      setFontSize: (fontSize) => set({ fontSize }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setAutoplayVideos: (autoplayVideos) => set({ autoplayVideos }),
      setDefaultQuality: (defaultQuality) => set({ defaultQuality }),
      setMuteOnStart: (muteOnStart) => set({ muteOnStart }),
      setPictureInPicture: (pictureInPicture) => set({ pictureInPicture }),

      wipeLocalData: () => {
        try {
          window.localStorage.clear()
        } catch {
          // Storage can be unavailable in private contexts; state reset still applies.
        }
        set({ ...defaultDataState() })
      },
    }),
    {
      name: 'media-codex-store',
      version: 3,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<AppState>
        return { ...state, creatorWatchlist: sanitizeCreatorWatchlist(state.creatorWatchlist) } as AppState
      },
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        recentlyViewed: state.recentlyViewed,
        likeCache: state.likeCache,
        followCache: state.followCache,
        creatorWatchlist: state.creatorWatchlist,
        tagPreferences: state.tagPreferences,
        creatorPreferences: state.creatorPreferences,
        hiddenMedia: state.hiddenMedia,
        discoveryMode: state.discoveryMode,
        gridDensity: state.gridDensity,
        fontSize: state.fontSize,
        reduceMotion: state.reduceMotion,
        autoplayVideos: state.autoplayVideos,
        defaultQuality: state.defaultQuality,
        muteOnStart: state.muteOnStart,
        pictureInPicture: state.pictureInPicture,
      }),
    }
  )
)
