import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DiscoveryMode } from '@/lib/discovery'

export type Theme = 'dark' | 'light' | 'auto'
export type ViewMode = 'images' | 'explore' | 'creators' | 'search' | 'settings' | 'analytics'
export type GridDensity = 'compact' | 'normal' | 'spacious'
export type ToastType = 'success' | 'error' | 'info' | 'achievement'
export type AccentColor = 'rose' | 'purple' | 'teal' | 'amber' | 'blue' | 'green'
export type FontSize = 'small' | 'default' | 'large'
export type VideoQuality = 'auto' | '720p' | '1080p' | '4K'
export type PreferredPlayer = 'inline' | 'lightbox' | 'external'
export type DigestFrequency = 'realtime' | 'daily' | 'weekly' | 'never'
export type DiscoveryFeedback = 'view' | 'more' | 'less' | 'hide'

export interface DiscoverySignalItem {
  id: string
  creator: string
  tags: string[]
}

export const DEFAULT_CREATOR_WATCHLIST = ['Jakipz', 'Christian Hogue', 'Michael Yerger', 'SebastianCoxxx']

function creatorKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function containsEmail(value: string): boolean {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)
}

function sanitizeCreatorWatchlist(values: unknown): string[] {
  if (!Array.isArray(values)) return DEFAULT_CREATOR_WATCHLIST
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

export interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
}

export interface Notification {
  id: string
  title: string
  message: string
  read: boolean
  createdAt: string
}

export interface Filters {
  search: string
  sourceType: string | null
  sort: 'newest' | 'oldest' | 'topRated' | 'az' | 'random' | 'mostViewed'
  tag: string | null
  category: string | null
}

interface AppState {
  // Theme
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void

  // Active view
  activeView: ViewMode
  setActiveView: (view: ViewMode) => void

  // Sidebar
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void

  // Notifications
  notifications: Notification[]
  unreadCount: number
  addNotification: (n: Omit<Notification, 'id' | 'read' | 'createdAt'>) => void
  markNotificationRead: (id: string) => void
  markAllRead: () => void

  // Toasts
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => string
  removeToast: (id: string) => void

  // Search
  searchQuery: string
  setSearchQuery: (q: string) => void

  // Filters
  filters: Filters
  setFilters: (f: Partial<Filters>) => void
  resetFilters: () => void

  // Selected item
  selectedItemId: string | null
  setSelectedItemId: (id: string | null) => void

  // Recently viewed
  recentlyViewed: string[]
  addRecentlyViewed: (id: string) => void

  // Like cache
  likeCache: Record<string, boolean>
  toggleLike: (id: string) => void

  // Follow cache
  followCache: Record<string, boolean>
  toggleFollow: (id: string) => void

  // Creator radar: user-curated public-source lookups
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

  // Media creator filter
  mediaCreatorFilter: string | null
  setMediaCreatorFilter: (id: string | null) => void

  // ── Settings ──
  accentColor: AccentColor
  setAccentColor: (c: AccentColor) => void
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
  preferredPlayer: PreferredPlayer
  setPreferredPlayer: (p: PreferredPlayer) => void
  notificationsEnabled: boolean
  setNotificationsEnabled: (v: boolean) => void
  notifyNewMedia: boolean
  setNotifyNewMedia: (v: boolean) => void
  notifyCreatorUpdates: boolean
  setNotifyCreatorUpdates: (v: boolean) => void
  notifyTrending: boolean
  setNotifyTrending: (v: boolean) => void
  notifyCrawlCompleted: boolean
  setNotifyCrawlCompleted: (v: boolean) => void
  quietHoursStart: string
  setQuietHoursStart: (v: string) => void
  quietHoursEnd: string
  setQuietHoursEnd: (v: string) => void
  privateProfile: boolean
  setPrivateProfile: (v: boolean) => void
  hideActivityStatus: boolean
  setHideActivityStatus: (v: boolean) => void
  saveSearchHistory: boolean
  setSaveSearchHistory: (v: boolean) => void
  trackRecentlyViewed: boolean
  setTrackRecentlyViewed: (v: boolean) => void
  offlineCache: boolean
  setOfflineCache: (v: boolean) => void
}

