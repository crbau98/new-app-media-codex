import { X, Heart, MessageCircle, UserPlus, TrendingUp, AtSign } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useEffect, useRef } from 'react'

interface Notification {
  id: number
  type: 'like' | 'comment' | 'follow' | 'trending' | 'mention'
  message: string
  read: boolean
  created_at: string
}

const ICONS: Record<string, React.FC<{ size?: number }>> = {
  like: Heart,
  comment: MessageCircle,
  follow: UserPlus,
  trending: TrendingUp,
  mention: AtSign,
}

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [onClose])

  // Mock notifications for now
  const notifications: Notification[] = [
    { id: 1, type: 'follow', message: 'New creator added to your followed list', read: false, created_at: '2024-01-15T10:00:00Z' },
    { id: 2, type: 'trending', message: 'New trending media from creators you follow', read: false, created_at: '2024-01-15T09:30:00Z' },
  ]

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-white/10 bg-[#0d1a30] shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h3 className="text-sm font-semibold text-text-primary">Notifications</h3>
        <button onClick={onClose} className="rounded p-1 text-text-muted hover:text-text-primary">
          <X size={16} />
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            No notifications yet
          </div>
        ) : (
          notifications.map((n) => {
            const Icon = ICONS[n.type] || Heart
            return (
              <div
                key={n.id}
                className={cn(
                  'flex items-start gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]',
                  !n.read && 'bg-accent/5'
                )}
              >
                <div className="mt-0.5 shrink-0 text-accent">
                  <Icon size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-text-secondary">{n.message}</p>
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    {new Date(n.created_at).toLocaleDateString()}
                  </p>
                </div>
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
