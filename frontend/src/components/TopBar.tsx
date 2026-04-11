import { useState, useEffect, useMemo, useRef, lazy, Suspense, startTransition } from "react"
import { useIsFetching, useQuery } from "@tanstack/react-query"
import { useAppStore } from "../store"
import { api, type Performer, type ScreenshotTerm, type UserTagCount } from "../lib/api"
import { Spinner } from "./Spinner"
import { cn } from "@/lib/cn"
import { getPerformerAvatarSrc, getPerformerMeta } from "@/lib/performer"

const ShortcutModal = lazy(() => import("./ShortcutModal").then((m) => ({ default: m.ShortcutModal })))
const NotificationCenter = lazy(() => import("./NotificationCenter").then((m) => ({ default: m.NotificationCenter })))

const VIEW_LABELS: Record<string, string> = {
  images: "Media Library",
  performers: "Creator Roster",
  settings: "Settings",
}

const MAX_RECENT = 8
const MEDIA_NAVIGATION_EVENT = "codex:media-navigation"

// Module-level in-memory navigation intent (replaces sessionStorage)
let _pendingNavigationIntent: { query?: string; term?: string; tag?: string } | null = null

export function consumeNavigationIntent(): { query?: string; term?: string; tag?: string } | null {
  const v = _pendingNavigationIntent
  _pendingNavigationIntent = null
  return v
}

// Module-level in-memory recent searches (replaces localStorage)
let _recentSearchesStore: string[] = []

function loadRecentSearches(): string[] {
  return _recentSearchesStore.slice(0, MAX_RECENT)
}

function saveRecentSearch(query: string): string[] {
  const prev = _recentSearchesStore
  const next = [query, ...prev.filter((q) => q !== query)].slice(0, MAX_RECENT)
  _recentSearchesStore = next
  return next
}

function clearRecentSearches() {
  _recentSearchesStore = []
}

type CreatorSuggestionItem = { kind: "creator"; id: string; label: string; meta: string; performer: Performer }
type TermSuggestionItem = { kind: "term"; id: string; label: string; meta: string; value: string }
type TagSuggestionItem = { kind: "tag"; id: string; label: string; meta: string; value: string }
type SearchSuggestionItem = CreatorSuggestionItem | TermSuggestionItem | TagSuggestionItem

