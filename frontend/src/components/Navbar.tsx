import { useCallback, useId } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { LayoutGroup, motion } from 'framer-motion'
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
import { useMotionOk } from '@/hooks/useMotionOk'
import { spring } from '@/design-system/motion'
import BrandMark from '@/components/chrome/BrandMark'
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
  /** Render the icon rail regardless of the persisted preference (tablet). */
  forceCollapsed?: boolean
}

export default function Navbar({ onClose, forceCollapsed = false }: NavbarProps) {
  const storeCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const collapsed = forceCollapsed || storeCollapsed
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const theme = useAppStore((s) => s.theme)
  const motionOk = useMotionOk()
  // The rail is mounted several times (desktop / tablet / drawer); each gets its
  // own layout group so the shared active-pill never flies between instances.
  const groupId = useId()

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
      className={cn(
        'sidebar-shell flex flex-col sticky top-0 z-50',
        // In the mobile drawer the container already reserves the safe-area
        // insets, so the nav fills it; standalone it owns the full viewport.
        onClose ? 'h-full' : 'h-dvh',
        collapsed && 'collapsed'
      )}
      aria-label="Main navigation"
    >
      {/* Brand */}
      <div className={cn('flex h-16 shrink-0 items-center gap-2.5', collapsed ? 'justify-center px-2' : 'px-5')}>
        <button
          onClick={() => handleNav('/media')}
          className="tap-highlight-none rounded-md"
          aria-label="Media Codex — Library"
        >
          <BrandMark size={30} wordmark={!collapsed} />
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto grid h-11 w-11 place-items-center rounded-full text-ink-2 hover:bg-sunken md:hidden"
            aria-label="Close menu"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div className="hairline-gold-x mx-4 shrink-0" />

      {/* Sections */}
      <LayoutGroup id={groupId}>
        <div className="flex-1 overflow-y-auto hide-scrollbar px-3 py-4">
          {navSections.map((section) => (
            <div key={section.title} className="mb-5">
              {!collapsed && (
                <div className="px-3 pb-2 eyebrow">{section.title}</div>
              )}
              <div className="space-y-1">
                {section.items.map((item) => {
                  const active = location.pathname === item.href
                  const Icon = item.icon
                  return (
                    <button
                      key={item.label}
                      onClick={() => handleNav(item.href)}
                      data-prefetch={item.href}
                      className={cn('nav-item tap-highlight-none', collapsed && 'justify-center px-0', active && 'active')}
                      aria-current={active ? 'page' : undefined}
                      title={collapsed ? item.label : undefined}
                      aria-label={collapsed ? item.label : undefined}
                    >
                      {active && (
                        <motion.span
                          layoutId="nav-active-pill"
                          transition={motionOk ? spring.indicator : { duration: 0 }}
                          className="absolute inset-0 rounded-[inherit] bg-gradient-to-r from-gold/[0.16] via-gold/[0.06] to-transparent shadow-[inset_0_0_0_1px_var(--gold-line)]"
                          aria-hidden="true"
                        >
                          <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-gold shadow-[0_0_10px_rgb(var(--gold)/0.8)]" />
                        </motion.span>
                      )}
                      <Icon size={17} strokeWidth={1.6} className={cn('relative shrink-0 transition-colors', active && 'text-gold-ink')} aria-hidden="true" />
                      {!collapsed && <span className="relative whitespace-nowrap">{item.label}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </LayoutGroup>

      {/* Bottom actions */}
      <div className="shrink-0 space-y-1 border-t border-line p-3">
        <button
          onClick={toggleTheme}
          className={cn('nav-item tap-highlight-none', collapsed && 'justify-center px-0')}
          aria-label="Toggle theme"
        >
          {theme === 'light'
            ? <Moon size={17} strokeWidth={1.6} className="shrink-0" aria-hidden="true" />
            : <Sun size={17} strokeWidth={1.6} className="shrink-0" aria-hidden="true" />}
          {!collapsed && <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>}
        </button>
        <button
          onClick={toggleSidebar}
          className={cn('nav-item tap-highlight-none hidden md:flex', collapsed && 'justify-center px-0')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed
            ? <ChevronRight size={17} strokeWidth={1.6} className="shrink-0" aria-hidden="true" />
            : <ChevronLeft size={17} strokeWidth={1.6} className="shrink-0" aria-hidden="true" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </nav>
  )
}
