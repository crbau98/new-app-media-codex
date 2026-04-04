# Media Section Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the media section as a clean Instagram Explore-style grid with inline video playback, smart search, and minimal chrome. Cut MediaPage from 1609 lines to ~600.

**Architecture:** Single-file MediaPage rewrite. Extract Telegram UI to its own file. New `InlineVideoPlayer` component for the expand-in-grid behavior. Keep existing ScreenshotLightbox for images only. No new backend changes needed — all existing API endpoints stay the same.

**Tech Stack:** React 19, TanStack Query 5, Zustand, Tailwind CSS 4, IntersectionObserver API

---

## Task 1: Extract Telegram UI to Separate File

**Files:**
- Create: `frontend/src/features/images/TelegramSection.tsx`
- Modify: `frontend/src/features/images/MediaPage.tsx`

**Step 1: Create TelegramSection.tsx**

Move these components from MediaPage.tsx into the new file:
- `TelegramVideosTab` (lines 345-403 + the JSX below)
- `TelegramChannelsTab` (the channels management UI with discover modal, lines ~404-721)
- `VideoPlayerModal` (lines 724-776)
- `FilterChip` component (lines 89-111 — copy it, both files need it)

The new file should:
```typescript
import React, { useState, useCallback, useRef, useMemo, useEffect } from "react"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { api, type TelegramMedia } from "@/lib/api"
import { useAppStore } from "@/store"
import { cn } from "@/lib/cn"
import { Spinner } from "@/components/Spinner"

// Paste FilterChip, TelegramVideosTab, TelegramChannelsTab, VideoPlayerModal here
// Export: TelegramSection (a wrapper that renders both tabs)

export function TelegramSection() {
  const [telegramTab, setTelegramTab] = useState<'channels' | 'videos'>('channels')
  return (
    <section className="panel-surface rounded-[28px] px-6 py-6 space-y-4">
      <div className="flex items-center gap-1">
        {(['channels', 'videos'] as const).map((tab) => (
          <button key={tab} onClick={() => setTelegramTab(tab)}
            className={cn(
              'rounded-2xl px-4 py-2 text-sm capitalize transition-colors',
              telegramTab === tab
                ? 'bg-accent/12 text-text-primary border border-accent/35'
                : 'text-text-muted hover:text-text-primary'
            )}>
            {tab}
          </button>
        ))}
      </div>
      {telegramTab === 'channels' ? <TelegramChannelsTab /> : <TelegramVideosTab />}
    </section>
  )
}
```

**Step 2: Remove extracted code from MediaPage.tsx**

Delete `TelegramVideosTab`, `TelegramChannelsTab`, `VideoPlayerModal` from MediaPage.tsx. Import `TelegramSection` from the new file where the Telegram section is rendered.

**Step 3: Verify build**

```bash
cd frontend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add frontend/src/features/images/TelegramSection.tsx frontend/src/features/images/MediaPage.tsx
git commit -m "refactor: extract Telegram UI from MediaPage into TelegramSection"
```

---

## Task 2: Create InlineVideoPlayer Component

**Files:**
- Create: `frontend/src/features/images/InlineVideoPlayer.tsx`

**Step 1: Write the component**

