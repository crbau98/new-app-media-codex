import { useCallback, useEffect } from 'react'
import { useAppStore } from '@/store'
import {
  Library,
  Video,
  Image,
  Heart,
  Compass,
  Search,
  Users,
  Settings,
  BarChart3,
  Bot,
  Camera,
  Moon,
  Sun,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navSections = [
  {
    title: 'Library',
    items: [
      { label: 'Media', icon: Library, href: '#/media' },
      { label: 'Videos', icon: Video, href: '#/media' },
      { label: 'Images', icon: Image, href: '#/media' },
      { label: 'Favorites', icon: Heart, href: '#/media' },
    ],
  },
  {
    title: 'Discover',
    items: [
      { label: 'Explore', icon: Compass, href: '#/explore' },
      { label: 'Search', icon: Search, href: '#/search' },
      { label: 'Creators', icon: Users, href: '#/creators' },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Settings', icon: Settings, href: '#/settings' },
      { label: 'Analytics', icon: BarChart3, href: '#/analytics' },
    ],
  },
  {
    title: 'Automation',
    items: [
      { label: 'Crawl', icon: Bot, href: '#/settings' },
      { label: 'Capture', icon: Camera, href: '#/settings' },
    ],
  },
]

function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
    >
      <rect width="32" height="32" rx="8" fill="currentColor" fillOpacity="0.1" />
      <path
        d="M10 8C10 6.89543 10.8954 6 12 6H16C19.3137 6 22 8.68629 22 12V12C22 15.3137 19.3137 18 16 18H12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M10 24C10 25.1046 10.8954 26 12 26H16C19.3137 26 22 23.3137 22 20V20C22 16.6863 19.3137 14 16 14H12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="3" fill="currentColor" />
    </svg>
  )
}

export default function Navbar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const theme = useAppStore((s) => s.theme)
  const activeView = useAppStore((s) => s.activeView)

  const setActive = useCallback(
    (label: string) => {
      const map: Record<string, string> = {
        Media: 'images',
        Videos: 'images',
        Images: 'images',
        Favorites: 'images',
        Explore: 'explore',
        Search: 'search',
        Creators: 'creators',
        Settings: 'settings',
        Analytics: 'analytics',
        Crawl: 'settings',
        Capture: 'settings',
      }
      const view = map[label] as ReturnType<typeof useAppStore.getState>['activeView']
      if (view) useAppStore.getState().setActiveView(view)
    },
    []
  )

  const isActive = useCallback(
    (label: string) => {
      const map: Record<string, string> = {
        Media: 'images',
        Videos: 'images',
        Images: 'images',
        Favorites: 'images',
        Explore: 'explore',
        Search: 'search',
        Creators: 'creators',
        Settings: 'settings',
        Analytics: 'analytics',
      }
      return activeView === map[label]
    },
    [activeView]
  )

  useEffect(() => {
    // Ensure theme attribute is set on mount
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <nav
      className={cn(
        'sidebar-shell flex flex-col h-screen sticky top-0 z-50 transition-all',
        collapsed && 'collapsed'
      )}
      aria-label="Main navigation"
    >
      {/* Logo */}
      <div className="h-14 flex items-center px-4 gap-3 shrink-0">
        <LogoMark className="w-8 h-8 text-[var(--accent)]" />
        {!collapsed && (
          <span className="font-semibold text-[15px] tracking-tight text-[var(--text-primary)] whitespace-nowrap">
            Media Codex
          </span>
        )}
      </div>

      {/* Divider */}
      <div className="divider-fade mx-3 shrink-0" />

      {/* Nav Sections */}
      <div className="flex-1 overflow-y-auto hide-scrollbar py-2 px-2 space-y-1 stagger-in">
        {navSections.map((section) => (
          <div key={section.title} className="mb-3">
            {!collapsed && (
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {section.title}
              </div>
            )}
            {section.items.map((item) => {
              const active = isActive(item.label)
              const Icon = item.icon
              return (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={() => setActive(item.label)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md transition-colors relative group',
                    active
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/50'
                  )}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                >
                  {active && (
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-[var(--accent)]"
                    />
                  )}
                  <Icon size={18} className="shrink-0" />
                  {!collapsed && (
                    <span className="text-[13px] font-medium whitespace-nowrap">
                      {item.label}
                    </span>
                  )}
                </a>
              )
            })}
          </div>
        ))}
      </div>

      {/* Bottom actions */}
      <div className="shrink-0 p-2 space-y-1 border-t border-[var(--border-subtle)]">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/50 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          {!collapsed && (
            <span className="text-[13px] font-medium">
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </span>
          )}
        </button>
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/50 transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          {!collapsed && (
            <span className="text-[13px] font-medium">Collapse</span>
          )}
        </button>
      </div>
    </nav>
  )
}
