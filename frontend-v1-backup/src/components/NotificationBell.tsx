import { useEffect, useRef } from "react"
import { useAppStore } from "../store"
import { cn } from "@/lib/cn"

interface NotificationBellProps {
  onClick?: () => void
}

export function NotificationBell({ onClick }: NotificationBellProps) {
  const unreadCount = useAppStore((s) => s.unreadCount)
  const badgeRef = useRef<HTMLSpanElement>(null)
  const prevCountRef = useRef(unreadCount)

  useEffect(() => {
    if (unreadCount > prevCountRef.current && badgeRef.current) {
      badgeRef.current.classList.remove("animate-bounce-badge")
      void badgeRef.current.offsetWidth
      badgeRef.current.classList.add("animate-bounce-badge")
    }
    prevCountRef.current = unreadCount
  }, [unreadCount])

  return (
    <button
      onClick={onClick}
      className="panel-muted relative hidden sm:flex h-8 w-8 items-center justify-center rounded-xl text-text-muted transition-colors duration-200 hover:text-text-primary"
      aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      title="Notifications"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {unreadCount > 0 && (
        <span
          ref={badgeRef}
          className={cn(
            "absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red px-1 text-[9px] font-bold text-white"
          )}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  )
}
