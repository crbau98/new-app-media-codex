import { create } from "zustand"
import { persist } from "zustand/middleware"

// ── Constants ────────────────────────────────────────────────────────
export type ActiveView = "images" | "performers" | "settings" | "search" | "explore"

const MAX_NOTIFICATIONS = 50

const VIEW_HASHES: Record<string, ActiveView> = {
  '#/media': 'images',
  '#/performers': 'performers',
  '#/settings': 'settings',
  '#/search': 'search',
  '#/explore': 'explore',
}

const HASH_VIEWS: Record<ActiveView, string> = {
  images: '#/media',
  performers: '#/performers',
  settings: '#/settings',
  search: '#/search',
  explore: '#/explore',
}

export function getViewFromHash(): ActiveView {
  const hash = window.location.hash || '#/media'
  return VIEW_HASHES[hash.split('?')[0]] || 'images'
}

// ── Unique ID generation ─────────────────────────────────────────────
function uniqueId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// ── Filters ──────────────────────────────────────────────────────────
export interface Filters {
  search: string
  sourceType: string
  reviewStatus: string
  savedOnly: boolean
  queuedOnly: boolean
  sort: string
  theme: string
  imageTheme: string
  compound: string
  mechanism: string
  dateFrom: string
  dateTo: string
  tag: string
  collectionId: string
  minScore: string
}

const DEFAULT_FILTERS: Filters = {
  search: "",
  sourceType: "",
  reviewStatus: "",
  savedOnly: false,
  queuedOnly: false,
  sort: "newest",
  theme: "",
  imageTheme: "",
  compound: "",
  mechanism: "",
  dateFrom: '',
  dateTo: '',
  tag: '',
  collectionId: '',
  minScore: '',
}

// ── Toast types & helpers ────────────────────────────────────────────
export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: string
  message: string
  type?: "success" | "error" | "info"
  action?: ToastAction
}

export type ThemeMode = 'dark' | 'light'

export type GridDensity = 'compact' | 'normal' | 'spacious'

export interface AppNotification {
  id: string
  message: string
  type: 'crawl' | 'capture' | 'system'
  timestamp: number
  read: boolean
}

// ── App State Interface ──────────────────────────────────────────────
interface AppState {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void

  activeView: ActiveView
  setActiveView: (view: ActiveView) => void

  selectedTheme: string | null
  setSelectedTheme: (theme: string | null) => void
  selectedSource: string | null
  setSelectedSource: (source: string | null) => void

  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void

  selectedItemIds: Set<number>
  toggleItemSelection: (id: number) => void
  clearItemSelection: () => void

  crawlRunning: boolean
  setCrawlRunning: (running: boolean) => void
  screenshotRunning: boolean
  setScreenshotRunning: (running: boolean) => void

  filters: Filters
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void
  resetFilters: () => void

  // Drawer
  selectedItemId: number | null
  setSelectedItemId: (id: number | null) => void

  // Toasts
  toasts: Toast[]
  addToast: (message: string, type?: Toast["type"], action?: ToastAction) => void
  removeToast: (id: string) => void

  // Notifications
  notifications: AppNotification[]
  unreadCount: number
  addNotification: (msg: string, type: AppNotification['type']) => void
  markNotificationRead: (id: string) => void
  markAllRead: () => void
  clearNotifications: () => void

  // Connectivity
  isOnline: boolean
  setOnline: (v: boolean) => void
  apiUnreachable: boolean
  setApiUnreachable: (v: boolean) => void

  // Sidebar
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  mobileNavOpen: boolean
  setMobileNavOpen: (v: boolean) => void

  // Grid density
  gridDensity: GridDensity
  setGridDensity: (v: GridDensity) => void

  // Creator media filter
  mediaCreatorId: number | null
  mediaCreatorName: string | null
  setMediaCreator: (id: number | null, name?: string | null) => void

  // Deep-link to a performer profile
  pendingPerformerId: number | null
  setPendingPerformer: (id: number | null) => void

  // Recently viewed screenshot IDs
  recentlyViewed: number[]
  addRecentlyViewed: (id: number) => void
  clearRecentlyViewed: () => void

  // Engagement cache
  likeCache: Map<number, { liked: boolean; count: number }>
  setLiked: (shotId: number, liked: boolean, count?: number) => void
  updateLikeCount: (shotId: number, count: number) => void

  // Follow cache
  followCache: Map<number, boolean>
  setFollowing: (performerId: number, following: boolean) => void

  // Search
  searchQuery: string
  setSearchQuery: (query: string) => void
}

// ── Theme helpers ────────────────────────────────────────────────────
function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme
}

// ── Persisted preferences ────────────────────────────────────────────
function getPersistedTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem('app-preferences')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?.state?.theme === 'dark' || parsed?.state?.theme === 'light') {
        return parsed.state.theme
      }
    }
  } catch { /* ignore */ }
  return 'dark'
}

