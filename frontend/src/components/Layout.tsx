import { useEffect, useState, useSyncExternalStore } from 'react'
import { CloudOff } from 'lucide-react'
import { useAppStore } from '@/store'
import Navbar from './Navbar'
import TopBar from './TopBar'
import Footer from './Footer'
import BottomTabBar from './BottomTabBar'
import { cn } from '@/lib/utils'

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
}

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const theme = useAppStore((s) => s.theme)
  const fontSize = useAppStore((s) => s.fontSize)
  const reduceMotion = useAppStore((s) => s.reduceMotion)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const online = useOnline()

  // Single source of truth for theme application (store holds preference,
  // Layout resolves 'auto' and tracks the OS setting).
  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved = theme === 'auto' ? (media.matches ? 'dark' : 'light') : theme
      root.setAttribute('data-theme', resolved)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-font-size', fontSize)
    root.setAttribute('data-reduce-motion', String(reduceMotion))
  }, [fontSize, reduceMotion])

  // Lock body scroll while the mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileSidebarOpen ? 'hidden' : ''
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileSidebarOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileSidebarOpen])

  return (
    <div className="min-h-dvh flex shell-bg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[500] focus:bg-heat focus:text-canvas focus:px-3 focus:py-2 focus:rounded-md focus:font-mono focus:text-xs"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <div className="hidden lg:block shrink-0">
        <Navbar />
      </div>

      {/* Tablet collapsed rail */}
      <div className="hidden md:block lg:hidden shrink-0 h-dvh sticky top-0 z-50 sidebar-shell collapsed">
        <Navbar />
      </div>

      {/* Mobile sidebar overlay + drawer */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-[90] bg-scrim md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <div
        className={cn(
          'fixed top-0 left-0 bottom-0 z-[100] md:hidden transition-transform duration-300 ease-out-expo',
          'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        aria-hidden={!mobileSidebarOpen}
        inert={!mobileSidebarOpen}
      >
        <Navbar onClose={() => setMobileSidebarOpen(false)} />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onMenuClick={() => setMobileSidebarOpen(true)} />

        {!online && (
          <div
            role="status"
            className="fixed top-[calc(3.5rem+env(safe-area-inset-top))] left-0 right-0 z-40 flex items-center justify-center gap-2 border-b border-line bg-sunken px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-2"
            style={{ left: 'var(--sidebar-width, 0px)' }}
          >
            <CloudOff size={14} aria-hidden="true" />
            Offline — showing the last synced archive
          </div>
        )}

        <main
          id="main-content"
          className="flex-1 pt-[calc(3.5rem+env(safe-area-inset-top))]"
        >
          <div className="section-shell pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-8">{children}</div>
        </main>

        <Footer />
      </div>

      <BottomTabBar />
    </div>
  )
}
