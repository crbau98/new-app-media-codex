import { useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router'
import {
  Library,
  Sparkles,
  Search,
  Users,
  Settings,
  Moon,
  Sun,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'

const navSections = [
  {
    title: 'Archive',
    items: [
      { label: 'Library', icon: Library, href: '/media' },
      { label: 'For You', icon: Sparkles, href: '/explore' },
      { label: 'Search', icon: Search, href: '/search' },
      { label: 'Creators', icon: Users, href: '/creators' },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Settings', icon: Settings, href: '/settings' },
    ],
  },
]

interface NavbarProps {
  onClose?: () => void
}

export default function Navbar({ onClose }: NavbarProps) {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const theme = useAppStore((s) => s.theme)

  const navigate = useNavigate()
  const location = useLocation()

  const handleNav = useCallback(
    (href: string) => {
      navigate(href)
      onClose?.()
    },
    [navigate, onClose]
  )

  return (
    <nav
      className={cn('sidebar-shell flex h-screen flex-col sticky top-0 z-50', collapsed && 'collapsed')}
      aria-label="Main navigation"
    >
      {/* Wordmark */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <span className="block h-2 w-2 shrink-0 bg-heat" aria-hidden="true" />
        {!collapsed && (
          <span className="text-[15px] font-bold tracking-[-0.02em] text-ink whitespace-nowrap">
            Codex
          </span>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto grid h-10 w-10 place-items-center rounded-md text-ink-2 hover:bg-sunken md:hidden"
            aria-label="Close menu"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div className="mx-3 h-px shrink-0 bg-line" />

      {/* Sections */}
      <div className="flex-1 overflow-y-auto hide-scrollbar px-2 py-3">
        {navSections.map((section) => (
          <div key={section.title} className="mb-4">
            {!collapsed && (
              <div className="px-3 pb-2 eyebrow">{section.title}</div>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = location.pathname === item.href
                const Icon = item.icon
                return (
                  <button
                    key={item.label}
                    onClick={() => handleNav(item.href)}
                    className={cn('nav-item tap-highlight-none', active && 'active')}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
                    {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom actions */}
      <div className="shrink-0 space-y-0.5 border-t border-line p-2">
        <button
          onClick={toggleTheme}
          className="nav-item tap-highlight-none"
          aria-label="Toggle theme"
        >
          {theme === 'light'
            ? <Moon size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
            : <Sun size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />}
          {!collapsed && <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>}
        </button>
        <button
          onClick={toggleSidebar}
          className="nav-item tap-highlight-none hidden md:flex"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed
            ? <ChevronRight size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
            : <ChevronLeft size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </nav>
  )
}
