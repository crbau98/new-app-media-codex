import { useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { useAppStore } from '@/store'
import {
  Library,
  Search,
  Users,
  Settings,
  Moon,
  Sun,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navSections = [
  {
    title: 'Library',
    items: [
      { label: 'Library', icon: Library, href: '/media' },
      { label: 'Search', icon: Search, href: '/search' },
      { label: 'Creators', icon: Users, href: '/creators' },
    ],
  },
  {
    title: 'Preferences',
    items: [
      { label: 'Settings', icon: Settings, href: '/settings' },
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
    (_label: string, href: string) => {
      navigate(href)
      onClose?.()
    },
    [navigate, onClose]
  )

  const isActive = useCallback(
    (label: string) => {
      const map: Record<string, string> = { Library: '/media', Search: '/search', Creators: '/creators', Settings: '/settings' }
      return location.pathname === map[label]
    },
    [location.pathname]
  )

  return (
    <nav
      className={cn(
        'sidebar-shell flex flex-col h-screen sticky top-0 z-50 transition-all',
        collapsed && 'collapsed'
      )}
      aria-label="Main navigation"
    >
      {/* Logo + mobile close */}
      <div className="h-14 flex items-center px-4 gap-3 shrink-0">
        <LogoMark className="w-8 h-8 text-[var(--accent)]" />
        {!collapsed && (
          <span className="font-semibold text-[15px] tracking-tight text-[var(--text-primary)] whitespace-nowrap">
            Media Codex
          </span>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden ml-auto p-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="divider-fade mx-3 shrink-0" />

      {/* Nav Sections */}
      <div className="flex-1 overflow-y-auto hide-scrollbar py-2 px-2 space-y-1">
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
                <button
                  key={item.label}
                  onClick={() => handleNav(item.label, item.href)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors relative group text-left',
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
                </button>
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