// ── Store ────────────────────────────────────────────────────────────
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: getPersistedTheme(),
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      toggleTheme: () =>
        set((s) => {
          const next: ThemeMode = s.theme === 'dark' ? 'light' : 'dark'
          applyTheme(next)
          return { theme: next }
        }),

      activeView: getViewFromHash(),
      setActiveView: (activeView) => {
        window.location.hash = HASH_VIEWS[activeView] || '#/media'
        set({ activeView })
      },

      selectedTheme: null,
      setSelectedTheme: (selectedTheme) => set({ selectedTheme }),
      selectedSource: null,
      setSelectedSource: (selectedSource) => set({ selectedSource }),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),

      selectedItemIds: new Set(),
      toggleItemSelection: (id) =>
        set((s) => {
          const next = new Set(s.selectedItemIds)
          next.has(id) ? next.delete(id) : next.add(id)
          return { selectedItemIds: next }
        }),
      clearItemSelection: () => set({ selectedItemIds: new Set() }),

      crawlRunning: false,
      setCrawlRunning: (crawlRunning) => set({ crawlRunning }),
      screenshotRunning: false,
      setScreenshotRunning: (screenshotRunning) => set({ screenshotRunning }),

      filters: { ...DEFAULT_FILTERS },
      setFilter: (key, value) =>
        set((s) => ({ filters: { ...s.filters, [key]: value } })),
      resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),

      // Drawer
      selectedItemId: null,
      setSelectedItemId: (selectedItemId) => set({ selectedItemId }),

      // Toasts – capped at 3 visible, deduplication built in
      toasts: [],
      addToast: (message, type = "success", action) =>
        set((s) => {
          if (s.toasts.some((t) => t.message === message)) return {}
          const newToast: Toast = { id: uniqueId(), message, type, action }
          const next = [...s.toasts, newToast]
          return { toasts: next.length > 3 ? next.slice(next.length - 3) : next }
        }),
      removeToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      // Notifications
      notifications: [],
      unreadCount: 0,
      notificationPanelOpen: false,
      setNotificationPanelOpen: (notificationPanelOpen) => set({ notificationPanelOpen }),
      setNotifications: (notifications, unreadCount) => set({ notifications, unreadCount }),
      addLocalNotification: (n) =>
        set((s) => {
          const next = [n, ...s.notifications].slice(0, MAX_NOTIFICATIONS)
          return { notifications: next, unreadCount: s.unreadCount + (n.read ? 0 : 1) }
        }),
      markNotificationRead: (id) =>
        set((s) => {
          const next = s.notifications.map((n) =>
            n.id === id ? { ...n, read: 1 } : n
          )
          return { notifications: next, unreadCount: next.filter((x) => !x.read).length }
        }),
      markAllRead: () =>
        set((s) => {
          const next = s.notifications.map((n) => ({ ...n, read: 1 }))
          return { notifications: next, unreadCount: 0 }
        }),
      clearNotifications: () => {
        set({ notifications: [], unreadCount: 0 })
      },

      // Connectivity – listeners registered below
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      setOnline: (isOnline) => set({ isOnline }),
      apiUnreachable: false,
      setApiUnreachable: (apiUnreachable) => set({ apiUnreachable }),

      // Sidebar
      sidebarCollapsed: false,
      setSidebarCollapsed: (sidebarCollapsed) => {
        set({ sidebarCollapsed })
      },
      mobileNavOpen: false,
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),

      // Grid density
      gridDensity: 'normal',
      setGridDensity: (gridDensity) => set({ gridDensity }),

      // Creator media filter
      mediaCreatorId: null,
      mediaCreatorName: null,
      setMediaCreator: (id, name = null) =>
        set({ mediaCreatorId: id, mediaCreatorName: name }),

      // Deep-link to a performer profile
      pendingPerformerId: null,
      setPendingPerformer: (id) => set({ pendingPerformerId: id }),

      // Recently viewed
      recentlyViewed: [],
      addRecentlyViewed: (id) =>
        set((s) => ({
          recentlyViewed: [id, ...s.recentlyViewed.filter((x) => x !== id)].slice(0, 30),
        })),
      clearRecentlyViewed: () => set({ recentlyViewed: [] }),

      // Engagement cache
      likeCache: new Map(),
      setLiked: (shotId, liked, count) =>
        set((s) => {
          const next = new Map(s.likeCache)
          const existing = next.get(shotId)
          next.set(shotId, { liked, count: count ?? existing?.count ?? 0 })
          return { likeCache: next }
        }),
      updateLikeCount: (shotId, count) =>
        set((s) => {
          const next = new Map(s.likeCache)
          const existing = next.get(shotId)
          next.set(shotId, { liked: existing?.liked ?? false, count })
          return { likeCache: next }
        }),

      // Follow cache
      followCache: new Map(),
      setFollowing: (performerId, following) =>
        set((s) => {
          const next = new Map(s.followCache)
          next.set(performerId, following)
          return { followCache: next }
        }),

      // Search
      searchQuery: "",
      setSearchQuery: (searchQuery) => set({ searchQuery }),
    }),
    {
      name: 'app-preferences',
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        gridDensity: state.gridDensity,
        recentlyViewed: state.recentlyViewed,
      }),
    }
  )
)

// Apply theme on load
applyTheme(useAppStore.getState().theme)

// ── Side-effects: online/offline listeners ───────────────────────────
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => useAppStore.getState().setOnline(true))
  window.addEventListener('offline', () => useAppStore.getState().setOnline(false))
}
