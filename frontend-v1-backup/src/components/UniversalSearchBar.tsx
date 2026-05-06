import { useState, useEffect, useMemo, useRef } from "react"
import { cn } from "@/lib/cn"
import { useAppStore } from "../store"
import { useDebounce } from "@/hooks/useDebounce"
import { Spinner } from "./Spinner"
import {
  usePerformerSearchSuggestionsQuery,
  useScreenshotAllTagsQuery,
  useScreenshotTermsQuery,
} from "@/features/sharedQueries"
import { getPerformerAvatarSrc, getPerformerMeta } from "@/lib/performer"
import type { Performer } from "@/lib/api"

const RECENT_SEARCHES_KEY = "codex-recent-searches"
const MAX_RECENT = 8

function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.slice(0, MAX_RECENT)
    }
  } catch { /* ignore */ }
  return []
}

function saveRecentSearches(searches: string[]) {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches.slice(0, MAX_RECENT)))
  } catch { /* ignore */ }
}

type CreatorSuggestionItem = { kind: "creator"; id: string; label: string; meta: string; performer: Performer }
type TermSuggestionItem = { kind: "term"; id: string; label: string; meta: string; value: string }
type TagSuggestionItem = { kind: "tag"; id: string; label: string; meta: string; value: string }
type SearchSuggestionItem = CreatorSuggestionItem | TermSuggestionItem | TagSuggestionItem

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