function queueMediaNavigationIntent(intent: { query?: string; term?: string; tag?: string }) {
  _pendingNavigationIntent = intent
  window.dispatchEvent(new CustomEvent(MEDIA_NAVIGATION_EVENT, { detail: intent }))
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
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const mobileNavOpen = useAppStore((s) => s.mobileNavOpen)
  const setMobileNavOpen = useAppStore((s) => s.setMobileNavOpen)
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

  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const mobileInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)
  const trimmedSearch = searchVal.trim()
  const suggestionsEnabled = dropdownOpen && trimmedSearch.length >= 2

  const { data: screenshotTerms = [], isFetching: termsFetching } = useQuery<ScreenshotTerm[]>({
    queryKey: ["topbar-screenshot-terms"],
    queryFn: api.screenshotTerms,
    enabled: suggestionsEnabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const { data: screenshotTags = [], isFetching: tagsFetching } = useQuery<UserTagCount[]>({
    queryKey: ["topbar-screenshot-tags"],
    queryFn: api.screenshotAllTags,
    enabled: suggestionsEnabled,
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const creatorSuggestions = useMemo<CreatorSuggestionItem[]>(() => {
    return creatorResults.map((performer) => ({
      kind: "creator",
      id: `creator-${performer.id}`,
      label: performer.display_name || performer.username,
      meta: getPerformerMeta(performer),
      performer,
    }))
  }, [creatorResults])

  const termSuggestions = useMemo<TermSuggestionItem[]>(() => {
    if (trimmedSearch.length < 2) return []
    const lc = trimmedSearch.toLowerCase()
    return screenshotTerms
      .filter((term) => term.term.toLowerCase().includes(lc))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .map((term) => ({
        kind: "term",
        id: `term-${term.term}`,
        label: term.term,
        meta: `${term.count.toLocaleString()} shots`,
        value: term.term,
      }))
  }, [screenshotTerms, trimmedSearch])

  const tagSuggestions = useMemo<TagSuggestionItem[]>(() => {
    if (trimmedSearch.length < 2) return []
    const lc = trimmedSearch.toLowerCase()
    return screenshotTags
      .filter((tag) => tag.tag.toLowerCase().includes(lc))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .map((tag) => ({
        kind: "tag",
        id: `tag-${tag.tag}`,
        label: `#${tag.tag}`,
        meta: `${tag.count.toLocaleString()} tagged`,
        value: tag.tag,
      }))
  }, [screenshotTags, trimmedSearch])

  const resultEntries = useMemo(
    () => [...creatorSuggestions, ...termSuggestions, ...tagSuggestions],
    [creatorSuggestions, tagSuggestions, termSuggestions],
  )

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

    if (trimmedSearch.length < 2) {
      setCreatorResults([])
      setSearchLoading(false)
      return
    }

    setSearchLoading(true)
    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current
      try {
        const result = await api.searchPerformers(trimmedSearch, 6)
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
  }, [trimmedSearch])

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
  }, [recentSearches.length, resultEntries.length, trimmedSearch])

  function runMediaSearch(query: string) {
    const nextQuery = query.trim()
    if (!nextQuery) return
    const updated = saveRecentSearch(nextQuery)
    setRecentSearches(updated)
    queueMediaNavigationIntent({ query: nextQuery })
    startTransition(() => {
      setActiveView("images")
    })
    setSearchVal("")
    setDropdownOpen(false)
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    runMediaSearch(trimmedSearch)
  }

  function handleSelectRecent(query: string) {
    runMediaSearch(query)
  }

  function handleClearRecent() {
    clearRecentSearches()
    setRecentSearches([])
  }

  function handleSelectCreator(performer: Performer) {
    if (trimmedSearch) {
      const updated = saveRecentSearch(trimmedSearch)
      setRecentSearches(updated)
    }
    setPendingPerformer(performer.id)
    startTransition(() => {
      setActiveView("performers")
    })
    setSearchVal("")
    setDropdownOpen(false)
  }

  function handleSelectTerm(term: string) {
    queueMediaNavigationIntent({ term })
    startTransition(() => {
      setActiveView("images")
    })
    setSearchVal("")
    setDropdownOpen(false)
  }

  function handleSelectTag(tag: string) {
    queueMediaNavigationIntent({ tag })
    startTransition(() => {
      setActiveView("images")
    })
    setSearchVal("")
    setDropdownOpen(false)
  }

  function executeSuggestion(item: SearchSuggestionItem) {
    if (item.kind === "creator") handleSelectCreator(item.performer)
    if (item.kind === "term") handleSelectTerm(item.value)
    if (item.kind === "tag") handleSelectTag(item.value)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!dropdownOpen) return

    if (!trimmedSearch) {
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
      setActiveIndex((prev) => Math.min(prev + 1, resultEntries.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((prev) => Math.max(prev - 1, -1))
    } else if (e.key === "Enter" && activeIndex >= 0 && activeIndex < resultEntries.length) {
      e.preventDefault()
      executeSuggestion(resultEntries[activeIndex])
    } else if (e.key === "Escape") {
      setDropdownOpen(false)
      inputRef.current?.blur()
    }
  }

  const showRecent = dropdownOpen && !trimmedSearch && recentSearches.length > 0
  const showResults = dropdownOpen && trimmedSearch.length > 0
  const showDropdown = showRecent || showResults
  const suggestionsLoading = searchLoading || termsFetching || tagsFetching

  return (
    <>
      {isFetching > 0 && (
        <div className="fixed inset-x-0 top-0 z-[55] h-0.5 overflow-hidden" aria-hidden="true">
          <div className="topbar-loading-bar h-full" />
        </div>
      )}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-20 px-3 pt-3 transition-[left] duration-200 sm:px-5 lg:px-6",
          leftOffset,
        )}
      >
        <div className="glass mx-auto flex max-w-[1600px] items-center gap-4 rounded-2xl px-4 py-3 sm:gap-5 sm:px-5">
          <button
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary md:hidden"
            aria-label="Open navigation"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></svg>
          </button>

          <h2 className="min-w-0 shrink-0 text-base font-semibold tracking-tight text-text-primary sm:text-lg">
            {VIEW_LABELS[activeView] ?? activeView}
          </h2>

          <div ref={containerRef} className="relative hidden max-w-lg flex-1 md:block">
            <form onSubmit={handleSearch}>
              <svg className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-text-muted" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input
                ref={inputRef}
                type="search"
                placeholder="Search media, tags, or jump to a creator..."
                value={searchVal}
                onChange={(e) => {
                  setSearchVal(e.target.value)
                  if (!dropdownOpen) setDropdownOpen(true)
                }}
                onFocus={() => setDropdownOpen(true)}
                onKeyDown={handleKeyDown}
                className="w-full rounded-full border border-white/[0.08] bg-white/[0.04] py-2 pl-8 pr-14 text-sm text-text-primary placeholder:text-text-muted transition-[background-color,border-color,box-shadow] focus:border-accent/40 focus:bg-white/[0.06] focus:outline-none"
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
                      {recentSearches.map((query, idx) => (
                        <li key={query}>
                          <button
                            type="button"
                            onClick={() => handleSelectRecent(query)}
                            className={cn(
                              "flex w-full items-center gap-2 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-subtle",
                              activeIndex === idx && "bg-bg-subtle text-text-primary",
                            )}
                            role="option"
                            aria-selected={activeIndex === idx}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-text-muted" aria-hidden="true">
                              <polyline points="1 4 1 10 7 10" />
                              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                            </svg>
                            {query}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="h-px bg-border" />
                  </div>
                )}

                {showResults && (
                  <div className="max-h-72 overflow-y-auto">
                    {suggestionsLoading && resultEntries.length === 0 && (
                      <div className="flex items-center justify-center py-4">
                        <Spinner size={14} label="Searching media..." />
                      </div>
                    )}

                    {!suggestionsLoading && resultEntries.length === 0 && (
                      <div className="px-3 py-4 text-center">
                        <p className="text-xs text-text-muted">
                          Press Enter to search the media library for &ldquo;{trimmedSearch}&rdquo;.
                        </p>
                      </div>
                    )}

                    {creatorSuggestions.length > 0 && (
                      <div>
                        <div className="px-3 pt-2 pb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Creators</span>
                        </div>
                        <ul>
                          {creatorSuggestions.map((item, idx) => (
                            <li key={item.id}>
                              <button
                                type="button"
                                onClick={() => handleSelectCreator(item.performer)}
                                className={cn(
                                  "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                                  activeIndex === idx ? "bg-bg-subtle" : "hover:bg-bg-subtle/50",
                                )}
                                role="option"
                                aria-selected={activeIndex === idx}
                              >
                                {(() => {
                                  const avatarSrc = getPerformerAvatarSrc(item.performer)
                                  if (avatarSrc) {
                                    return (
                                      <img
                                        src={avatarSrc}
                                        alt=""
                                        className="h-7 w-7 shrink-0 rounded-full bg-white/5 object-cover"
                                      />
                                    )
                                  }
                                  return (
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-[11px] font-semibold text-accent">
                                      {(item.label || "?").charAt(0).toUpperCase()}
                                    </span>
                                  )
                                })()}
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-medium text-text-primary">
                                    {highlightMatch(item.label, searchVal)}
                                  </span>
                                  <span className="block truncate text-[10px] text-text-muted">{item.meta}</span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {termSuggestions.length > 0 && (
                      <div>
                        <div className="px-3 pt-2 pb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Media terms</span>
                        </div>
                        <ul>
                          {termSuggestions.map((item, idx) => {
                            const entryIndex = creatorSuggestions.length + idx
                            return (
                              <li key={item.id}>
                                <button
                                  type="button"
                                  onClick={() => handleSelectTerm(item.value)}
                                  className={cn(
                                    "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                                    activeIndex === entryIndex ? "bg-bg-subtle" : "hover:bg-bg-subtle/50",
                                  )}
                                  role="option"
                                  aria-selected={activeIndex === entryIndex}
                                >
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-[11px] font-semibold text-text-muted">
                                    T
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium text-text-primary">
                                      {highlightMatch(item.label, searchVal)}
                                    </span>
                                    <span className="block truncate text-[10px] text-text-muted">{item.meta}</span>
                                  </span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )}

                    {tagSuggestions.length > 0 && (
                      <div>
                        <div className="px-3 pt-2 pb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Tags</span>
                        </div>
                        <ul>
                          {tagSuggestions.map((item, idx) => {
                            const entryIndex = creatorSuggestions.length + termSuggestions.length + idx
                            return (
                              <li key={item.id}>
                                <button
                                  type="button"
                                  onClick={() => handleSelectTag(item.value)}
                                  className={cn(
                                    "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                                    activeIndex === entryIndex ? "bg-bg-subtle" : "hover:bg-bg-subtle/50",
                                  )}
                                  role="option"
                                  aria-selected={activeIndex === entryIndex}
                                >
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-[11px] font-semibold text-text-muted">
                                    #
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium text-text-primary">
                                      {highlightMatch(item.label, searchVal)}
                                    </span>
                                    <span className="block truncate text-[10px] text-text-muted">{item.meta}</span>
                                  </span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )}

                    <div className="h-px bg-border" />
                    <div className="flex items-center justify-between px-3 py-1.5">
                      <span className="text-[10px] text-text-muted">
                        <kbd className="rounded border border-border bg-bg-subtle px-1 py-0.5 font-mono text-[9px]">Enter</kbd> search all media
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

          {/* Mobile search button */}
          <button
            onClick={() => {
              setMobileSearchOpen(true)
              setTimeout(() => mobileInputRef.current?.focus(), 50)
            }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary md:hidden"
            aria-label="Search"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </button>

          <div className="flex-1" />

          <div className="flex items-center gap-2 sm:gap-2.5">
            <button
              onClick={toggleTheme}
              className="hidden h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary sm:flex"
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
        </div>
      </header>
      {(topBarEnhancementsReady || shortcutsOpen) && (
        <Suspense fallback={null}>
          <ShortcutModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </Suspense>
      )}

      {/* Mobile search overlay */}
      {mobileSearchOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-bg-base/95 backdrop-blur-md md:hidden">
          <div className="flex items-center gap-3 px-4 pt-[env(safe-area-inset-top,12px)] pb-3">
            <form onSubmit={(e) => { e.preventDefault(); runMediaSearch(searchVal.trim()); setMobileSearchOpen(false) }} className="relative flex-1">
              <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input
                ref={mobileInputRef}
                type="search"
                placeholder="Search media, tags, creators..."
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-3 pl-10 pr-4 text-base text-text-primary placeholder:text-text-muted focus:border-accent/40 focus:outline-none"
                autoFocus
              />
            </form>
            <button
              onClick={() => { setMobileSearchOpen(false); setSearchVal("") }}
              className="shrink-0 px-2 py-2 text-sm font-medium text-text-secondary"
            >
              Cancel
            </button>
          </div>
          {recentSearches.length > 0 && !searchVal.trim() && (
            <div className="px-4">
              <div className="flex items-center justify-between pb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Recent</span>
                <button type="button" onClick={handleClearRecent} className="text-[11px] text-text-muted">Clear</button>
              </div>
              <ul className="space-y-1">
                {recentSearches.map((query) => (
                  <li key={query}>
                    <button
                      type="button"
                      onClick={() => { runMediaSearch(query); setMobileSearchOpen(false) }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-text-secondary hover:bg-white/[0.04]"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-text-muted"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                      {query}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  )
}
