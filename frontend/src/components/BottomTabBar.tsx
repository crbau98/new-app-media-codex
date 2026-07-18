import { useNavigate, useLocation } from 'react-router'
import { Library, Search, Users, Settings, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

const tabs = [
  { label: 'Library', icon: Library, href: '/media' },
  { label: 'For You', icon: Sparkles, href: '/explore' },
  { label: 'Search', icon: Search, href: '/search' },
  { label: 'Creators', icon: Users, href: '/creators' },
  { label: 'Settings', icon: Settings, href: '/settings' },
]

export default function BottomTabBar() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[100] h-[calc(64px+env(safe-area-inset-bottom))] border-t border-line bg-canvas pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Mobile navigation"
    >
      <div className="flex h-16 items-stretch justify-around px-2">
        {tabs.map((tab) => {
          const active = location.pathname === tab.href
          const Icon = tab.icon
          return (
            <button
              key={tab.label}
              onClick={() => navigate(tab.href)}
              className={cn(
                'relative flex w-14 flex-col items-center justify-center gap-1 tap-highlight-none',
                active ? 'text-ink' : 'text-ink-3'
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              <span className="font-mono text-[9px] uppercase tracking-[0.06em]">{tab.label}</span>
              {active && (
                <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-heat" aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