const initialFilters: Filters = {
  search: '',
  sourceType: null,
  sort: 'newest',
  tag: null,
  category: null,
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      toggleTheme: () =>
        set((s) => {
          const next = s.theme === 'dark' ? 'light' : 'dark'
          document.documentElement.setAttribute('data-theme', next)
          return { theme: next }
        }),
      setTheme: (theme) => {
        let resolved = theme
        if (theme === 'auto') {
          resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        }
        document.documentElement.setAttribute('data-theme', resolved)
        set({ theme })
      },

      activeView: 'images',
      setActiveView: (activeView) => set({ activeView }),

      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

      notifications: [],
      unreadCount: 0,
      addNotification: (n) =>
        set((s) => {
          const notification: Notification = {
            ...n,
            id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
            read: false,
            createdAt: new Date().toISOString(),
          }
          return {
            notifications: [notification, ...s.notifications].slice(0, 50),
            unreadCount: s.unreadCount + 1,
          }
        }),
      markNotificationRead: (id) =>
        set((s) => {
          const notifications = s.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
          )
          const unreadCount = notifications.filter((n) => !n.read).length
          return { notifications, unreadCount }
        }),
      markAllRead: () =>
        set((s) => ({
          notifications: s.notifications.map((n) => ({ ...n, read: true })),
          unreadCount: 0,
        })),

      toasts: [],
      addToast: (toast) => {
        const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
        set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
        // Auto-dismiss after 4s
        setTimeout(() => {
          get().removeToast(id)
        }, 4000)
        return id
      },
      removeToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),

      filters: { ...initialFilters },
      setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
      resetFilters: () => set({ filters: { ...initialFilters } }),

      selectedItemId: null,
      setSelectedItemId: (selectedItemId) => set({ selectedItemId }),

      recentlyViewed: [],
      addRecentlyViewed: (id) =>
        set((s) => ({
          recentlyViewed: [id, ...s.recentlyViewed.filter((x) => x !== id)].slice(0, 20),
        })),

      likeCache: {},
      toggleLike: (id) =>
        set((s) => ({
          likeCache: { ...s.likeCache, [id]: !s.likeCache[id] },
        })),

      followCache: {},
      toggleFollow: (id) =>
        set((s) => ({
          followCache: { ...s.followCache, [id]: !s.followCache[id] },
        })),

      creatorWatchlist: DEFAULT_CREATOR_WATCHLIST,
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

      tagPreferences: {},
      creatorPreferences: {},
      hiddenMedia: [],
      discoveryMode: 'balanced',
      recordDiscoveryFeedback: (item, signal) => set((state) => {
        const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
        const delta = signal === 'more' ? 2 : signal === 'less' || signal === 'hide' ? -2 : 0.2
        const tagPreferences = { ...state.tagPreferences }
        for (const tag of item.tags.slice(0, 8)) {
          const tagKey = normalize(tag)
          if (tagKey) tagPreferences[tagKey] = Math.max(-8, Math.min(12, (tagPreferences[tagKey] || 0) + delta))
        }
        const creatorKey = normalize(item.creator)
        const creatorPreferences = { ...state.creatorPreferences }
        if (creatorKey) creatorPreferences[creatorKey] = Math.max(-5, Math.min(8, (creatorPreferences[creatorKey] || 0) + delta))
        const hiddenMedia = signal === 'hide'
          ? [item.id, ...state.hiddenMedia.filter((id) => id !== item.id)].slice(0, 200)
          : state.hiddenMedia
        return { tagPreferences, creatorPreferences, hiddenMedia }
      }),
      setDiscoveryMode: (discoveryMode) => set({ discoveryMode }),
      resetDiscoveryProfile: () => set({ tagPreferences: {}, creatorPreferences: {}, hiddenMedia: [], discoveryMode: 'balanced' }),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),

      gridDensity: 'normal',
      setGridDensity: (gridDensity) => set({ gridDensity }),

      mediaCreatorFilter: null,
      setMediaCreatorFilter: (mediaCreatorFilter) => set({ mediaCreatorFilter }),

      // ── Settings defaults ──
      accentColor: 'rose',
      setAccentColor: (accentColor) => set({ accentColor }),
      fontSize: 'default',
      setFontSize: (fontSize) => set({ fontSize }),
      reduceMotion: false,
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      autoplayVideos: false,
      setAutoplayVideos: (autoplayVideos) => set({ autoplayVideos }),
      defaultQuality: 'auto',
      setDefaultQuality: (defaultQuality) => set({ defaultQuality }),
      muteOnStart: true,
      setMuteOnStart: (muteOnStart) => set({ muteOnStart }),
      pictureInPicture: true,
      setPictureInPicture: (pictureInPicture) => set({ pictureInPicture }),
      preferredPlayer: 'lightbox',
      setPreferredPlayer: (preferredPlayer) => set({ preferredPlayer }),
      notificationsEnabled: true,
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      notifyNewMedia: true,
      setNotifyNewMedia: (notifyNewMedia) => set({ notifyNewMedia }),
      notifyCreatorUpdates: true,
      setNotifyCreatorUpdates: (notifyCreatorUpdates) => set({ notifyCreatorUpdates }),
      notifyTrending: false,
      setNotifyTrending: (notifyTrending) => set({ notifyTrending }),
      notifyCrawlCompleted: true,
      setNotifyCrawlCompleted: (notifyCrawlCompleted) => set({ notifyCrawlCompleted }),
      quietHoursStart: '22:00',
      setQuietHoursStart: (quietHoursStart) => set({ quietHoursStart }),
      quietHoursEnd: '08:00',
      setQuietHoursEnd: (quietHoursEnd) => set({ quietHoursEnd }),
      privateProfile: false,
      setPrivateProfile: (privateProfile) => set({ privateProfile }),
      hideActivityStatus: false,
      setHideActivityStatus: (hideActivityStatus) => set({ hideActivityStatus }),
      saveSearchHistory: true,
      setSaveSearchHistory: (saveSearchHistory) => set({ saveSearchHistory }),
      trackRecentlyViewed: true,
      setTrackRecentlyViewed: (trackRecentlyViewed) => set({ trackRecentlyViewed }),
      offlineCache: false,
      setOfflineCache: (offlineCache) => set({ offlineCache }),
    }),
    {
      name: 'media-codex-store',
      version: 2,
      migrate: (persisted) => {
        const state = persisted as Partial<AppState>
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
        filters: state.filters,
        accentColor: state.accentColor,
        fontSize: state.fontSize,
        reduceMotion: state.reduceMotion,
        autoplayVideos: state.autoplayVideos,
        defaultQuality: state.defaultQuality,
        muteOnStart: state.muteOnStart,
        pictureInPicture: state.pictureInPicture,
        preferredPlayer: state.preferredPlayer,
        notificationsEnabled: state.notificationsEnabled,
        notifyNewMedia: state.notifyNewMedia,
        notifyCreatorUpdates: state.notifyCreatorUpdates,
        notifyTrending: state.notifyTrending,
        notifyCrawlCompleted: state.notifyCrawlCompleted,
        quietHoursStart: state.quietHoursStart,
        quietHoursEnd: state.quietHoursEnd,
        privateProfile: state.privateProfile,
        hideActivityStatus: state.hideActivityStatus,
        saveSearchHistory: state.saveSearchHistory,
        trackRecentlyViewed: state.trackRecentlyViewed,
        offlineCache: state.offlineCache,
      }),
    }
  )
)