export function UniversalSearchBar() {
  const setActiveView = useAppStore((s) => s.setActiveView)

  const [searchVal, setSearchVal] = useState("")
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecentSearches)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [focused, setFocused] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const mobileInputRef = useRef<HTMLInputElement>(null)

  const trimmedSearch = searchVal.trim()
  const suggestionsEnabled = dropdownOpen && trimmedSearch.length >= 2
  const debouncedSearch = useDebounce(trimmedSearch, 300)

  const performerSuggestionsQuery = usePerformerSearchSuggestionsQuery(debouncedSearch, {
    enabled: suggestionsEnabled,
    limit: 6,
  })
  const { data: screenshotTerms = [], isFetching: termsFetching } = useScreenshotTermsQuery(suggestionsEnabled)
  const { data: screenshotTags = [], isFetching: tagsFetching } = useScreenshotAllTagsQuery(suggestionsEnabled)

  const creatorResults: Performer[] =
    debouncedSearch.length < 2 || performerSuggestionsQuery.isError
      ? []
      : (performerSuggestionsQuery.data?.performers ?? [])

  const searchLoading =
    debouncedSearch.length >= 2 &&
    (debouncedSearch !== performerSuggestionsQuery.debouncedQuery || performerSuggestionsQuery.isFetching)

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
    if (debouncedSearch.length < 2) return []
    const lc = debouncedSearch.toLowerCase()
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
  }, [screenshotTerms, debouncedSearch])

  const tagSuggestions = useMemo<TagSuggestionItem[]>(() => {
    if (debouncedSearch.length < 2) return []
    const lc = debouncedSearch.toLowerCase()
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
  }, [screenshotTags, debouncedSearch])

  const resultEntries = useMemo(
    () => [...creatorSuggestions, ...termSuggestions, ...tagSuggestions],
    [creatorSuggestions, tagSuggestions, termSuggestions],
  )

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

  // Click outside to close
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

  function runSearch(query: string) {
    const q = query.trim()
    if (!q) return
    const updated = [q, ...recentSearches.filter((s) => s !== q)].slice(0, MAX_RECENT)
    setRecentSearches(updated)
    saveRecentSearches(updated)
    setSearchVal("")
    setDropdownOpen(false)
    inputRef.current?.blur()
    setMobileSearchOpen(false)
    window.location.hash = `#/search?q=${encodeURIComponent(q)}`
    setActiveView("search")
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    runSearch(trimmedSearch)
  }

  function handleSelectRecent(query: string) {
    runSearch(query)
  }

  function handleClearRecent() {
    setRecentSearches([])
    saveRecentSearches([])
  }

  function handleSelectCreator(performer: Performer) {
    if (trimmedSearch) {
      const updated = [trimmedSearch, ...recentSearches.filter((s) => s !== trimmedSearch)].slice(0, MAX_RECENT)
      setRecentSearches(updated)
      saveRecentSearches(updated)
    }
    setSearchVal("")
    setDropdownOpen(false)
    setMobileSearchOpen(false)
    window.location.hash = `#/performers?id=${performer.id}`
    setActiveView("performers")
  }

  function handleSelectTerm(term: string) {
    setSearchVal("")
    setDropdownOpen(false)
    setMobileSearchOpen(false)
    window.location.hash = `#/media?term=${encodeURIComponent(term)}`
    setActiveView("images")
  }

  function handleSelectTag(tag: string) {
    setSearchVal("")
    setDropdownOpen(false)
    setMobileSearchOpen(false)
    window.location.hash = `#/media?tag=${encodeURIComponent(tag)}`
    setActiveView("images")
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
      {/* Desktop */}
      <div
        ref={containerRef}
        className={cn(
          "relative hidden flex-1 transition-all duration-300 md:block",
          focused ? "max-w-xl" : "max-w-lg"
        )}
      >
        <form onSubmit={handleSubmit}>
          <svg
            className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-text-muted"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            placeholder="Search your library, tags, creators…"
            value={searchVal}
            onChange={(e) => {
              setSearchVal(e.target.value)
              if (!dropdownOpen) setDropdownOpen(true)
            }}
            onFocus={() => {
              setFocused(true)
              setDropdownOpen(true)
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKeyDown}
            className="w-full rounded-full border border-white/[0.1] bg-white/[0.05] py-2.5 pl-8 pr-14 text-sm text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] placeholder:text-text-muted transition-[background-color,border-color,box-shadow] focus:border-accent/45 focus:bg-white/[0.07] focus:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_3px_var(--color-accent-soft)] focus:outline-none"
            role="combobox"
            aria-expanded={showDropdown}
            aria-haspopup="listbox"
            aria-autocomplete="list"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-text-muted sm:inline">
            ⌘K
          </kbd>
        </form>

        {showDropdown && (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-border bg-bg-surface shadow-lg"
            role="listbox"
          >
            {showRecent && (
              <div>
                <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Recent
                  </span>
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
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          className="shrink-0 text-text-muted"
                          aria-hidden="true"
                        >
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
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                        Creators
                      </span>
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
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                        Media terms
                      </span>
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
                    <kbd className="rounded border border-border bg-bg-subtle px-1 py-0.5 font-mono text-[9px]">
                      Enter
                    </kbd>{" "}
                    search all media
                  </span>
                  <span className="text-[10px] text-text-muted">
                    <kbd className="rounded border border-border bg-bg-subtle px-1 py-0.5 font-mono text-[9px]">
                      Esc
                    </kbd>{" "}
                    close
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
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      </button>

      {/* Mobile search overlay */}
      {mobileSearchOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-bg-base/95 backdrop-blur-md md:hidden">
          <div className="flex items-center gap-3 px-4 pt-[env(safe-area-inset-top,12px)] pb-3">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                runSearch(searchVal.trim())
              }}
              className="relative flex-1"
            >
              <svg
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                ref={mobileInputRef}
                type="search"
                placeholder="Search library, tags, creators…"
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-3 pl-10 pr-4 text-base text-text-primary placeholder:text-text-muted focus:border-accent/40 focus:outline-none"
                autoFocus
              />
            </form>
            <button
              onClick={() => {
                setMobileSearchOpen(false)
                setSearchVal("")
              }}
              className="shrink-0 px-2 py-2 text-sm font-medium text-text-secondary"
            >
              Cancel
            </button>
          </div>
          {recentSearches.length > 0 && !searchVal.trim() && (
            <div className="px-4">
              <div className="flex items-center justify-between pb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Recent</span>
                <button type="button" onClick={handleClearRecent} className="text-[11px] text-text-muted">
                  Clear
                </button>
              </div>
              <ul className="space-y-1">
                {recentSearches.map((query) => (
                  <li key={query}>
                    <button
                      type="button"
                      onClick={() => runSearch(query)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-text-secondary hover:bg-white/[0.04]"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        className="shrink-0 text-text-muted"
                      >
                        <polyline points="1 4 1 10 7 10" />
                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                      </svg>
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
