import { useState, useEffect, useCallback, useRef, lazy, Suspense, startTransition } from "react"
import { useIsFetching } from "@tanstack/react-query"
import { useAppStore } from "../store"
import { api, type Performer } from "../lib/api"
import { Spinner } from "./Spinner"
import { cn } from "@/lib/cn"

const ShortcutModal = lazy(() => import("./ShortcutModal").then((m) => ({ default: m.ShortcutModal })))
const NotificationCenter = lazy(() => import("./NotificationCenter").then((m) => ({ default: m.NotificationCenter })))

const VIEW_LABELS: Record<string, string> = {
  overview: "Overview",
  items: "Media",
  images: "Media",
  hypotheses: "Media",
  graph: "Media",
  performers: "Creators",
  settings: "Settings",
}

const RECENT_SEARCHES_KEY = "codex_recent_searches"
const MAX_RECENT = 8

function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

function saveRecentSearch(query: string) {
  const prev = loadRecentSearches()
  const next = [query, ...prev.filter((q) => q !== query)].slice(0, MAX_RECENT)
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next))
  return next
}

function clearRecentSearches() {
  localStorage.removeItem(RECENT_SEARCHES_KEY)
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`(${escaped})`, "gi")
  const parts = text.split(regex)
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="rounded-sm bg-accent/25 px-0.5 text-text-primary">
        {part}
      </mark>
    ) : (
      part
    )
  )
}

