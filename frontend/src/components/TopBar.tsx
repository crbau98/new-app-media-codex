import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { Search, Sun, Moon, Menu, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'

interface TopBarProps {
  onMenuClick?: () => void
}

export default function TopBar({ onMenuClick }: TopBarProps) {
  const [scrolled, setScrolled] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const theme = useAppStore((s) => s.theme)
  const toggleCommandPalette = useAppStore((s) => s.toggleCommandPalette)
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const setAppSearchQuery = useAppStore((s) => s.setSearchQuery)

  const navigate = useNavigate()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
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
      className={cn(
        'fixed top-0 right-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between gap-3 px-4',
        'transition-colors duration-200 border-b',
        scrolled ? 'border-line bg-canvas' : 'border-transparent bg-transparent'
      )}
      style={{ left: 'var(--sidebar-width, 0px)' }}
    >
      {/* Mobile hamburger */}
      <button
        className="grid h-10 w-10 -ml-2 place-items-center rounded-md text-ink-2 hover:bg-sunken tap-highlight-none md:hidden"
        aria-label="Open menu"
        onClick={onMenuClick}
      >
        <Menu size={16} strokeWidth={1.75} />
      </button>

      {/* Search */}
      <div
        className={cn(
          'hidden md:flex h-10 items-center gap-2 rounded-md border px-3 transition-colors duration-200',
          searchFocused ? 'w-80 border-line-strong bg-elevated' : 'w-56 border-line bg-transparent'
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
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-3 hover:text-ink"
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
        className="grid h-10 w-10 place-items-center rounded-md text-ink-2 hover:bg-sunken tap-highlight-none md:hidden"
        aria-label="Search"
        onClick={() => navigate('/search')}
      >
        <Search size={16} strokeWidth={1.75} />
      </button>

      {/* Right actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={toggleTheme}
          className="hidden md:grid h-10 w-10 place-items-center rounded-md text-ink-2 hover:bg-sunken transition-colors tap-highlight-none"
          aria-label="Toggle theme"
        >
          {theme === 'light'
            ? <Moon size={16} strokeWidth={1.75} />
            : <Sun size={16} strokeWidth={1.75} />}
        </button>
      </div>
    </header>
  )
}
