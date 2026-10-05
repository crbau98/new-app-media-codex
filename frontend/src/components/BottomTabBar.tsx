import { useId } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { LayoutGroup, motion } from 'framer-motion'
import { Library, Search, Users, Settings, Sparkles } from 'lucide-react'
import { useMotionOk } from '@/hooks/useMotionOk'
import { spring } from '@/design-system/motion'
import { cn } from '@/lib/utils'

const tabs = [
  { label: 'Library', icon: Library, href: '/media' },
  { label: 'For You', icon: Sparkles, href: '/explore' },
  { label: 'Search', icon: Search, href: '/search' },
  { label: 'Creators', icon: Users, href: '/creators' },
  { label: 'Settings', icon: Settings, href: '/settings' },
]

/**
 * Floating glass dock (phones). Sits above the home indicator with a 12px
 * margin, 56px tall with 44px+ touch targets, and a shared-layout indicator.
 */
export default function BottomTabBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const motionOk = useMotionOk()
  const groupId = useId()

  return (
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] px-3 pb-[max(12px,env(safe-area-inset-bottom))] md:hidden"
      aria-label="Mobile navigation"
    >
      <LayoutGroup id={groupId}>
        <div className="glass-strong hairline-gold pointer-events-auto mx-auto flex h-16 max-w-md items-stretch justify-between rounded-[26px] px-1.5 shadow-overlay">
          {tabs.map((tab) => {
            const active = location.pathname === tab.href
            const Icon = tab.icon
            return (
              <button
                key={tab.label}
                onClick={() => navigate(tab.href)}
                data-prefetch={tab.href}
                className={cn(
                  'relative flex min-w-[52px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl tap-highlight-none transition-[color,transform] duration-300 active:scale-90',
                  active ? 'text-ink' : 'text-ink-3'
                )}
                aria-current={active ? 'page' : undefined}
              >
                {active && (
                  <motion.span
                    layoutId="dock-active"
                    transition={motionOk ? spring.indicator : { duration: 0 }}
                    className="absolute inset-x-1 inset-y-1.5 rounded-[18px] bg-gradient-to-b from-gold/[0.2] to-gold/[0.05] shadow-[inset_0_0_0_1px_var(--gold-line)]"
                    aria-hidden="true"
                  />
                )}
                <Icon size={19} strokeWidth={active ? 1.9 : 1.6} className={cn('relative transition-colors', active && 'text-gold-ink')} aria-hidden="true" />
                <span className="relative font-mono text-[9px] uppercase tracking-[0.08em]">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </LayoutGroup>
    </nav>
  )
}