export function TopBar() {
  const isFetching = useIsFetching()
  const activeView = useAppStore((s) => s.activeView)
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const crawlRunning = useAppStore((s) => s.crawlRunning)
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const mobileNavOpen = useAppStore((s) => s.mobileNavOpen)
  const setMobileNavOpen = useAppStore((s) => s.setMobileNavOpen)
  const setFilter = useAppStore((s) => s.setFilter)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setPendingPerformer = useAppStore((s) => s.setPendingPerformer)

  const leftOffset = collapsed ? "lg:left-[72px]" : "lg:left-[240px]"
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [topBarEnhancementsReady, setTopBarEnhancementsReady] = useState(false)
  const [searchVal, setSearchVal] = useState("")
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecentSearches)
  const [creatorResults, setCreatorResults] = useState<Performer[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const openShortcuts = useCallback(() => setShortcutsOpen(true), [])
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    function openFromShortcut() {
      setShortcutsOpen(true)
    }
    window.addEventListener("open-shortcuts-overlay", openFromShortcut as EventListener)
    return () => window.removeEventListener("open-shortcuts-overlay", openFromShortcut as EventListener)
  }, [])

  // ⌘K / Ctrl+K to focus search
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        inputRef.current?.focus()
        setDropdownOpen(true)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    let cancelled = false

    const enableEnhancements = () => {
      if (!cancelled) setTopBarEnhancementsReady(true)
    }

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(enableEnhancements, { timeout: 1200 })
      return () => {
        cancelled = true
        window.cancelIdleCallback(idleId)
      }
    }

    const timeoutId = setTimeout(enableEnhancements, 400)
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const q = searchVal.trim()
    if (q.length < 2) {
      setCreatorResults([])
      setSearchLoading(false)
      return
    }

    setSearchLoading(true)
    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current
      try {
        const result = await api.searchPerformers(q, 6)
        if (requestId === requestIdRef.current) {
          setCreatorResults(result.performers ?? [])
        }
      } catch {
        if (requestId === requestIdRef.current) {
          setCreatorResults([])
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setSearchLoading(false)
        }
      }
    }, 220)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchVal])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [dropdownOpen])

  useEffect(() => {
    setActiveIndex(-1)
  }, [creatorResults.length, searchVal, recentSearches.length])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = searchVal.trim()
    if (!q) return
    const updated = saveRecentSearch(q)
    setRecentSearches(updated)
    resetFilters()
    setFilter("search", q)
    startTransition(() => {
      setActiveView("images")
    })
    setSearchVal("")
    setDropdownOpen(false)
  }

  function handleSelectRecent(query: string) {
    setSearchVal(query)
    inputRef.current?.focus()
  }

  function handleClearRecent() {
    clearRecentSearches()
    setRecentSearches([])
  }

  function handleSelectCreator(performer: Performer) {
    const q = searchVal.trim()
    if (q) {
      const updated = saveRecentSearch(q)
      setRecentSearches(updated)
    }
    setPendingPerformer(performer.id)
    startTransition(() => {
      setActiveView("performers")
    })
    setSearchVal("")
    setDropdownOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!dropdownOpen) return

    const q = searchVal.trim()
    if (!q) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIndex((prev) => Math.min(prev + 1, recentSearches.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIndex((prev) => Math.max(prev - 1, -1))
      } else if (e.key === "Enter" && activeIndex >= 0 && activeIndex < recentSearches.length) {
        e.preventDefault()
        handleSelectRecent(recentSearches[activeIndex])
      } else if (e.key === "Escape") {
        setDropdownOpen(false)
        inputRef.current?.blur()
      }
      return
    }

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((prev) => Math.min(prev + 1, creatorResults.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((prev) => Math.max(prev - 1, -1))
    } else if (e.key === "Enter" && activeIndex >= 0 && activeIndex < creatorResults.length) {
      e.preventDefault()
      handleSelectCreator(creatorResults[activeIndex])
    } else if (e.key === "Escape") {
      setDropdownOpen(false)
      inputRef.current?.blur()
    }
  }

  const showRecent = dropdownOpen && !searchVal.trim() && recentSearches.length > 0
  const showResults = dropdownOpen && searchVal.trim().length > 0
  const showDropdown = showRecent || showResults

  return (
    <>
      {isFetching > 0 && (
        <div className="fixed inset-x-0 top-0 z-[55] h-0.5 overflow-hidden" aria-hidden="true">
          <div
            className="h-full animate-[topbar-loading_1.5s_ease-in-out_infinite]"
            style={{ background: "var(--color-accent, #7cc6ff)" }}
          />
          <style>{`
            @keyframes topbar-loading {
              0% { width: 0%; margin-left: 0%; }
              50% { width: 60%; margin-left: 20%; }
              100% { width: 0%; margin-left: 100%; }
            }
          `}</style>
        </div>
      )}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-20 px-3 pt-2 transition-[left] duration-200 sm:px-4 lg:px-5",
          leftOffset
        )}
      >
        <div className="glass mx-auto flex max-w-[1600px] items-center gap-3 rounded-2xl px-3 py-2 sm:px-4">
          <button
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary md:hidden"
            aria-label="Open navigation"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></svg>
          </button>

          <h2 className="min-w-0 shrink-0 text-sm font-semibold text-text-primary">
            {VIEW_LABELS[activeView] ?? activeView}
          </h2>

          <div ref={containerRef} className="relative hidden max-w-md flex-1 md:block">
            <form onSubmit={handleSearch}>
              <svg className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-text-muted" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input
                ref={inputRef}
                type="search"
                placeholder="Search media or creators..."
                value={searchVal}
                onChange={(e) => {
                  setSearchVal(e.target.value)
                  if (!dropdownOpen) setDropdownOpen(true)
                }}
                onFocus={() => setDropdownOpen(true)}
                onKeyDown={handleKeyDown}
                className="w-full rounded-full border border-white/[0.08] bg-white/[0.04] py-1.5 pl-8 pr-14 text-xs text-text-primary placeholder:text-text-muted transition-all focus:border-accent/40 focus:bg-white/[0.06] focus:outline-none"
                role="combobox"
                aria-expanded={showDropdown}
                aria-haspopup="listbox"
                aria-autocomplete="list"
              />
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-text-muted sm:inline">⌘K</kbd>
            </form>

            {showDropdown && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-border bg-bg-surface shadow-lg" role="listbox">
                {showRecent && (
                  <div>
                    <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Recent</span>
                      <button
                        type="button"
                        onClick={handleClearRecent}
                        className="text-[10px] text-text-muted transition-colors hover:text-red"
                      >
                        Clear all
                      </button>
                    </div>
                    <ul>
                      {recentSearches.map((q, i) => (
                        <li key={q}>
                          <button
                            type="button"
                            onClick={() => handleSelectRecent(q)}
                            className={cn(
                              "flex w-full items-center gap-2 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-subtle",
                              activeIndex === i && "bg-bg-subtle text-text-primary"
                            )}
                            role="option"
                            aria-selected={activeIndex === i}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-text-muted" aria-hidden="true">
                              <polyline points="1 4 1 10 7 10" />
                              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                            </svg>
                            {q}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="h-px bg-border" />
                  </div>
                )}

                {showResults && (
                  <div className="max-h-72 overflow-y-auto">
                    {searchLoading && creatorResults.length === 0 && (
                      <div className="flex items-center justify-center py-4">
                        <Spinner size={14} label="Searching creators..." />
                      </div>
                    )}

                    {!searchLoading && creatorResults.length === 0 && (
                      <div className="px-3 py-4 text-center">
                        <p className="text-xs text-text-muted">
                          Press Enter to search media for &ldquo;{searchVal.trim()}&rdquo;.
                        </p>
                      </div>
                    )}

                    {creatorResults.length > 0 && (
                      <div>
                        <div className="px-3 pt-2 pb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Creators</span>
                        </div>
                        <ul>
                          {creatorResults.map((performer, idx) => (
                            <li key={performer.id}>
                              <button
                                type="button"
                                onClick={() => handleSelectCreator(performer)}
                                className={cn(
                                  "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                                  activeIndex === idx ? "bg-bg-subtle" : "hover:bg-bg-subtle/50"
                                )}
                                role="option"
                                aria-selected={activeIndex === idx}
                              >
                                {performer.avatar_local || performer.avatar_url ? (
                                  <img
                                    src={performer.avatar_local || performer.avatar_url || ""}
                                    alt=""
                                    className="h-7 w-7 shrink-0 rounded-full bg-white/5 object-cover"
                                  />
                                ) : (
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-[11px] font-semibold text-accent">
                                    {(performer.display_name || performer.username || "?").charAt(0).toUpperCase()}
                                  </span>
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-medium text-text-primary">
                                    {highlightMatch(performer.display_name || performer.username, searchVal)}
                                  </span>
                                  <span className="block truncate text-[10px] text-text-muted">
                                    {performer.platform}{performer.username !== (performer.display_name || performer.username) ? ` · @${performer.username}` : ""}
                                  </span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        <div className="h-px bg-border" />
                        <div className="flex items-center justify-between px-3 py-1.5">
                          <span className="text-[10px] text-text-muted">
                            <kbd className="rounded border border-border bg-bg-subtle px-1 py-0.5 font-mono text-[9px]">Enter</kbd> search media
                          </span>
                          <span className="text-[10px] text-text-muted">
                            <kbd className="rounded border border-border bg-bg-subtle px-1 py-0.5 font-mono text-[9px]">Esc</kbd> close
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex-1" />

          {crawlRunning && (
            <div className="flex items-center gap-1.5" role="status" aria-live="polite">
              <Spinner size={10} className="text-green" label="Syncing" />
              <span className="hidden text-[11px] text-green sm:inline">syncing</span>
            </div>
          )}

          <button
            onClick={toggleTheme}
            className="hidden h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary sm:flex"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
          </button>

          {topBarEnhancementsReady && (
            <Suspense fallback={null}>
              <NotificationCenter />
            </Suspense>
          )}
        </div>
      </header>
      {(topBarEnhancementsReady || shortcutsOpen) && (
        <Suspense fallback={null}>
          <ShortcutModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