```tsx
import { useEffect, useRef, useState } from "react"
import { api, type Screenshot } from "@/lib/api"
import { cn } from "@/lib/cn"

function sourceLabel(source: string) {
  return source === "ddg" ? "DDG" : source === "redgifs" ? "Redgifs" : source === "x" ? "X" : source
}

interface Props {
  shot: Screenshot
  onClose: () => void
  onDelete: () => void
  favorite: boolean
  onToggleFavorite: () => void
}

export function InlineVideoPlayer({ shot, onClose, onDelete, favorite, onToggleFavorite }: Props) {
  const src = shot.local_url ?? shot.page_url
  const videoRef = useRef<HTMLVideoElement>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [summary, setSummary] = useState<string | null>(shot.ai_summary ?? null)

  // Auto-focus for keyboard events
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => { containerRef.current?.focus() }, [])

  // Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function handleDescribe() {
    setSummarizing(true)
    try {
      const result = await api.summarizeScreenshot(shot.id)
      if (result.summary) setSummary(result.summary)
    } catch {}
    setSummarizing(false)
  }

  return (
    <div ref={containerRef} tabIndex={-1}
      className="col-span-full animate-in fade-in slide-in-from-top-2 duration-300 outline-none">
      <div className="overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} src={src ?? undefined} controls autoPlay
          className="mx-auto max-h-[70vh] w-full object-contain" />
      </div>
      <div className="flex items-center justify-between gap-4 px-2 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-primary truncate">{shot.term}</p>
          <p className="text-xs text-text-muted">
            {sourceLabel(shot.source)} · {shot.captured_at ? new Date(shot.captured_at).toLocaleDateString() : ""}
          </p>
          {summary && <p className="mt-1 text-xs text-text-secondary line-clamp-2">{summary}</p>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onToggleFavorite} title={favorite ? "Unfavorite" : "Favorite"}
            className={cn("rounded-full p-2 text-sm transition-colors",
              favorite ? "text-red-400" : "text-text-muted hover:text-red-400")}>
            {favorite ? "♥" : "♡"}
          </button>
          {shot.page_url && (
            <a href={shot.page_url} target="_blank" rel="noopener noreferrer"
              className="rounded-full p-2 text-text-muted hover:text-text-primary" title="Open source">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>
            </a>
          )}
          <button onClick={handleDescribe} disabled={summarizing}
            className="rounded-full p-2 text-text-muted hover:text-text-primary disabled:opacity-50" title="AI Describe">
            {summarizing ? "…" : "✦"}
          </button>
          <button onClick={onDelete}
            className="rounded-full p-2 text-text-muted hover:text-red-400" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
          <button onClick={onClose}
            className="rounded-full p-2 text-text-muted hover:text-text-primary" title="Close">
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Verify build**

```bash
cd frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/features/images/InlineVideoPlayer.tsx
git commit -m "feat: create InlineVideoPlayer component for expand-in-grid video"
```

---

## Task 3: Rewrite MediaPage — Core Structure

This is the main rewrite. Replace the entire `MediaPage` component and its inline subcomponents with the new design. Keep `ScreenshotLightbox` import for images.

**Files:**
- Rewrite: `frontend/src/features/images/MediaPage.tsx`

**Step 1: Rewrite the file**

The new MediaPage should be structured as:

```tsx
import React, { useState, useCallback, useRef, useMemo, useEffect } from "react"
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, type Screenshot, type ScreenshotTerm } from "@/lib/api"
import { useAppStore } from "@/store"
import { Spinner } from "@/components/Spinner"
import { cn } from "@/lib/cn"
import { ScreenshotLightbox } from "./ScreenshotLightbox"
import { InlineVideoPlayer } from "./InlineVideoPlayer"

// ── Helpers ──────────────────────────────────────────────────────

const FAVORITES_KEY = "screenshot-favorites"

function isVideo(src: string) {
  return /\.(mp4|webm|mov)$/i.test(src)
}

function loadFavorites(): Set<number> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    return new Set((raw ? JSON.parse(raw) : []).filter((v: unknown): v is number => typeof v === "number"))
  } catch { return new Set() }
}

function saveFavorites(s: Set<number>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...s]))
}

function sourceLabel(s: string) {
  return s === "ddg" ? "DDG" : s === "redgifs" ? "Redgifs" : s === "x" ? "X" : s
}

type SortOrder = "newest" | "oldest" | "az"
type TabFilter = "all" | "favorites" | "videos" | "images" | string  // string = source name

function readHashTerm(): string | null {
  const hash = window.location.hash
  const q = hash.indexOf("?")
  if (q === -1) return null
  return new URLSearchParams(hash.slice(q + 1)).get("term")
}

function writeHashTerm(term: string | null) {
  const base = window.location.hash.split("?")[0] || "#/media"
  if (term) {
    window.location.hash = `${base}?term=${encodeURIComponent(term)}`
  } else {
    window.location.hash = base
  }
}

// ── MediaCard ────────────────────────────────────────────────────

