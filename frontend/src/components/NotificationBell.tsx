import { Bell } from 'lucide-react'
import { cn } from '@/lib/cn'

export function NotificationBell({ onClick, unreadCount = 0 }: { onClick?: () => void; unreadCount?: number }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative rounded-lg p-2 text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary",
      )}
      aria-label="Notifications"
    >
      <Bell size={20} />
      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}
