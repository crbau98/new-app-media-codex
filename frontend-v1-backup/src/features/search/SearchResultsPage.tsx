import { useState, useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { api, type UnifiedSearchResult } from "@/lib/api"
import { useAppStore } from "@/store"
import { cn } from "@/lib/cn"
import { Spinner } from "@/components/Spinner"
import { EmptyState } from "@/components/EmptyState"
import { getPerformerAvatarSrc } from "@/lib/performer"

type ResultTab = "all" | "creators" | "media"

function readQueryFromHash(): string {
  const hash = window.location.hash
  const qIdx = hash.indexOf("?")
  if (qIdx === -1) return ""
  return new URLSearchParams(hash.slice(qIdx + 1)).get("q") || ""
}

function ResultMediaCard({ result }: { result: Extract<UnifiedSearchResult, { type: "media" }> }) {
  const setActiveView = useAppStore((s) => s.setActiveView)
  return (
    <button
      onClick={() => {
        window.location.hash = `#/media?term=${encodeURIComponent(result.title)}`
        setActiveView("images")
      }}
      className="group relative flex flex-col gap-2 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2 text-left transition-colors hover:bg-white/[0.06] hover:border-white/15"
    >
      <div className="relative aspect-square overflow-hidden rounded-xl bg-white/5">
        {result.thumbnail ? (
          <img
            src={result.thumbnail}
            alt={result.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl text-white/10">
            🖼
          </div>
        )}
      </div>
      <div className="px-1 pb-1">
        <p className="truncate text-xs font-medium text-text-primary">{result.title}</p>
        {result.performer_username && (
          <p className="truncate text-[10px] text-text-muted">@{result.performer_username}</p>
        )}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-text-muted">
          <span className="flex items-center gap-0.5">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            {result.views_count.toLocaleString()}
          </span>
          <span className="flex items-center gap-0.5">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            {result.likes_count.toLocaleString()}
          </span>
        </div>
      </div>
    </button>
  )
}

function ResultCreatorCard({ result }: { result: Extract<UnifiedSearchResult, { type: "creator" }> }) {
  const setActiveView = useAppStore((s) => s.setActiveView)
  const avatar = getPerformerAvatarSrc(result as any) ?? result.avatar_url
  return (
    <button
      onClick={() => {
        window.location.hash = `#/performers?id=${result.id}`
        setActiveView("performers")
      }}
      className="group flex flex-col items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-left transition-colors hover:bg-white/[0.06] hover:border-white/15"
    >
      <div className="relative h-16 w-16 overflow-hidden rounded-full bg-white/10">
        {avatar ? (
          <img
            src={avatar}
            alt={result.display_name ?? result.username}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xl text-white/40">
            {(result.display_name ?? result.username).charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="text-center">
        <p className="truncate text-xs font-medium text-text-primary group-hover:text-accent">
          {result.display_name ?? result.username}
        </p>
        <p className="truncate text-[10px] text-text-muted">{result.platform}</p>
        <p className="mt-0.5 text-[10px] text-text-muted">
          {result.follower_count.toLocaleString()} followers · {result.media_count.toLocaleString()} media
        </p>
      </div>
    </button>
  )
}

function ResultTagCard({ result }: { result: Extract<UnifiedSearchResult, { type: "tag" }> }) {
  const setActiveView = useAppStore((s) => s.setActiveView)
  return (
    <button
      onClick={() => {
        window.location.hash = `#/media?tag=${encodeURIComponent(result.tag)}`
        setActiveView("images")
      }}
      className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-left transition-colors hover:bg-white/[0.06] hover:border-white/15"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">
        #
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-text-primary">{result.tag}</p>
        <p className="text-[10px] text-text-muted">{result.count.toLocaleString()} items</p>
      </div>
    </button>
  )
}

function ResultPlaylistCard({ result }: { result: Extract<UnifiedSearchResult, { type: "playlist" }> }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-[11px] font-semibold text-text-muted">
        ▶
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-text-primary">{result.name}</p>
        <p className="text-[10px] text-text-muted">{result.item_count.toLocaleString()} items</p>
      </div>
    </div>
  )
}

export function SearchResultsPage() {
  const [query, setQuery] = useState(() => readQueryFromHash())
  const [activeTab, setActiveTab] = useState<ResultTab>("all")

  useEffect(() => {
    function onHashChange() {
      setQuery(readQueryFromHash())
    }
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ["unified-search", query, activeTab],
    queryFn: () => api.unifiedSearch(query, activeTab === "all" ? undefined : activeTab, 40),
    enabled: query.trim().length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const results = data?.results ?? []

  const tabs: { id: ResultTab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "creators", label: "Creators" },
    { id: "media", label: "Media" },
  ]

  const filteredResults = useMemo(() => {
    if (activeTab === "all") return results
    return results.filter((r) => {
      if (activeTab === "creators") return r.type === "creator"
      if (activeTab === "media") return r.type === "media" || r.type === "tag" || r.type === "playlist"
      return true
    })
  }, [results, activeTab])

  return (
    <div className="mx-auto max-w-[1680px]">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
          {query ? `Results for "${query}"` : "Search"}
        </h1>
        {query && !isLoading && (
          <p className="mt-1 text-sm text-text-muted">
            {data?.total ?? 0} result{data?.total === 1 ? "" : "s"} found
          </p>
        )}
      </div>

      <div className="mb-6 flex items-center gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-accent/15 text-accent"
                : "text-text-secondary hover:bg-white/[0.04] hover:text-text-primary"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Spinner size="lg" label="Searching..." />
        </div>
      )}

      {!isLoading && query.trim().length === 0 && (
        <EmptyState
          icon="🔎"
          eyebrow="Start searching"
          title="Enter a search term"
          description="Search across your media library, creators, tags, and playlists."
        />
      )}

      {!isLoading && query.trim().length > 0 && filteredResults.length === 0 && (
        <EmptyState
          icon="🔎"
          eyebrow="No results"
          title={`Nothing found for "${query}"`}
          description="Try a different search term or check your spelling."
        />
      )}

      {!isLoading && filteredResults.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filteredResults.map((result) => {
            if (result.type === "media") return <ResultMediaCard key={`media-${result.id}`} result={result} />
            if (result.type === "creator") return <ResultCreatorCard key={`creator-${result.id}`} result={result} />
            if (result.type === "tag") return <ResultTagCard key={`tag-${result.tag}`} result={result} />
            if (result.type === "playlist") return <ResultPlaylistCard key={`playlist-${result.id}`} result={result} />
            return null
          })}
        </div>
      )}
    </div>
  )
}
