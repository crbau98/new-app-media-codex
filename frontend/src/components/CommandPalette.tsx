import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { cn } from "@/lib/cn"
import { useAppStore, type ActiveView } from "../store"
import { api, type Performer } from "../lib/api"
import { getPerformerAvatarSrc } from "@/lib/performer"

type CommandType = "nav" | "run" | "shortcut"

type Command = {
  id: string
  label: string
  description?: string
  action: () => void
  keywords?: string[]
  disabled?: boolean
  type?: CommandType
}

type RecentItem = {
  id: string
  label: string
  type?: CommandType
  timestamp: number
}

type FuzzyResult = {
  score: number
  indices: number[]
}

function fuzzyMatch(query: string, text: string): FuzzyResult {
  if (!query) return { score: 0, indices: [] }
  const q = query.toLowerCase()
  const t = text.toLowerCase()

  const indices: number[] = []
  let qi = 0
  let ti = 0
  let consecutiveBonus = 0
  let lastMatchedTi = -2

  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      indices.push(ti)
      if (ti === lastMatchedTi + 1) consecutiveBonus += 5
      lastMatchedTi = ti
      qi++
    }
    ti++
  }

  if (qi < q.length) return { score: 0, indices: [] }

  const base = (indices.length / q.length) * 100
  const startBonus = indices[0] === 0 ? 20 : 0
  const wordStartBonus = indices.filter((i) => i === 0 || /[\s\-_]/.test(text[i - 1])).length * 10
  return { score: base + consecutiveBonus + startBonus + wordStartBonus, indices }
}

function HighlightedText({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <span>{text}</span>

  const indexSet = new Set(indices)
  const segments: { chars: string; matched: boolean }[] = []
  let current = { chars: "", matched: false }

  for (let i = 0; i < text.length; i++) {
    const matched = indexSet.has(i)
    if (matched !== current.matched && current.chars.length > 0) {
      segments.push(current)
      current = { chars: text[i], matched }
    } else {
      current.chars += text[i]
      current.matched = matched
    }
  }
  if (current.chars.length > 0) segments.push(current)

  return (
    <span>
      {segments.map((seg, i) =>
        seg.matched ? (
          <mark key={i} className="rounded-sm bg-accent/20 text-accent not-italic">
            {seg.chars}
          </mark>
        ) : (
          <span key={i}>{seg.chars}</span>
        )
      )}
    </span>
  )
}

const MAX_RECENT = 8

// In-memory recent items store (replaces localStorage)
let _recentItemsStore: RecentItem[] = []

function loadRecent(): RecentItem[] {
  return _recentItemsStore.slice(0, MAX_RECENT)
}

function addToRecent(item: RecentItem) {
  const existing = _recentItemsStore.filter((r) => r.id !== item.id)
  _recentItemsStore = [item, ...existing].slice(0, MAX_RECENT)
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1 pt-2">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">{children}</span>
    </div>
  )
}

function TypeBadge({ type }: { type?: CommandType }) {
  const label = type === "run" ? "▶" : type === "shortcut" ? "?" : "→"
  return (
    <span className="shrink-0 rounded px-1.5 py-0.5 text-xs font-mono text-accent bg-accent/15 ring-1 ring-accent/25">
      {label}
    </span>
  )
}

