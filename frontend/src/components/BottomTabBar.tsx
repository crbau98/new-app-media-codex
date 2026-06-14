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
  { label: 'Library', icon: Grid3X3, href: '#/media' },
  { label: 'Explore', icon: Compass, href: '#/explore' },
  { label: 'Reels', icon: PlayCircle, href: '#/explore' },
  { label: 'Creators', icon: Users, href: '#/creators' },
  { label: 'Profile', icon: User, href: '#/settings' },
]

export default function BottomTabBar() {
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)

  const isActive = (label: string) => {
    const map: Record<string, string> = {
      Library: 'images',
      Explore: 'explore',
      Reels: 'explore',
      Creators: 'creators',
      Profile: 'settings',
    }
    return activeView === map[label]
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
            <a
              key={tab.label}
              href={tab.href}
              onClick={() => {
                const map: Record<string, ReturnType<typeof useAppStore.getState>['activeView']> = {
                  Library: 'images',
                  Explore: 'explore',
                  Reels: 'explore',
                  Creators: 'creators',
                  Profile: 'settings',
                }
                setActiveView(map[tab.label])
              }}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 w-14 py-1 rounded-lg transition-colors',
                active ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 2} />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </a>
          )
        })}
      </div>
    </nav>
  )
}
