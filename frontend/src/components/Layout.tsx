import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import Navbar from './Navbar'
import TopBar from './TopBar'
import Footer from './Footer'
import BottomTabBar from './BottomTabBar'
import { cn } from '@/lib/utils'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const theme = useAppStore((s) => s.theme)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileSidebarOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [mobileSidebarOpen])

  // Listen to system theme changes when in auto mode
  useEffect(() => {
    if (theme !== 'auto') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved = mql.matches ? 'dark' : 'light'
      document.documentElement.setAttribute('data-theme', resolved)
    }
    apply()
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [theme])

  return (
    <div className="min-h-[100dvh] flex shell-bg">
      {/* Skip link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[500] focus:bg-[var(--accent)] focus:text-white focus:px-3 focus:py-2 focus:rounded-md"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar (always expanded) */}
      <div className="hidden lg:block shrink-0">
        <Navbar />
      </div>

      {/* Tablet collapsed rail */}
      <div className="hidden md:block lg:hidden shrink-0 h-screen sticky top-0 z-50 sidebar-shell collapsed">
        <Navbar />
      </div>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile sidebar drawer */}
      <div
        className={cn(
          'fixed top-0 left-0 bottom-0 z-[100] md:hidden transition-transform duration-300',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <Navbar onClose={() => setMobileSidebarOpen(false)} />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onMenuClick={() => setMobileSidebarOpen(true)} />

        <main
          id="main-content"
          className="flex-1 pt-14"
        >
          <div className="section-shell pb-24 md:pb-8">{children}</div>
        </main>

        <Footer />
      </div>

      {/* Mobile bottom tab bar */}
      <BottomTabBar />
    </div>
  )
}
