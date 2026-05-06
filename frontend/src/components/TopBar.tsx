import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import {
  Search,
  Bell,
  Sun,
  Moon,
  Menu,
  Command,
} from 'lucide-react'

export default function TopBar() {
  const [scrolled, setScrolled] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const theme = useAppStore((s) => s.theme)
  const toggleCommandPalette = useAppStore((s) => s.toggleCommandPalette)
  const unreadCount = useAppStore((s) => s.unreadCount)
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)

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

  return (
    <header
      className={cn(
        'topbar-shell fixed top-0 right-0 z-40 flex items-center justify-between px-4',
        scrolled && 'scrolled'
      )}
      style={{
        left: 'auto',
      }}
    >
      {/* Mobile hamburger */}
      <button
        className="md:hidden p-2 -ml-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/50"
        aria-label="Open menu"
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
          placeholder="Search media, creators, categories..."
          className="bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none w-full"
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
        />
        <span className="hidden lg:flex items-center gap-0.5 kbd shrink-0">
          <Command size={10} />K
        </span>
      </div>

      {/* Mobile search icon */}
      <button
        className="md:hidden p-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/50"
        aria-label="Search"
        onClick={() => setCommandPaletteOpen(true)}
      >
        <Search size={20} />
      </button>

      {/* Right actions */}
      <div className="flex items-center gap-1">
        <button
          className="relative p-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/50 transition-colors"
          aria-label="Notifications"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[var(--live-pulse)] animate-live-pulse" />
          )}
        </button>
        <button
          onClick={toggleTheme}
          className="hidden md:flex p-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/50 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <div className="w-8 h-8 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-xs font-semibold text-[var(--text-secondary)] ml-1">
          U
        </div>
      </div>
    </header>
  )
}
