import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'light' | 'auto'
export type ViewMode = 'images' | 'explore' | 'creators' | 'search' | 'settings' | 'analytics'
export type GridDensity = 'compact' | 'normal' | 'spacious'
export type ToastType = 'success' | 'error' | 'info' | 'achievement'
export type AccentColor = 'rose' | 'purple' | 'teal' | 'amber' | 'blue' | 'green'
export type FontSize = 'small' | 'default' | 'large'
export type VideoQuality = 'auto' | '720p' | '1080p' | '4K'
export type PreferredPlayer = 'inline' | 'lightbox' | 'external'
export type DigestFrequency = 'realtime' | 'daily' | 'weekly' | 'never'

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
        document.documentElement.setAttribute('data-theme', theme)
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
      autoplayVideos: true,
      setAutoplayVideos: (autoplayVideos) => set({ autoplayVideos }),
      defaultQuality: 'auto',
      setDefaultQuality: (defaultQuality) => set({ defaultQuality }),
      muteOnStart: false,
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
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        recentlyViewed: state.recentlyViewed,
        likeCache: state.likeCache,
        followCache: state.followCache,
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
