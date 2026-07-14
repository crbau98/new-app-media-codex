import { useNavigate, useLocation } from 'react-router'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import {
  Grid3X3,
  Search,
  Users,
  Settings,
  Sparkles,
} from 'lucide-react'

const tabs = [
  { label: 'Library', icon: Grid3X3, href: '/media', view: 'images' as const },
  { label: 'For You', icon: Sparkles, href: '/explore', view: 'explore' as const },
  { label: 'Search', icon: Search, href: '/search', view: 'search' as const },
  { label: 'Creators', icon: Users, href: '/creators', view: 'creators' as const },
  { label: 'Settings', icon: Settings, href: '/settings', view: 'settings' as const },
]

export default function BottomTabBar() {
  const setActiveView = useAppStore((s) => s.setActiveView)
  const navigate = useNavigate()
  const location = useLocation()

  const handleTabClick = (href: string, view: typeof tabs[number]['view']) => {
    setActiveView(view)
    navigate(href)
  }

  const isActive = (label: string) => location.pathname === tabs.find((tab) => tab.label === label)?.href

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-[100] h-[calc(64px+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] border-t border-[var(--border-subtle)]"
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
              onClick={() => handleTabClick(tab.href, tab.view)}
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
