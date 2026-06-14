import { useEffect } from 'react'
import { useAppStore } from '@/store'
import Navbar from './Navbar'
import TopBar from './TopBar'
import Footer from './Footer'
import BottomTabBar from './BottomTabBar'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const theme = useAppStore((s) => s.theme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
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

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />

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