const SHORTCUTS = [
  { keys: ["⌘", "K"], desc: "Command palette — go anywhere, run crawl/capture" },
  { keys: ["/"], desc: "Focus search (on Media)" },
  { keys: ["?"], desc: "Media shortcuts (on Media) · global help from palette" },
  { keys: ["↑", "↓"], desc: "Move selection in lists & palette" },
  { keys: ["↵"], desc: "Choose item" },
  { keys: ["Esc"], desc: "Close dialogs" },
]

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-md rounded-2xl border border-border bg-bg-elevated p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-text-primary">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="rounded px-2 py-1 text-xs text-text-muted transition-colors hover:text-accent" aria-label="Close shortcuts overlay">
            esc
          </button>
        </div>
        <div className="grid gap-2">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <span className="text-sm text-text-muted">{s.desc}</span>
              <div className="flex items-center gap-1 shrink-0">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex min-h-[26px] min-w-[26px] items-center justify-center rounded border border-border bg-bg-subtle px-1.5 font-mono text-[11px] text-text-primary"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setPendingPerformer = useAppStore((s) => s.setPendingPerformer)
  const setFilter = useAppStore((s) => s.setFilter)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const theme = useAppStore((s) => s.theme)
  const crawlRunning = useAppStore((s) => s.crawlRunning)
  const setCrawlRunning = useAppStore((s) => s.setCrawlRunning)
  const addToast = useAppStore((s) => s.addToast)

  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recentItems, setRecentItems] = useState<RecentItem[]>([])
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [performerResults, setPerformerResults] = useState<Performer[]>([])
  const [performerLoading, setPerformerLoading] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  async function handleTriggerCrawl() {
    setOpen(false)
    try {
      await api.triggerCrawl()
      setCrawlRunning(true)
      addToast("Crawl started", "success")
    } catch {
      addToast("Failed to start crawl", "error")
    }
  }

  async function handleCapture() {
    setOpen(false)
    try {
      await api.triggerCapture()
      addToast("Screenshot capture started", "success")
    } catch {
      addToast("Failed to start capture", "error")
    }
  }

  useEffect(() => {
    function handler() {
      setShowShortcuts(true)
    }
    window.addEventListener("open-shortcuts-overlay", handler)
    return () => window.removeEventListener("open-shortcuts-overlay", handler)
  }, [])

  useEffect(() => {
    if (open) setRecentItems(loadRecent())
  }, [open])

  const trackAndRun = useCallback((cmd: Command) => {
    if (cmd.disabled) return
    addToRecent({ id: cmd.id, label: cmd.label, type: cmd.type, timestamp: Date.now() })
    setRecentItems(loadRecent())
    cmd.action()
  }, [])

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    const q = query.trim()
    if (q.length < 2) {
      setPerformerResults([])
      setPerformerLoading(false)
      return
    }
    setPerformerLoading(true)
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const result = await api.searchPerformers(q, 6)
        setPerformerResults(result.performers ?? [])
      } catch {
        setPerformerResults([])
      } finally {
        setPerformerLoading(false)
      }
    }, 220)
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [query])

  useEffect(() => {
    if (!open) {
      setPerformerResults([])
      setPerformerLoading(false)
    }
  }, [open])

  const commands = useMemo<Command[]>(() => [
    {
      id: "go-media",
      label: "Go to Media",
      description: "Browse and filter captured media",
      keywords: ["images", "videos", "screenshots", "gallery"],
      type: "nav",
      action: () => {
        setActiveView("images")
        setOpen(false)
      },
    },
    {
      id: "go-creators",
      label: "Go to Creators",
      description: "Browse creators and manage capture",
      keywords: ["performers", "profiles", "queue"],
      type: "nav",
      action: () => {
        setActiveView("performers")
        setOpen(false)
      },
    },
    {
      id: "go-settings",
      label: "Go to Settings",
      description: "Open system preferences",
      keywords: ["preferences", "config", "options"],
      type: "nav",
      action: () => {
        setActiveView("settings")
        setOpen(false)
      },
    },
    {
      id: "search-media",
      label: query.trim() ? `Search Media for “${query.trim()}”` : "Search Media",
      description: "Apply the query to the Media view",
      keywords: ["filter", "media", "search"],
      disabled: query.trim().length === 0,
      type: "nav",
      action: () => {
        const q = query.trim()
        if (!q) return
        resetFilters()
        setFilter("search", q)
        setActiveView("images")
        setOpen(false)
      },
    },
    {
      id: "run-crawl",
      label: crawlRunning ? "Run Crawl (already running…)" : "Run Crawl",
      description: "Trigger a new collection run",
      keywords: ["scrape", "collect", "fetch"],
      disabled: crawlRunning,
      type: "run",
      action: () => {
        if (crawlRunning) return
        setCrawlRunning(true)
        api.triggerCrawl().catch(() => setCrawlRunning(false))
        setOpen(false)
      },
    },
    {
      id: "run-capture",
      label: "Run Capture",
      description: "Trigger a new screenshot capture run",
      keywords: ["capture", "screenshots", "refresh media"],
      type: "run",
      action: () => {
        api.triggerCapture().catch(() => {})
        setOpen(false)
      },
    },
    {
      id: "view-shortcuts",
      label: "View keyboard shortcuts",
      description: "Show the keyboard shortcut overlay",
      keywords: ["help", "keys", "shortcuts"],
      type: "shortcut",
      action: () => {
        setOpen(false)
        setShowShortcuts(true)
      },
    },
    {
      id: "toggle-theme",
      label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      description: "Toggle appearance",
      keywords: ["theme", "dark", "light", "appearance", "mode"],
      type: "shortcut",
      action: () => {
        toggleTheme()
        setOpen(false)
      },
    },
  ], [crawlRunning, query, resetFilters, setActiveView, setCrawlRunning, setFilter, setOpen, theme, toggleTheme])

  const scoredCommands = useMemo(() => {
    if (!query.trim()) return []
    return commands
      .map((cmd) => {
        const labelResult = fuzzyMatch(query, cmd.label)
        const descResult = cmd.description ? fuzzyMatch(query, cmd.description) : { score: 0, indices: [] }
        const kwScore = (cmd.keywords ?? []).reduce((best, kw) => Math.max(best, fuzzyMatch(query, kw).score), 0)
        const score = Math.max(labelResult.score, descResult.score * 0.6, kwScore * 0.4)
        return { cmd, score, matchIndices: score === labelResult.score ? labelResult.indices : [] }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
  }, [commands, query])

  const performerResultCommands = useMemo(() => {
    if (query.trim().length < 2 || performerResults.length === 0) return []
    return performerResults.map((p) => ({
      performer: p,
      cmd: {
        id: `performer-${p.id}`,
        label: p.display_name || p.username,
        description: p.platform,
        type: "nav" as CommandType,
        action: () => {
          setPendingPerformer(p.id)
          setActiveView("performers")
          setOpen(false)
        },
      },
    }))
  }, [performerResults, query, setActiveView, setOpen, setPendingPerformer])

  type FlatEntry =
    | { kind: "performer"; cmd: Command; performer: Performer; matchIndices: number[] }
    | { kind: "command"; cmd: Command; matchIndices: number[] }
  type CommandFlatEntry = Extract<FlatEntry, { kind: "command" }>

  const flatList = useMemo<FlatEntry[]>(() => {
    if (query.trim()) {
      return [
        ...performerResultCommands.map(({ cmd, performer }) => ({ kind: "performer" as const, cmd, performer, matchIndices: [] as number[] })),
        ...scoredCommands.map(({ cmd, matchIndices }) => ({ kind: "command" as const, cmd, matchIndices })),
      ]
    }
    const recentCmds: CommandFlatEntry[] = recentItems.flatMap((r) => {
        const found = commands.find((c) => c.id === r.id)
        return found ? [{ kind: "command" as const, cmd: found, matchIndices: [] as number[] }] : []
      })
    const actionCmds: CommandFlatEntry[] = commands
      .filter((c) => !recentCmds.some((r) => r.cmd.id === c.id))
      .map((cmd) => ({ kind: "command" as const, cmd, matchIndices: [] as number[] }))
    return [...recentCmds, ...actionCmds]
  }, [commands, performerResultCommands, query, recentItems, scoredCommands])

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement
      setQuery("")
      setSelectedIndex(0)
      const id = setTimeout(() => inputRef.current?.focus(), 10)
      return () => clearTimeout(id)
    }
    previousFocusRef.current?.focus()
    previousFocusRef.current = null
  }, [open])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!open) return
    if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === "ArrowDown" || e.key === "j") {
      if (e.key === "j" && document.activeElement === inputRef.current) return
      e.preventDefault()
      setSelectedIndex((prev) => (flatList.length === 0 ? 0 : (prev + 1) % flatList.length))
      return
    }
    if (e.key === "ArrowUp" || e.key === "k") {
      if (e.key === "k" && document.activeElement === inputRef.current) return
      e.preventDefault()
      setSelectedIndex((prev) => (flatList.length === 0 ? 0 : (prev - 1 + flatList.length) % flatList.length))
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      const entry = flatList[selectedIndex]
      if (entry && !entry.cmd.disabled) {
        trackAndRun(entry.cmd)
      }
    }
  }, [flatList, open, selectedIndex, setOpen, trackAndRun])

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    setSelectedIndex((prev) => (flatList.length === 0 ? 0 : Math.min(prev, flatList.length - 1)))
  }, [flatList])

  useEffect(() => {
    if (!listRef.current) return
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  if (!open && !showShortcuts) return null

  return (
    <>
      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[20vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelectedIndex(0)
              }}
              placeholder="Jump to media, creators, or search a creator..."
              className="w-full border-b border-border bg-transparent px-4 py-3 font-mono text-text-primary focus:outline-none"
              aria-label="Search commands"
              aria-autocomplete="list"
              aria-controls="command-palette-list"
            />

            {query === "" ? (
              <div className="max-h-[min(70vh,22rem)] overflow-y-auto">
                <div className="border-b border-border px-4 py-2 text-[11px] text-text-muted">
                  Jump anywhere — type to filter creators and commands
                </div>
                <SectionLabel>Go to</SectionLabel>
                <ul>
                  {commands
                    .filter((c) => c.type === "nav" && c.id !== "search-media")
                    .map((cmd) => (
                      <li key={cmd.id}>
                        <button
                          type="button"
                          disabled={cmd.disabled}
                          onClick={() => trackAndRun(cmd)}
                          className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <span>
                            <span className="font-medium text-text-primary">{cmd.label}</span>
                            {cmd.description && <span className="block text-[11px] text-text-muted">{cmd.description}</span>}
                          </span>
                          <TypeBadge type={cmd.type} />
                        </button>
                      </li>
                    ))}
                </ul>
                <SectionLabel>Automation</SectionLabel>
                <ul>
                  <li>
                    <button
                      type="button"
                      onClick={handleTriggerCrawl}
                      disabled={crawlRunning}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary disabled:opacity-50"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <polyline points="23 4 23 10 17 10" />
                        <polyline points="1 20 1 14 7 14" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                      </svg>
                      {crawlRunning ? "Crawl running…" : "Run crawl"}
                    </button>
                  </li>
                  <li>
                    <button type="button" onClick={handleCapture} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                      Run capture
                    </button>
                  </li>
                </ul>
                <SectionLabel>Appearance and help</SectionLabel>
                <ul>
                  {commands
                    .filter((c) => c.id === "toggle-theme" || c.id === "view-shortcuts")
                    .map((cmd) => (
                      <li key={cmd.id}>
                        <button
                          type="button"
                          onClick={() => trackAndRun(cmd)}
                          className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
                        >
                          <span>
                            <span className="font-medium text-text-primary">{cmd.label}</span>
                            {cmd.description && <span className="block text-[11px] text-text-muted">{cmd.description}</span>}
                          </span>
                          <TypeBadge type={cmd.type} />
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ) : (
              <ul id="command-palette-list" ref={listRef} role="listbox" className="max-h-72 overflow-y-auto">
                {query.trim().length >= 2 && (
                  <>
                    <li role="presentation" aria-hidden="true">
                      <SectionLabel>Creators</SectionLabel>
                    </li>
                    {performerLoading && performerResults.length === 0 && (
                      <li className="px-4 py-3 text-xs text-text-muted">Searching creators...</li>
                    )}
                    {!performerLoading && performerResults.length === 0 && (
                      <li className="px-4 py-3 text-xs text-text-muted">No creator matches yet. You can still search media with this query.</li>
                    )}
                    {performerResultCommands.map(({ cmd, performer }, idx) => {
                      const isSelected = idx === selectedIndex
                      return (
                        <li
                          key={cmd.id}
                          id={`cmd-${cmd.id}`}
                          role="option"
                          aria-selected={isSelected}
                          className="mx-2 transition-colors"
                          style={isSelected ? { borderRadius: "0.5rem", background: "linear-gradient(to right, rgba(168,85,247,0.12), transparent)", outline: "1px solid rgba(168,85,247,0.28)" } : {}}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          onClick={() => trackAndRun(cmd)}
                        >
                          <div className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-bg-elevated">
                            {getPerformerAvatarSrc(performer) ? (
                              <img src={getPerformerAvatarSrc(performer)} alt="" className="h-7 w-7 shrink-0 rounded-full bg-white/5 object-cover" />
                            ) : (
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
                                {(performer.display_name || performer.username).charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-text-primary">{performer.display_name || performer.username}</p>
                              <p className="text-[11px] text-text-muted">{performer.platform}{performer.username !== (performer.display_name || performer.username) ? ` · @${performer.username}` : ""}</p>
                            </div>
                            <span className="shrink-0 text-xs text-text-muted">↵</span>
                          </div>
                        </li>
                      )
                    })}
                    {scoredCommands.length > 0 && (
                      <li role="presentation" aria-hidden="true">
                        <div className="mx-4 my-1 h-px bg-gradient-to-r from-transparent via-accent/25 to-transparent" />
                      </li>
                    )}
                  </>
                )}

                {scoredCommands.length > 0 && (
                  <>
                    <li role="presentation" aria-hidden="true">
                      <SectionLabel>Commands</SectionLabel>
                    </li>
                    {scoredCommands.map(({ cmd, matchIndices }, localIdx) => {
                      const idx = performerResultCommands.length + localIdx
                      const isSelected = idx === selectedIndex
                      return (
                        <li
                          key={cmd.id}
                          id={`cmd-${cmd.id}`}
                          role="option"
                          aria-selected={isSelected}
                          aria-disabled={cmd.disabled}
                          className={cn(
                            "flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm transition-colors",
                            isSelected ? "border-l-2 border-accent bg-accent/10" : "border-l-2 border-transparent"
                          )}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          onClick={() => {
                            if (!cmd.disabled) trackAndRun(cmd)
                          }}
                        >
                          <div className="min-w-0">
                            <span className="truncate font-mono text-text-primary">
                              <HighlightedText text={cmd.label} indices={matchIndices} />
                            </span>
                            {cmd.description && <div className="truncate text-xs text-text-muted">{cmd.description}</div>}
                          </div>
                          <TypeBadge type={cmd.type} />
                        </li>
                      )
                    })}
                  </>
                )}
              </ul>
            )}

            <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-xs font-mono text-text-muted">
              <span><kbd className="rounded border border-border bg-bg-subtle px-1 py-0.5 text-[9px]">↑↓</kbd> navigate</span>
              <span><kbd className="rounded border border-border bg-bg-subtle px-1 py-0.5 text-[9px]">↵</kbd> select</span>
              <span><kbd className="rounded border border-border bg-bg-subtle px-1 py-0.5 text-[9px]">esc</kbd> close</span>
              <span className="ml-auto cursor-pointer transition-opacity hover:opacity-80" onClick={() => { setOpen(false); setShowShortcuts(true) }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") { setOpen(false); setShowShortcuts(true) } }}>
                <kbd className="rounded border border-border bg-bg-subtle px-1 py-0.5 text-[9px]">?</kbd> shortcuts
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
