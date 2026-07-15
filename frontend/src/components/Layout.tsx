import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import Navbar from './Navbar'
import TopBar from './TopBar'
import Footer from './Footer'
import BottomTabBar from './BottomTabBar'
import { cn } from '@/lib/utils'

const ACCENTS = {
  rose: ['#f178a9', '#ff91bd', 'rgba(241,120,169,.16)', 'rgba(241,120,169,.35)'],
  purple: ['#a78bfa', '#b8a2ff', 'rgba(167,139,250,.16)', 'rgba(167,139,250,.35)'],
  teal: ['#2dd4bf', '#5eead4', 'rgba(45,212,191,.16)', 'rgba(45,212,191,.35)'],
  amber: ['#fbbf24', '#fcd34d', 'rgba(251,191,36,.16)', 'rgba(251,191,36,.35)'],
  blue: ['#60a5fa', '#93c5fd', 'rgba(96,165,250,.16)', 'rgba(96,165,250,.35)'],
  green: ['#4ade80', '#86efac', 'rgba(74,222,128,.16)', 'rgba(74,222,128,.35)'],
} as const

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const theme = useAppStore((s) => s.theme)
  const accentColor = useAppStore((s) => s.accentColor)
  const fontSize = useAppStore((s) => s.fontSize)
  const reduceMotion = useAppStore((s) => s.reduceMotion)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const applyTheme = () => root.setAttribute('data-theme', theme === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme)
    applyTheme()
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [theme])

  useEffect(() => {
    const [accent, hover, dim, glow] = ACCENTS[accentColor]
    const root = document.documentElement
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--accent-hover', hover)
    root.style.setProperty('--accent-dim', dim)
    root.style.setProperty('--accent-glow', glow)
    root.setAttribute('data-font-size', fontSize)
    root.setAttribute('data-reduce-motion', String(reduceMotion))
  }, [accentColor, fontSize, reduceMotion])

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileSidebarOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
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
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <Navbar onClose={() => setMobileSidebarOpen(false)} />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onMenuClick={() => setMobileSidebarOpen(true)} />

        <main
          id="main-content"
          className="flex-1 pt-[calc(3.5rem+env(safe-area-inset-top))]"
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
