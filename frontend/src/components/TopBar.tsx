import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { Search, Sun, Moon, Menu, X } from 'lucide-react'
import { useAppStore } from '@/store'
import BrandMark from '@/components/chrome/BrandMark'
import { cn } from '@/lib/utils'

interface TopBarProps {
  onMenuClick?: () => void
}

const routeNames: Record<string, string> = {
  '/media': 'Library',
  '/explore': 'For You',
  '/search': 'Search',
  '/creators': 'Creators',
  '/settings': 'Settings',
}

export default function TopBar({ onMenuClick }: TopBarProps) {
  const [scrolled, setScrolled] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const theme = useAppStore((s) => s.theme)
  const toggleCommandPalette = useAppStore((s) => s.toggleCommandPalette)
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const setAppSearchQuery = useAppStore((s) => s.setSearchQuery)

  const navigate = useNavigate()
  const location = useLocation()
  const pageName = routeNames[location.pathname]

  // Condense past 8px; drive the spectrum progress hairline through a CSS
  // variable (no re-render per scroll tick).
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const y = window.scrollY
      setScrolled((prev) => (prev === y > 8 ? prev : y > 8))
      const max = document.documentElement.scrollHeight - window.innerHeight
      headerRef.current?.style.setProperty('--scroll-p', max > 0 ? String(Math.min(1, y / max)) : '0')
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  // Global keyboard shortcuts: ⌘K palette, / search focus, T theme, Esc close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggleCommandPalette()
        return
      }
      if (typing) {
        if (e.key === 'Escape') (target as HTMLInputElement).blur()
        return
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        toggleTheme()
      } else if (e.key === 'Escape') {
        setCommandPaletteOpen(false)
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleCommandPalette, setCommandPaletteOpen, toggleTheme])

  const handleSearchSubmit = useCallback(() => {
    const q = searchQuery.trim()
    if (q) {
      setAppSearchQuery(q)
      navigate(`/search?q=${encodeURIComponent(q)}`)
      setSearchQuery('')
    }
  }, [searchQuery, setAppSearchQuery, navigate])

  return (
    <header
      ref={headerRef}
      className={cn(
        'fixed top-0 right-0 z-40 flex items-center gap-3 px-3 md:px-8',
        'pt-[env(safe-area-inset-top)] transition-[height,background-color,border-color,box-shadow] duration-300 ease-out-expo',
        scrolled
          ? 'glass-strong h-[calc(3.5rem+env(safe-area-inset-top))] border-x-0 border-t-0'
          : 'h-[calc(4rem+env(safe-area-inset-top))] border-b border-transparent bg-transparent',
      )}
      style={{ left: 'var(--sidebar-width, 0px)' }}
    >
      {/* Mobile hamburger */}
      <button
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-sunken/70 active:scale-90 transition-transform tap-highlight-none md:hidden"
        aria-label="Open menu"
        onClick={onMenuClick}
      >
        <Menu size={18} strokeWidth={1.6} />
      </button>

      {/* Mobile brand */}
      <div className="flex flex-1 justify-center md:hidden" aria-hidden="true">
        <BrandMark size={24} wordmark animated={false} />
      </div>

      {/* Desktop page title */}
      <div className="hidden min-w-0 flex-1 md:block">
        {pageName && (
          <p className="truncate font-display text-[22px] font-normal leading-none tracking-[-0.02em] text-ink">
            {pageName}
          </p>
        )}
      </div>

      {/* Search */}
      <div
        className={cn(
          'hidden md:flex h-11 items-center gap-2.5 rounded-full border px-4 transition-[width,border-color,background-color,box-shadow] duration-300 ease-out-expo',
          searchFocused
            ? 'w-[26rem] border-gold-line bg-elevated shadow-[0_0_0_4px_var(--gold-dim)]'
            : 'w-64 border-glass-line bg-glass backdrop-blur-md hover:border-line-strong'
        )}
      >
        <Search size={16} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden="true" />
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search the archive"
          aria-label="Search media and creators"
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearchSubmit()
          }}
        />
        {searchQuery ? (
          <button
            onClick={() => {
              setSearchQuery('')
              searchRef.current?.focus()
            }}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-ink-3 hover:text-ink"
            aria-label="Clear search"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        ) : (
          <span className="hidden lg:flex shrink-0 items-center gap-1" aria-hidden="true">
            <kbd className="kbd">⌘K</kbd>
          </span>
        )}
      </div>

      {/* Mobile search */}
      <button
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-sunken/70 active:scale-90 transition-transform tap-highlight-none md:hidden"
        aria-label="Search"
        onClick={() => navigate('/search')}
      >
        <Search size={18} strokeWidth={1.6} />
      </button>

      {/* Right actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={toggleTheme}
          className="hidden md:grid h-11 w-11 place-items-center rounded-full border border-transparent text-ink-2 transition-[color,border-color,transform] duration-300 hover:border-gold-line hover:text-ink active:scale-90 tap-highlight-none"
          aria-label="Toggle theme"
        >
          {theme === 'light'
            ? <Moon size={17} strokeWidth={1.6} />
            : <Sun size={17} strokeWidth={1.6} />}
        </button>
      </div>

      <span className={cn('scroll-progress transition-opacity duration-300', scrolled ? 'opacity-90' : 'opacity-0')} aria-hidden="true" />
    </header>
  )
}