function MediaCard({
  shot, onClick, selected, onSelect, favorite,
}: {
  shot: Screenshot
  onClick: () => void
  selected: boolean
  onSelect?: () => void
  favorite: boolean
}) {
  const src = shot.local_url ?? shot.page_url
  const video = src ? isVideo(src) : false
  const [broken, setBroken] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  if (!src || broken) return null

  return (
    <div
      role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter") onClick() }}
      className={cn(
        "group relative aspect-square cursor-pointer overflow-hidden bg-black/20",
        selected && "ring-2 ring-accent ring-inset"
      )}
    >
      {video ? (
        <video ref={videoRef} src={src} muted playsInline preload="metadata"
          onError={() => setBroken(true)}
          onMouseEnter={() => videoRef.current?.play().catch(() => {})}
          onMouseLeave={() => { const v = videoRef.current; if (v) { v.pause(); v.currentTime = 0 } }}
          className="h-full w-full object-cover" />
      ) : (
        <img src={src} alt="" loading="lazy" decoding="async"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover" />
      )}

      {/* Video play icon — always visible */}
      {video && (
        <div className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 p-1">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
        </div>
      )}

      {/* Favorite indicator — always visible when favorited */}
      {favorite && (
        <div className="absolute top-1.5 right-1.5 text-red-400 text-xs drop-shadow">♥</div>
      )}

      {/* Selection checkbox — visible in batch mode */}
      {onSelect && (
        <button onClick={(e) => { e.stopPropagation(); onSelect() }}
          className={cn(
            "absolute top-1.5 left-1.5 flex h-6 w-6 items-center justify-center rounded-full border text-xs backdrop-blur-sm transition-colors",
            selected ? "border-accent bg-accent text-white" : "border-white/40 bg-black/40 text-transparent"
          )}>
          ✓
        </button>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100">
        <div className="absolute bottom-0 inset-x-0 p-2">
          <p className="text-xs font-medium text-white truncate">{shot.term}</p>
          <p className="text-[10px] text-white/60">{sourceLabel(shot.source)}</p>
        </div>
      </div>
    </div>
  )
}

// ── MediaPage ────────────────────────────────────────────────────

export function MediaPage() {
  const [term, setTerm] = useState<string | null>(readHashTerm)
  const [tab, setTab] = useState<TabFilter>("all")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortOrder>(
    () => (localStorage.getItem("media-sort-order") as SortOrder) ?? "newest"
  )
  const [expandedVideoId, setExpandedVideoId] = useState<number | null>(null)
  const [lightboxShotId, setLightboxShotId] = useState<number | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [favorites, setFavorites] = useState(loadFavorites)
  const [aiResults, setAiResults] = useState<Screenshot[] | null>(null)

  const addToast = useAppStore((s) => s.addToast)
  const qc = useQueryClient()

  // Sync term to hash
  useEffect(() => { writeHashTerm(term) }, [term])

  // ── Queries ──────────────────────────────

  const { data: statusData } = useQuery({
    queryKey: ["screenshot-status"],
    queryFn: api.screenshotStatus,
    refetchInterval: (q) => (q.state.data?.running ? 2_000 : 30_000),
  })
  const capturing = statusData?.running ?? false

  const { data: termsData } = useQuery({
    queryKey: ["screenshot-terms"],
    queryFn: api.screenshotTerms,
    staleTime: 60_000,
  })
  const terms = termsData ?? []

  const { data: sourceData } = useQuery({
    queryKey: ["screenshot-sources"],
    queryFn: api.screenshotSources,
    staleTime: 60_000,
  })
  const sources = sourceData ?? []

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["screenshots", term],
    queryFn: ({ pageParam = 0 }) =>
      api.browseScreenshots({ ...(term ? { term } : {}), limit: 60, offset: pageParam as number }),
    getNextPageParam: (last) => (last.has_more ? last.offset + last.screenshots.length : undefined),
    initialPageParam: 0,
  })

  const allShots = useMemo(() => data?.pages.flatMap((p) => p.screenshots) ?? [], [data])

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.screenshotDelete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["screenshots"] })
      addToast("Deleted", "success")
    },
  })

  // ── Smart search (local + FTS fallback) ──

  useEffect(() => {
    if (!search.trim()) { setAiResults(null); return }
    // If 3+ words, try FTS
    const words = search.trim().split(/\s+/)
    if (words.length >= 3) {
      const timer = setTimeout(async () => {
        try {
          const r = await api.searchScreenshots(search.trim())
          setAiResults(r.length > 0 ? r : null)
        } catch { setAiResults(null) }
      }, 400)
      return () => clearTimeout(timer)
    } else {
      setAiResults(null)
    }
  }, [search])

  // ── Derived data ──────────────────────────

  const visibleShots = useMemo(() => {
    if (aiResults !== null) return aiResults

    let filtered = [...allShots]

    // Tab filters
    if (tab === "favorites") filtered = filtered.filter((s) => favorites.has(s.id))
    else if (tab === "videos") filtered = filtered.filter((s) => isVideo(s.local_url ?? s.page_url ?? ""))
    else if (tab === "images") filtered = filtered.filter((s) => !isVideo(s.local_url ?? s.page_url ?? ""))
    else if (tab !== "all") filtered = filtered.filter((s) => s.source === tab) // source filter

    // Text search (local)
    if (search.trim()) {
      const q = search.toLowerCase()
      filtered = filtered.filter((s) =>
        [s.term, s.source, s.page_url, s.ai_summary].join(" ").toLowerCase().includes(q)
      )
    }

    // Sort
    filtered.sort((a, b) => {
      if (sort === "newest") return (b.captured_at ?? "").localeCompare(a.captured_at ?? "")
      if (sort === "oldest") return (a.captured_at ?? "").localeCompare(b.captured_at ?? "")
      return a.term.localeCompare(b.term)
    })
    return filtered
  }, [aiResults, allShots, favorites, search, sort, tab])

  // Group by term when viewing all without a specific term filter
  const groupedByTerm = useMemo(() => {
    if (term || search.trim()) return null
    const map = new Map<string, Screenshot[]>()
    for (const s of visibleShots) {
      const arr = map.get(s.term)
      if (arr) arr.push(s); else map.set(s.term, [s])
    }
    return map
  }, [term, search, visibleShots])

  // ── Actions ───────────────────────────────

  function toggleFav(id: number) {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      saveFavorites(next)
      return next
    })
  }

  function handleClick(shot: Screenshot) {
    if (batchMode) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(shot.id)) next.delete(shot.id); else next.add(shot.id)
        return next
      })
      return
    }
    const src = shot.local_url ?? shot.page_url ?? ""
    if (isVideo(src)) {
      setExpandedVideoId((prev) => (prev === shot.id ? null : shot.id))
    } else {
      setLightboxShotId(shot.id)
    }
  }

  async function handleCapture() {
    try {
      await api.triggerCapture()
      addToast("Capture started", "success")
    } catch {
      addToast("Failed to start capture", "error")
    }
  }

  // Keyboard: Escape closes expanded video, M toggles batch
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return
      if (e.key === "Escape") setExpandedVideoId(null)
      if (e.key === "m" && !e.metaKey && !e.ctrlKey) {
        setBatchMode((v) => { if (v) setSelectedIds(new Set()); return !v })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Infinite scroll sentinel
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    })
    obs.observe(node)
    return () => obs.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  // Autoplay videos in viewport
  useEffect(() => {
    const videos = document.querySelectorAll<HTMLVideoElement>("[data-autoplay-grid]")
    if (!videos.length) return
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const v = e.target as HTMLVideoElement
        if (e.isIntersecting) v.play().catch(() => {})
        else { v.pause(); v.currentTime = 0 }
      })
    }, { threshold: 0.5 })
    videos.forEach((v) => obs.observe(v))
    return () => obs.disconnect()
  }, [visibleShots])

  const lightboxIdx = lightboxShotId != null ? visibleShots.findIndex((s) => s.id === lightboxShotId) : -1
  const totalCount = sources.reduce((acc, s) => acc + s.count, 0)

  // ── Render ────────────────────────────────

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3">

      {/* Capture progress */}
      {statusData?.running && statusData.current_term && (
        <div className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-4 py-2">
          <div className="h-1 flex-1 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full gradient-accent rounded-full transition-all duration-500"
              style={{ width: `${((statusData.terms_done || 0) / (statusData.terms_total || 1)) * 100}%` }} />
          </div>
          <span className="text-xs text-text-muted whitespace-nowrap">
            {statusData.current_term} · {statusData.items_found || 0} found
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search media..."
            className="w-full rounded-lg border border-white/8 bg-white/[0.03] py-2.5 pl-9 pr-8 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/40" />
          {search && (
            <button onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">×</button>
          )}
        </div>
        <select value={sort}
          onChange={(e) => { const v = e.target.value as SortOrder; setSort(v); localStorage.setItem("media-sort-order", v) }}
          className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm text-text-secondary">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="az">A–Z</option>
        </select>
        <button onClick={() => setBatchMode((v) => { if (v) setSelectedIds(new Set()); return !v })}
          className={cn("rounded-lg px-3 py-2.5 text-sm transition-colors",
            batchMode ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-primary")}>
          {batchMode ? "Cancel" : "Select"}
        </button>
        <button onClick={handleCapture} disabled={capturing}
          className="rounded-lg bg-accent/12 border border-accent/30 px-3 py-2.5 text-sm font-medium text-text-primary disabled:opacity-50">
          {capturing ? "…" : "Capture"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto hide-scrollbar border-b border-white/6 pb-px">
        {[
          { id: "all" as TabFilter, label: `All (${totalCount})` },
          ...sources.map((s) => ({ id: s.source as TabFilter, label: `${sourceLabel(s.source)} (${s.count})` })),
          { id: "favorites" as TabFilter, label: `♥ Favorites (${favorites.size})` },
          { id: "videos" as TabFilter, label: "Videos" },
          { id: "images" as TabFilter, label: "Images" },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn("whitespace-nowrap px-3 py-2 text-sm transition-colors border-b-2",
              tab === t.id ? "border-accent text-text-primary" : "border-transparent text-text-muted hover:text-text-secondary")}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Term header — shown when filtered to a term */}
      {term && (
        <div className="flex items-center gap-2">
          <button onClick={() => setTerm(null)} className="text-text-muted hover:text-text-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <h2 className="text-lg font-semibold text-text-primary">{term}</h2>
        </div>
      )}

      {/* Loading */}
      {isLoading && <div className="flex justify-center py-16"><Spinner /></div>}

      {/* Empty state */}
      {!isLoading && visibleShots.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <p className="text-text-muted">No media found</p>
          <button onClick={handleCapture} disabled={capturing}
            className="rounded-lg bg-accent/12 border border-accent/30 px-4 py-2 text-sm text-text-primary">
            Capture now
          </button>
        </div>
      )}

      {/* Grid — grouped by term */}
      {!isLoading && groupedByTerm && !term && visibleShots.length > 0 && (
        <div className="space-y-6">
          {[...groupedByTerm.entries()].map(([groupTerm, shots]) => (
            <section key={groupTerm}>
              <button onClick={() => setTerm(groupTerm)}
                className="mb-2 text-sm font-semibold text-text-secondary hover:text-text-primary transition-colors">
                {groupTerm} <span className="text-text-muted font-normal">({shots.length})</span>
              </button>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1">
                {shots.map((shot) => {
                  if (expandedVideoId === shot.id) {
                    return (
                      <InlineVideoPlayer key={shot.id} shot={shot}
                        onClose={() => setExpandedVideoId(null)}
                        onDelete={() => deleteMut.mutate(shot.id)}
                        favorite={favorites.has(shot.id)}
                        onToggleFavorite={() => toggleFav(shot.id)} />
                    )
                  }
                  const shotSrc = shot.local_url ?? shot.page_url ?? ""
                  return (
                    <div key={shot.id} className={isVideo(shotSrc) ? "col-span-2 row-span-2" : ""}>
                      <MediaCard shot={shot} onClick={() => handleClick(shot)}
                        selected={selectedIds.has(shot.id)}
                        onSelect={batchMode ? () => {
                          setSelectedIds((p) => { const n = new Set(p); if (n.has(shot.id)) n.delete(shot.id); else n.add(shot.id); return n })
                        } : undefined}
                        favorite={favorites.has(shot.id)} />
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Grid — flat (term selected or searching) */}
      {!isLoading && (term || search.trim()) && visibleShots.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1">
          {visibleShots.map((shot) => {
            if (expandedVideoId === shot.id) {
              return (
                <InlineVideoPlayer key={shot.id} shot={shot}
                  onClose={() => setExpandedVideoId(null)}
                  onDelete={() => deleteMut.mutate(shot.id)}
                  favorite={favorites.has(shot.id)}
                  onToggleFavorite={() => toggleFav(shot.id)} />
              )
            }
            const shotSrc = shot.local_url ?? shot.page_url ?? ""
            return (
              <div key={shot.id} className={isVideo(shotSrc) ? "col-span-2 row-span-2" : ""}>
                <MediaCard shot={shot} onClick={() => handleClick(shot)}
                  selected={selectedIds.has(shot.id)}
                  onSelect={batchMode ? () => {
                    setSelectedIds((p) => { const n = new Set(p); if (n.has(shot.id)) n.delete(shot.id); else n.add(shot.id); return n })
                  } : undefined}
                  favorite={favorites.has(shot.id)} />
              </div>
            )
          })}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-4" />
      {isFetchingNextPage && <div className="flex justify-center py-4"><Spinner /></div>}

      {/* Batch action bar */}
      {batchMode && selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between border-t border-white/10 bg-[var(--color-bg-base)]/95 backdrop-blur-xl px-6 py-3"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 12px)" }}>
          <span className="text-sm text-text-secondary">{selectedIds.size} selected</span>
          <div className="flex gap-2">
            <button onClick={() => {
              selectedIds.forEach((id) => toggleFav(id))
              addToast(`${selectedIds.size} favorited`, "success")
            }} className="rounded-lg px-3 py-1.5 text-xs glass">Favorite</button>
            <button onClick={() => {
              selectedIds.forEach((id) => deleteMut.mutate(id))
              setSelectedIds(new Set())
              setBatchMode(false)
            }} className="rounded-lg px-3 py-1.5 text-xs text-red-400 glass">Delete</button>
          </div>
        </div>
      )}

      {/* Image lightbox */}
      {lightboxShotId != null && lightboxIdx >= 0 && (
        <ScreenshotLightbox
          shots={visibleShots}
          idx={lightboxIdx}
          onClose={() => setLightboxShotId(null)}
          onNavigate={(i) => setLightboxShotId(visibleShots[i]?.id ?? null)}
          favorites={favorites}
          onToggleFavorite={toggleFav}
        />
      )}
    </div>
  )
}
```

Key changes from old code:
- 1609 lines → ~400 lines
- No hero banner, no stat cards, no view mode toggles, no grid size chips
- Single search bar with smart FTS fallback
- Tab-based filtering (source, type, favorites — one row)
- `MediaCard`: square 1:1 cards, no overlays by default, hover reveals info
- Grid: `gap-1`, no rounded corners, tight like Instagram
- Videos: click expands `InlineVideoPlayer` in-grid instead of lightbox
- Images: still use lightbox
- Term section headers that are clickable to filter
- Removed Telegram UI (already extracted to TelegramSection.tsx)

**Step 2: Verify build**

```bash
cd frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/features/images/MediaPage.tsx
git commit -m "feat: rewrite MediaPage as Instagram-style grid with inline video"
```

---

## Task 4: Add Video Autoplay via IntersectionObserver

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx`

**Step 1: Add data attribute to grid videos**

In the `MediaCard` component, add `data-autoplay-grid` to the `<video>` element:

```tsx
<video ref={videoRef} src={src} muted playsInline preload="metadata"
  data-autoplay-grid
  onError={() => setBroken(true)}
  ...
```

**Step 2: Add the IntersectionObserver effect**

This should already be in the Task 3 code (the `useEffect` with `[data-autoplay-grid]` selector). Verify it works by:
1. Scrolling — videos should start playing when they enter the viewport
2. Scrolling past — videos should pause

If the global `useEffect` approach doesn't work reliably (because React re-renders clear DOM references), move the observer into the `MediaCard` component itself using a ref-based approach:

```tsx
// Inside MediaCard, replace the onMouseEnter/onMouseLeave with:
useEffect(() => {
  if (!video || !videoRef.current) return
  const v = videoRef.current
  const obs = new IntersectionObserver(([e]) => {
    if (e.isIntersecting) v.play().catch(() => {})
    else { v.pause(); v.currentTime = 0 }
  }, { threshold: 0.5 })
  obs.observe(v)
  return () => obs.disconnect()
}, [video])
```

**Step 3: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/features/images/MediaPage.tsx
git commit -m "feat: autoplay grid videos via IntersectionObserver"
```

---

## Task 5: Update CSS for New Grid Style

**Files:**
- Modify: `frontend/src/index.css`

**Step 1: Add hide-scrollbar if not present, and animate-in utility**

Check if `hide-scrollbar` class exists. If not, add:

```css
.hide-scrollbar::-webkit-scrollbar { display: none; }
.hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
```

Add animation for inline video expand:

```css
@keyframes animate-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
.animate-in { animation: animate-in 200ms ease-out; }
```

**Step 2: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: add grid animation utilities for media redesign"
```

---

## Task 6: Build and Verify

**Step 1: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Fix any type errors.

**Step 2: Production build**

```bash
cd frontend && npm run build
```

Verify it builds cleanly and check bundle sizes.

**Step 3: Restart backend and verify app loads**

```bash
# Kill existing server
lsof -ti :8000 | xargs kill -9 2>/dev/null
# Start fresh
cd /Users/chasebauman/Documents/App\ research\ codex
.venv/bin/python -m uvicorn app.main:app --port 8000 &
```

Open http://localhost:8000 and verify:
- Grid renders with square cards, tight gaps
- Videos show play indicator
- Clicking a video expands inline with controls
- Clicking an image opens lightbox
- Search works (local and FTS)
- Tab filtering works (All, DDG, Redgifs, Favorites, Videos, Images)
- Batch mode works (M key, select, delete/favorite)
- Infinite scroll loads more content

**Step 4: Commit build output**

The build output goes to `app/static/dist/` which is gitignored, so no commit needed.

**Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address build issues from media redesign"
```
