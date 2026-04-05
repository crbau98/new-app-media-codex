import { create } from "zustand"

// ── Constants ────────────────────────────────────────────────────────
export type ActiveView = "overview" | "items" | "images" | "hypotheses" | "graph" | "performers" | "settings"

const STORAGE_KEYS = {
  NOTIFICATIONS: 'codex_notifications',
  THEME: 'theme',
  ACCENT: 'accent-color',
  ONBOARDING: 'onboarding_complete',
  SIDEBAR: 'codex_sidebar_collapsed',
} as const

const MAX_NOTIFICATIONS = 50
const NOTIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const PERSIST_DEBOUNCE_MS = 500

const VIEW_HASHES: Record<string, ActiveView> = {
  '#/overview': 'overview',
  '#/media': 'images',
  '#/performers': 'performers',
  '#/settings': 'settings',
  '#/items': 'images',
  '#/hypotheses': 'images',
  '#/graph': 'images',
}

const HASH_VIEWS: Record<ActiveView, string> = {
  overview: '#/overview',
  items: '#/media',
  images: '#/media',
  hypotheses: '#/media',
  graph: '#/media',
  performers: '#/performers',
  settings: '#/settings',
}

export function getViewFromHash(): ActiveView {
  const hash = window.location.hash || '#/media'
  return VIEW_HASHES[hash.split('?')[0]] || 'images'
}

// ── Safe localStorage helpers ────────────────────────────────────────
function safeGetItem(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function safeSetItem(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* quota exceeded or unavailable */ }
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

// ── Notification types & helpers ─────────────────────────────────────
export interface Notification {
  id: string
  message: string
  type: 'crawl' | 'capture' | 'hypothesis' | 'system'
  timestamp: number
  read: boolean
}

function isValidNotification(n: unknown): n is Notification {
  if (!n || typeof n !== 'object') return false
  const obj = n as Record<string, unknown>
  return typeof obj.id === 'string' &&
    typeof obj.message === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.timestamp === 'number' &&
    typeof obj.read === 'boolean'
}

function loadNotifications(): Notification[] {
  try {
    const raw = safeGetItem(STORAGE_KEYS.NOTIFICATIONS)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const now = Date.now()
    return parsed
      .filter(isValidNotification)
      .filter(n => now - n.timestamp < NOTIFICATION_TTL_MS)
      .slice(0, MAX_NOTIFICATIONS)
  } catch {
    return []
  }
}

// Debounced persistence to avoid blocking the main thread
let _persistTimer: ReturnType<typeof setTimeout> | null = null
function persistNotifications(notifications: Notification[]) {
  if (_persistTimer) clearTimeout(_persistTimer)
  _persistTimer = setTimeout(() => {
    safeSetItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)))
    _persistTimer = null
  }, PERSIST_DEBOUNCE_MS)
}

// ── Toast types ──────────────────────────────────────────────────────
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
  notifications: Notification[]
  addNotification: (msg: string, type: Notification['type']) => void
  markNotificationRead: (id: string) => void
  markAllRead: () => void
  clearNotifications: () => void
  unreadCount: () => number

  // Connectivity
  isOnline: boolean
  setOnline: (v: boolean) => void

  // Sidebar
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  mobileNavOpen: boolean
  setMobileNavOpen: (v: boolean) => void

  // Creator media filter
  mediaCreatorId: number | null
  mediaCreatorName: string | null
  setMediaCreator: (id: number | null, name?: string | null) => void

  // Deep-link to a performer profile
  pendingPerformerId: number | null
  setPendingPerformer: (id: number | null) => void
}

// ── Theme helpers ────────────────────────────────────────────────────
function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme
  safeSetItem(STORAGE_KEYS.THEME, theme)
}

// ── Store ────────────────────────────────────────────────────────────
export const useAppStore = create<AppState>((set) => ({
  theme: (safeGetItem(STORAGE_KEYS.THEME) as ThemeMode) || 'dark',
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

  // Notifications – with debounced persistence, TTL cleanup, and validation
  notifications: loadNotifications(),
  addNotification: (message, type) =>
    set((s) => {
      const n: Notification = {
        id: uniqueId(),
        message,
        type,
        timestamp: Date.now(),
        read: false,
      }
      const next = [n, ...s.notifications].slice(0, MAX_NOTIFICATIONS)
      persistNotifications(next)
      return { notifications: next }
    }),
  markNotificationRead: (id) =>
    set((s) => {
      const next = s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      )
      persistNotifications(next)
      return { notifications: next }
    }),
  markAllRead: () =>
    set((s) => {
      const next = s.notifications.map((n) => ({ ...n, read: true }))
      persistNotifications(next)
      return { notifications: next }
    }),
  clearNotifications: () => {
    persistNotifications([])
    set({ notifications: [] })
  },
  unreadCount: (): number => {
    return useAppStore.getState().notifications.filter((n) => !n.read).length
  },

  // Connectivity – listeners registered below
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  setOnline: (isOnline) => set({ isOnline }),

  // Sidebar – persisted to localStorage
  sidebarCollapsed: safeGetItem(STORAGE_KEYS.SIDEBAR) === 'true',
  setSidebarCollapsed: (sidebarCollapsed) => {
    safeSetItem(STORAGE_KEYS.SIDEBAR, String(sidebarCollapsed))
    set({ sidebarCollapsed })
  },
  mobileNavOpen: false,
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),

  // Creator media filter
  mediaCreatorId: null,
  mediaCreatorName: null,
  setMediaCreator: (id, name = null) =>
    set({ mediaCreatorId: id, mediaCreatorName: name }),

  // Deep-link to a performer profile
  pendingPerformerId: null,
  setPendingPerformer: (id) => set({ pendingPerformerId: id }),
}))

// ── Side-effects: online/offline listeners ───────────────────────────
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => useAppStore.getState().setOnline(true))
  window.addEventListener('offline', () => useAppStore.getState().setOnline(false))
}
