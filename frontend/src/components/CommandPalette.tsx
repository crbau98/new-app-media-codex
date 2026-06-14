import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import {
  Search,
  Command,
  Compass,
  Users,
  Settings,
  BarChart3,
  MonitorPlay,
  Clock,
  TrendingUp,
  ArrowRight,
  X,
} from 'lucide-react'

interface CommandItem {
  id: string
  label: string
  shortcut?: string
  icon: typeof Search
  action: () => void
  category: string
}

export default function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const setActiveView = useAppStore((s) => s.setActiveView)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    if (open) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, setOpen])

  const navigate = useCallback(
    (path: string, view: ReturnType<typeof useAppStore.getState>['activeView']) => {
      setActiveView(view)
      window.location.hash = path
      setOpen(false)
    },
    [setActiveView, setOpen]
  )

  const items: CommandItem[] = [
    { id: 'media', label: 'Go to Media Library', icon: MonitorPlay, category: 'Navigate', action: () => navigate('#/media', 'images') },
    { id: 'explore', label: 'Go to Explore', icon: Compass, category: 'Navigate', action: () => navigate('#/explore', 'explore') },
    { id: 'creators', label: 'Go to Creators', icon: Users, category: 'Navigate', action: () => navigate('#/creators', 'creators') },
    { id: 'search', label: 'Go to Search', icon: Search, category: 'Navigate', action: () => navigate('#/search', 'search') },
    { id: 'settings', label: 'Go to Settings', icon: Settings, category: 'Navigate', action: () => navigate('#/settings', 'settings') },
    { id: 'analytics', label: 'Go to Analytics', icon: BarChart3, category: 'Navigate', action: () => navigate('#/analytics', 'analytics') },
    { id: 'theme', label: 'Toggle Theme', icon: Command, category: 'Actions', action: () => { useAppStore.getState().toggleTheme(); setOpen(false) } },
    { id: 'recent1', label: 'Recently viewed: Midnight Steam', icon: Clock, category: 'Recent', action: () => setOpen(false) },
    { id: 'trend1', label: 'Trending: Three in the Locker Room', icon: TrendingUp, category: 'Trending', action: () => setOpen(false) },
  ]

  const filtered = items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
  const grouped = filtered.reduce<Record<string, CommandItem[]>>((acc, item) => {
    acc[item.category] = acc[item.category] || []
    acc[item.category].push(item)
    return acc
  }, {})

  const flatItems = Object.values(grouped).flat()

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % flatItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + flatItems.length) % flatItems.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      flatItems[activeIndex]?.action()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[400] flex items-start justify-center pt-[15vh] bg-[var(--bg-overlay)]"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
            className="w-full max-w-[640px] mx-4 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] shadow-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
              <Search size={18} className="text-[var(--text-tertiary)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActiveIndex(0)
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search commands..."
                className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
              />
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
              >
                <X size={14} />
              </button>
            </div>

            {/* Results */}
            <div className="max-h-[50vh] overflow-y-auto hide-scrollbar py-2">
              {Object.entries(grouped).map(([category, groupItems]) => (
                <div key={category} className="mb-2">
                  <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {category}
                  </div>
                  {groupItems.map((item, _idx) => {
                    const globalIdx = flatItems.findIndex((fi) => fi.id === item.id)
                    const isActive = globalIdx === activeIndex
                    const Icon = item.icon
                    return (
                      <button
                        key={item.id}
                        onClick={item.action}
                        onMouseEnter={() => setActiveIndex(globalIdx)}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                          isActive ? 'bg-[var(--bg-surface)]' : 'hover:bg-[var(--bg-surface)]/50'
                        )}
                      >
                        <Icon size={16} className="text-[var(--text-tertiary)]" />
                        <span className="text-sm text-[var(--text-primary)] flex-1">{item.label}</span>
                        {isActive && <ArrowRight size={14} className="text-[var(--accent)]" />}
                      </button>
                    )
                  })}
                </div>
              ))}
              {flatItems.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                  No results found
                </div>
              )}
            </div>

            {/* Footer hints */}
            <div className="px-4 py-2 border-t border-[var(--border-subtle)] flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
              <span className="flex items-center gap-1">
                <kbd className="kbd">↑</kbd>
                <kbd className="kbd">↓</kbd> Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="kbd">↵</kbd> Select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="kbd">esc</kbd> Close
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
