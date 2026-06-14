import { useEffect, useRef, useCallback, useState } from "react"
import { motion } from "framer-motion"
import { useAppStore } from "../store"
import { cn } from "@/lib/cn"
import { api } from "@/lib/api"
import type { AppNotification } from "../store"

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function NotificationIcon({ type }: { type: AppNotification["type"] }) {
  const base = "shrink-0 w-4 h-4"
  switch (type) {
    case "new_media_from_followed":
      return (
        <svg className={cn(base, "text-pink")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      )
    case "comment_reply":
      return (
        <svg className={cn(base, "text-blue")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      )
    case "like_on_comment":
      return (
        <svg className={cn(base, "text-red")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      )
    case "mention":
      return (
        <svg className={cn(base, "text-purple")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
        </svg>
      )
    case "trending_alert":
      return (
        <svg className={cn(base, "text-orange")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      )
    case "crawl":
      return (
        <svg className={cn(base, "text-blue")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      )
    case "capture":
      return (
        <svg className={cn(base, "text-green")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      )
    case "system":
      return (
        <svg className={cn(base, "text-purple")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      )
    default:
      return (
        <svg className={cn(base, "text-text-muted")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      )
  }
}

function notificationMessage(n: AppNotification): string {
  if (n.message) return n.message
  switch (n.type) {
    case "new_media_from_followed":
      return "New media from a creator you follow"
    case "comment_reply":
      return "New comment on a screenshot you follow"
    case "like_on_comment":
      return "Someone liked your comment"
    case "mention":
      return "You were mentioned in a comment"
    case "trending_alert":
      return "Trending alert"
    case "crawl":
      return "Crawl update"
    case "capture":
      return "Capture update"
    case "system":
      return "System notification"
    default:
      return "New notification"
  }
}

function navigateToNotification(n: AppNotification) {
  const data = n.data || {}
  if (data.screenshot_id) {
    window.dispatchEvent(
      new CustomEvent("codex:open-screenshot", {
        detail: { screenshotId: data.screenshot_id },
      })
    )
  } else if (data.performer_id) {
    window.dispatchEvent(
      new CustomEvent("codex:open-performer", {
        detail: { performerId: data.performer_id },
      })
    )
  }
}

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const notifications = useAppStore((s) => s.notifications)
  const unreadCount = useAppStore((s) => s.unreadCount)
  const setNotifications = useAppStore((s) => s.setNotifications)
  const markNotificationReadLocal = useAppStore((s) => s.markNotificationRead)
  const markAllReadLocal = useAppStore((s) => s.markAllRead)
  const panelRef = useRef<HTMLDivElement>(null)
  const [refreshing, setRefreshing] = useState(false)
  const touchStartY = useRef(0)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [onClose])

  const handleMarkRead = useCallback(
    async (id: number) => {
      try {
        await api.markNotificationRead(id)
        markNotificationReadLocal(id)
      } catch {
        // ignore
      }
    },
    [markNotificationReadLocal]
  )

  const handleMarkAllRead = useCallback(async () => {
    try {
      await api.markAllNotificationsRead()
      markAllReadLocal()
    } catch {
      // ignore
    }
  }, [markAllReadLocal])

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await api.deleteNotification(id)
        const data = await api.notifications()
        setNotifications(data.notifications, data.unread_count)
      } catch {
        // ignore
      }
    },
    [setNotifications]
  )

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const data = await api.notifications()
      setNotifications(data.notifications, data.unread_count)
    } catch {
      // ignore
    } finally {
      setTimeout(() => setRefreshing(false), 400)
    }
  }, [setNotifications])

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    const diff = e.changedTouches[0].clientY - touchStartY.current
    if (diff > 80 && panelRef.current) {
      const scrollTop = panelRef.current.querySelector("[data-scroll]")?.scrollTop || 0
      if (scrollTop <= 0) {
        handleRefresh()
      }
    }
  }

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="fixed inset-y-0 right-0 z-[60] w-full max-w-sm border-l border-border bg-bg-base shadow-2xl"
      ref={panelRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold text-text-primary">Notifications</span>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-[11px] text-accent hover:text-accent/80 transition-colors"
            >
              Mark all read
            </button>
          )}
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-white/[0.06] transition-colors"
            aria-label="Close notifications"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {/* Pull-to-refresh indicator */}
      {refreshing && (
        <div className="flex items-center justify-center py-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      )}

      {/* List */}
      <div data-scroll className="h-[calc(100%-3.5rem)] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-3 opacity-40" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span className="text-sm">No notifications yet</span>
            <span className="mt-1 text-xs opacity-60">Pull down to refresh</span>
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {notifications.map((n) => (
              <li key={n.id} className="group relative">
                <button
                  type="button"
                  onClick={() => {
                    if (!n.read) handleMarkRead(n.id)
                    navigateToNotification(n)
                    onClose()
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                    !n.read ? "bg-accent/[0.04]" : "hover:bg-bg-subtle/50"
                  )}
                >
                  <div className="mt-0.5">
                    <NotificationIcon type={n.type} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn(
                      "text-xs leading-snug",
                      n.read ? "text-text-secondary" : "text-text-primary font-medium"
                    )}>
                      {notificationMessage(n)}
                    </p>
                    <span className="mt-0.5 block text-[10px] text-text-muted">
                      {relativeTime(n.created_at)}
                    </span>
                  </div>
                  {!n.read && (
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(n.id)
                  }}
                  className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-red p-1"
                  aria-label="Delete notification"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </motion.div>
  )
}
