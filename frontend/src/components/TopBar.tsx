import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import {
  Search,
  Sun,
  Moon,
  Menu,
  Command,
  X,
} from 'lucide-react'

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

  // Keyboard shortcut: Cmd/Ctrl+K for command palette, / for search focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggleCommandPalette()
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false)
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleCommandPalette, setCommandPaletteOpen])

  const handleSearchSubmit = useCallback(() => {
    if (searchQuery.trim()) {
      setAppSearchQuery(searchQuery.trim())
      navigate('/search')
    }
  }, [searchQuery, setAppSearchQuery, navigate])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearchSubmit()
    }
  }, [handleSearchSubmit])

  return (
    <header
      className={cn(
        'fixed top-0 right-0 z-40 flex items-end justify-between px-4 pb-2 h-[calc(3.5rem+env(safe-area-inset-top))]',
        'transition-all duration-200',
        scrolled
          ? 'bg-[var(--bg-base)]/80 backdrop-blur-xl border-b border-[var(--border-subtle)]'
          : 'bg-transparent'
      )}
      style={{
        left: 'var(--sidebar-width, 0px)',
      }}
    >
      {/* Mobile hamburger */}
      <button
        className="md:hidden p-2 -ml-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/50 tap-highlight-none"
        aria-label="Open menu"
        onClick={onMenuClick}
      >
        <Menu size={20} />
      </button>

      {/* Search */}
      <div
        className={cn(
          'hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all duration-200',
          searchFocused
            ? 'border-[var(--border-medium)] bg-[var(--bg-surface)] w-80'
            : 'border-[var(--border-subtle)] bg-transparent w-52'
        )}
      >
        <Search size={16} className="text-[var(--text-tertiary)] shrink-0" />
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search media, creators, categories..."
          className="bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none w-full"
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          onKeyDown={handleSearchKeyDown}
        />
        {searchQuery ? (
          <button
            onClick={() => {
              setSearchQuery('')
              searchRef.current?.focus()
            }}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] shrink-0"
          >
            <X size={14} />
          </button>
        ) : (
          <span className="hidden lg:flex items-center gap-0.5 kbd shrink-0">
            <Command size={10} />K
          </span>
        )}
      </div>

      {/* Mobile search icon */}
      <button
        className="md:hidden p-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/50 tap-highlight-none"
        aria-label="Search"
        onClick={() => navigate('/search')}
      >
        <Search size={20} />
      </button>

      {/* Right actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={toggleTheme}
          className="hidden md:flex p-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/50 transition-colors tap-highlight-none"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  )
}
