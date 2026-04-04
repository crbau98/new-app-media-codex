import { create } from "zustand"

export type ActiveView = "overview" | "items" | "images" | "hypotheses" | "graph" | "performers" | "settings"

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

export interface Notification {
  id: string
  message: string
  type: 'crawl' | 'capture' | 'hypothesis' | 'system'
  timestamp: number
  read: boolean
}

const NOTIFICATIONS_KEY = 'codex_notifications'
const MAX_NOTIFICATIONS = 50

function loadNotifications(): Notification[] {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, MAX_NOTIFICATIONS) : []
  } catch {
    return []
  }
}

function persistNotifications(notifications: Notification[]) {
  localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)))
}

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
  // Creator media filter (set when navigating from performer card)
  mediaCreatorId: number | null
  mediaCreatorName: string | null
  setMediaCreator: (id: number | null, name?: string | null) => void
  // Deep-link to a performer profile (set before navigating to performers view)
  pendingPerformerId: number | null
  setPendingPerformer: (id: number | null) => void
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem('theme', theme)
}

export const useAppStore = create<AppState>((set) => ({
  theme: (localStorage.getItem('theme') as ThemeMode) || 'dark',
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },
  toggleTheme: () => set((s) => {
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
  toggleItemSelection: (id) => set((s) => {
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
  setFilter: (key, value) => set((s) => ({ filters: { ...s.filters, [key]: value } })),
  resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),
  // Drawer
  selectedItemId: null,
  setSelectedItemId: (selectedItemId) => set({ selectedItemId }),
  // Toasts
  toasts: [],
  addToast: (message, type = "success", action) => set((s) => {
    // Deduplicate: skip if same message already queued
    if (s.toasts.some((t) => t.message === message)) return {}
    const newToast: Toast = { id: `${Date.now()}-${Math.random()}`, message, type, action }
    const next = [...s.toasts, newToast]
    // Cap at 3 visible toasts (drop oldest)
    return { toasts: next.length > 3 ? next.slice(next.length - 3) : next }
  }),
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  // Notifications
  notifications: loadNotifications(),
  addNotification: (message, type) => set((s) => {
    const n: Notification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message,
      type,
      timestamp: Date.now(),
      read: false,
    }
    const next = [n, ...s.notifications].slice(0, MAX_NOTIFICATIONS)
    persistNotifications(next)
    return { notifications: next }
  }),
  markNotificationRead: (id) => set((s) => {
    const next = s.notifications.map((n) => n.id === id ? { ...n, read: true } : n)
    persistNotifications(next)
    return { notifications: next }
  }),
  markAllRead: () => set((s) => {
    const next = s.notifications.map((n) => ({ ...n, read: true }))
    persistNotifications(next)
    return { notifications: next }
  }),
  clearNotifications: () => {
    persistNotifications([])
    set({ notifications: [] })
  },
  unreadCount: (): number => {
    const state = useAppStore.getState()
    return (state.notifications as Notification[]).filter((n: Notification) => !n.read).length
  },
  // Connectivity
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  setOnline: (isOnline) => set({ isOnline }),
  // Sidebar
  sidebarCollapsed: false,
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  mobileNavOpen: false,
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  // Creator media filter
  mediaCreatorId: null,
  mediaCreatorName: null,
  setMediaCreator: (id, name = null) => set({ mediaCreatorId: id, mediaCreatorName: name }),
  // Deep-link to a performer profile
  pendingPerformerId: null,
  setPendingPerformer: (id) => set({ pendingPerformerId: id }),
}))
