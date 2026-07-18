import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  Compass,
  Users,
  Settings,
  MonitorPlay,
  Moon,
  Play,
  UserRound,
  ArrowRight,
  X,
} from 'lucide-react'
import { fetchLiveDiscovery } from '@/lib/api'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'

interface CommandItem {
  id: string
  label: string
  hint?: string
  icon: typeof Search
  action: () => void
  category: string
}

export default function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const creatorWatchlist = useAppStore((s) => s.creatorWatchlist)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Live results ride the same cache as the pages; fetched lazily on first open.
  const { data: discovery } = useQuery({
    queryKey: ['live-discovery', creatorWatchlist],
    queryFn: () => fetchLiveDiscovery(creatorWatchlist),
    enabled: open,
  })

  // Reset the input whenever the palette opens (render-phase adjustment).
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setQuery('')
      setActiveIndex(0)
    }
  }

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, setOpen])

  const go = useCallback(
    (path: string) => {
      navigate(path)
      setOpen(false)
    },
    [navigate, setOpen]
  )

  const items = useMemo<CommandItem[]>(() => {
    const needle = query.trim().toLowerCase()
    const staticCommands: CommandItem[] = [
      { id: 'nav-media', label: 'Go to Library', icon: MonitorPlay, category: 'Navigate', action: () => go('/media') },
      { id: 'nav-explore', label: 'Go to For You', icon: Compass, category: 'Navigate', action: () => go('/explore') },
      { id: 'nav-creators', label: 'Go to Creators', icon: Users, category: 'Navigate', action: () => go('/creators') },
      { id: 'nav-search', label: 'Go to Search', icon: Search, category: 'Navigate', action: () => go('/search') },
      { id: 'nav-settings', label: 'Go to Settings', icon: Settings, category: 'Navigate', action: () => go('/settings') },
      {
        id: 'action-theme',
        label: 'Toggle theme',
        hint: 'T',
        icon: Moon,
        category: 'Actions',
        action: () => {
          useAppStore.getState().toggleTheme()
          setOpen(false)
        },
      },
    ]

    if (!needle) return staticCommands

    const mediaResults: CommandItem[] = (discovery?.items ?? [])
      .filter((item) =>
        item.title.toLowerCase().includes(needle) ||
        item.creator.toLowerCase().includes(needle) ||
        item.tags.some((tag) => tag.toLowerCase().includes(needle))
      )
      .slice(0, 5)
      .map((item) => ({
        id: `media-${item.id}`,
        label: item.title,
        hint: item.source,
        icon: Play,
        category: 'Media',
        action: () => {
          setSearchQuery(item.creator)
          go(`/search?q=${encodeURIComponent(item.creator)}`)
        },
      }))

    const creatorResults: CommandItem[] = (discovery?.performers ?? [])
      .filter((creator) =>
        creator.name.toLowerCase().includes(needle) ||
        (creator.username ?? '').toLowerCase().includes(needle)
      )
      .slice(0, 5)
      .map((creator) => ({
        id: `creator-${creator.id}`,
        label: `@${creator.username || creator.name}`,
        hint: creator.platform || 'creator',
        icon: UserRound,
        category: 'Creators',
        action: () => {
          setSearchQuery(creator.name)
          go(`/search?q=${encodeURIComponent(creator.name)}`)
        },
      }))

    return [
      ...staticCommands.filter((command) => command.label.toLowerCase().includes(needle)),
      ...mediaResults,
      ...creatorResults,
    ]
  }, [query, discovery, setSearchQuery, setOpen, go])

  const grouped = useMemo(() => {
    return items.reduce<Record<string, CommandItem[]>>((acc, item) => {
      acc[item.category] = acc[item.category] || []
      acc[item.category].push(item)
      return acc
    }, {})
  }, [items])

  const flatItems = useMemo(() => Object.values(grouped).flat(), [grouped])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (flatItems.length ? (i + 1) % flatItems.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (flatItems.length ? (i - 1 + flatItems.length) % flatItems.length : 0))
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
          className="fixed inset-0 z-[400] flex items-start justify-center bg-scrim pt-[15vh]"
          onClick={() => setOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="mx-4 w-full max-w-[600px] overflow-hidden rounded-lg border border-line bg-elevated shadow-overlay"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Input */}
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <Search size={16} strokeWidth={1.75} className="text-ink-3" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActiveIndex(0)
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search media, creators, commands"
                aria-label="Search media, creators, commands"
                className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
              />
              <button
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded text-ink-3 hover:bg-sunken hover:text-ink"
                aria-label="Close command palette"
              >
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>

            {/* Results */}
            <div className="max-h-[46vh] overflow-y-auto hide-scrollbar py-2">
              {Object.entries(grouped).map(([category, groupItems]) => (
                <div key={category} className="mb-1">
                  <div className="px-4 py-1.5 eyebrow">{category}</div>
                  {groupItems.map((item) => {
                    const globalIdx = flatItems.findIndex((fi) => fi.id === item.id)
                    const isActive = globalIdx === activeIndex
                    const Icon = item.icon
                    return (
                      <button
                        key={item.id}
                        onClick={item.action}
                        onMouseEnter={() => setActiveIndex(globalIdx)}
                        className={cn(
                          'relative flex min-h-11 w-full items-center gap-3 px-4 text-left transition-colors',
                          isActive ? 'bg-sunken' : 'hover:bg-sunken/60'
                        )}
                      >
                        {isActive && (
                          <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-heat" aria-hidden="true" />
                        )}
                        <Icon size={16} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden="true" />
                        <span className="flex-1 truncate text-sm text-ink">{item.label}</span>
                        {item.hint && (
                          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">{item.hint}</span>
                        )}
                        {isActive && <ArrowRight size={14} strokeWidth={1.75} className="text-heat" aria-hidden="true" />}
                      </button>
                    )
                  })}
                </div>
              ))}
              {flatItems.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">No results</p>
                </div>
              )}
            </div>

            {/* Footer hints */}
            <div className="flex items-center gap-4 border-t border-line px-4 py-2">
              <span className="flex items-center gap-1 font-mono text-[10px] text-ink-3">
                <kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> navigate
              </span>
              <span className="flex items-center gap-1 font-mono text-[10px] text-ink-3">
                <kbd className="kbd">↵</kbd> select
              </span>
              <span className="flex items-center gap-1 font-mono text-[10px] text-ink-3">
                <kbd className="kbd">esc</kbd> close
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
