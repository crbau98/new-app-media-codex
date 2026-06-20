import { useNavigate, useLocation } from 'react-router'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import {
  Grid3X3,
  Compass,
  PlayCircle,
  Users,
  User,
} from 'lucide-react'

const tabs = [
  { label: 'Library', icon: Grid3X3, href: '/media', view: 'images' as const },
  { label: 'Explore', icon: Compass, href: '/explore', view: 'explore' as const },
  { label: 'Reels', icon: PlayCircle, href: '/explore', view: 'explore' as const },
  { label: 'Creators', icon: Users, href: '/creators', view: 'creators' as const },
  { label: 'Profile', icon: User, href: '/settings', view: 'settings' as const },
]

export default function BottomTabBar() {
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const navigate = useNavigate()
  const location = useLocation()

  const handleTabClick = (href: string, view: typeof tabs[number]['view'], label: string) => {
    setActiveView(view)
    navigate(href)
  }

  const isActive = (label: string) => {
    const map: Record<string, string> = {
      Library: 'images',
      Explore: 'explore',
      Reels: 'explore',
      Creators: 'creators',
      Profile: 'settings',
    }
    const view = map[label]
    if (view === 'explore') {
      return location.pathname === '/explore'
    }
    return activeView === view
  }

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-[100] h-16 pb-[env(safe-area-inset-bottom)] border-t border-[var(--border-subtle)]"
      style={{
        background: 'var(--bg-base)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
      aria-label="Mobile navigation"
    >
      <div className="flex items-center justify-around h-16 px-2">
        {tabs.map((tab) => {
          const active = isActive(tab.label)
          const Icon = tab.icon
          return (
            <button
              key={tab.label}
              onClick={() => handleTabClick(tab.href, tab.view, tab.label)}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 w-14 py-1 rounded-lg transition-colors tap-highlight-none',
                active ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 2} />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
