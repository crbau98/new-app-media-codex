import { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense, startTransition, memo, useDeferredValue } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import { cn } from "@/lib/cn"
import { api, type Performer, type DiscoveredCreator, type CaptureQueueEntry } from "@/lib/api"
import { getPerformerAvatarSrc } from "@/lib/performer"
import { getBestAvailablePreviewSrc, getScreenshotMediaSrc, isVideoShot } from "@/lib/media"
import { useAppStore } from "@/store"
import { useDebounce } from "@/hooks/useDebounce"
import { Skeleton } from "@/components/Skeleton"
import { EmptyState } from "@/components/EmptyState"
import { PerformerProfile } from "./PerformerProfile"

const PerformerAnalyticsPanel = lazy(() => import("./PerformerAnalyticsPanel").then((m) => ({ default: m.PerformerAnalyticsPanel })))

const PLATFORMS = ["OnlyFans", "Twitter/X", "Instagram", "Reddit", "Fansly"] as const
type Platform = (typeof PLATFORMS)[number]

const PLATFORM_COLORS: Record<string, string> = {
  OnlyFans: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  "Twitter/X": "bg-neutral-500/20 text-neutral-300 border-neutral-500/30",
  Instagram: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  Reddit: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  Fansly: "bg-violet-500/20 text-violet-300 border-violet-500/30",
}

const AVATAR_GRADIENTS = [
  "from-sky-500 to-indigo-600",
  "from-rose-500 to-pink-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-violet-500 to-purple-600",
  "from-cyan-500 to-blue-600",
  "from-fuchsia-500 to-pink-600",
  "from-lime-500 to-green-600",
]

function getAvatarGradient(username: string): string {
  let hash = 0
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]
}

function AvatarPlaceholder({ username, size = "md" }: { username: string; size?: "sm" | "md" | "lg" }) {
  const gradient = getAvatarGradient(username)
  const textSize = size === "lg" ? "text-2xl" : size === "md" ? "text-lg" : "text-sm"
  return (
    <div className={cn("flex h-full w-full items-center justify-center bg-gradient-to-br", gradient)}>
      <span className={cn("font-bold text-white/90 drop-shadow-sm", textSize)}>
        {username.charAt(0).toUpperCase()}
      </span>
    </div>
  )
}

type SortOption = "newest" | "az" | "most_media" | "subscription_price" | "subscription_renewed_at" | "screenshots_count" | "last_checked_at"

function parseTags(tags: string | null): string[] {
  if (!tags) return []
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return tags.split(",").map((t) => t.trim()).filter(Boolean)
  }
}

/* ── Stats Bar (clean, minimal) ────────────────────────────────────────── */

function useCreatorStats() {
  return useQuery({
    queryKey: ["performer-stats"],
    queryFn: () => api.performerStats(),
    staleTime: 30_000,
  })
}

/* ── Add Creator Form ──────────────────────────────────────────────────── */

function AddCreatorForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const addToast = useAppStore((s) => s.addToast)

  const [username, setUsername] = useState("")
  const [platform, setPlatform] = useState<Platform>("OnlyFans")
  const [displayName, setDisplayName] = useState("")
  const [profileUrl, setProfileUrl] = useState("")
  const [tagsInput, setTagsInput] = useState("")
  const [bio, setBio] = useState("")

  const mutation = useMutation({
    mutationFn: () =>
      api.addPerformer({
        username: username.trim(),
        platform,
        display_name: displayName.trim() || undefined,
        profile_url: profileUrl.trim() || undefined,
        tags: tagsInput.trim() ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
        bio: bio.trim() || undefined,
      }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["performers"] })
      qc.invalidateQueries({ queryKey: ["performer-stats"] })
      qc.invalidateQueries({ queryKey: ["capture-queue"] })
      addToast("Creator added — capture queued", "success")
      api.enrichPerformer(p.id).then(() => qc.invalidateQueries({ queryKey: ["performers"] })).catch((err) => addToast(`Avatar enrichment failed: ${err?.message || 'unknown error'}`, "error"))
      onClose()
    },
    onError: () => addToast("Failed to add creator", "error"),
  })

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
      <h3 className="mb-4 text-sm font-medium text-text-primary">Add Creator</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-text-muted">Username *</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-muted">Platform *</label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-muted">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Optional"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-muted">Profile URL</label>
          <input
            type="text"
            value={profileUrl}
            onChange={(e) => setProfileUrl(e.target.value)}
            placeholder="https://..."
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-muted">Tags (comma-separated)</label>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="tag1, tag2, tag3"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-text-muted">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={2}
            placeholder="Optional bio / notes..."
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none resize-none"
          />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => mutation.mutate()}
          disabled={!username.trim() || mutation.isPending}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {mutation.isPending ? "Adding..." : "Add"}
        </button>
        <button
          onClick={onClose}
          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/* ── Discovery Modal ───────────────────────────────────────────────────── */

const SUGGESTED_CREATORS: DiscoveredCreator[] = [
  { username: "jakipz",             display_name: "Jakipz",         platform: "OnlyFans",  bio: "Gay OnlyFans creator",           tags: ["twink", "latino"] },
  { username: "hoguesdirtylaundry", display_name: "Hogue",          platform: "Twitter/X", bio: "Gay creator on Twitter/X",        tags: ["hairy", "bear"] },
  { username: "michaelyerger",      display_name: "Michael Yerger", platform: "OnlyFans",  bio: "Survivor contestant & creator",  tags: ["fitness", "muscle"] },
  { username: "sebastiancox",       display_name: "Sebastian Cox",  platform: "OnlyFans",  bio: "Gay muscle content creator",     tags: ["muscle"] },
  { username: "austinwolf",         display_name: "Austin Wolf",    platform: "OnlyFans",  bio: "Muscle daddy creator",           tags: ["muscle", "daddy"] },
  { username: "cademaddox",         display_name: "Cade Maddox",    platform: "OnlyFans",  bio: "Gay muscle performer",           tags: ["muscle"] },
  { username: "jjknight",           display_name: "JJ Knight",      platform: "OnlyFans",  bio: "Hung gay performer",             tags: ["hung", "muscle"] },
  { username: "ryanbones",          display_name: "Ryan Bones",     platform: "OnlyFans",  bio: "Gay adult creator",              tags: ["muscle"] },
  { username: "drewvalentino",      display_name: "Drew Valentino", platform: "OnlyFans",  bio: "Twink OnlyFans creator",         tags: ["twink"] },
  { username: "blakemitchell",      display_name: "Blake Mitchell", platform: "OnlyFans",  bio: "Popular gay performer",          tags: ["twink"] },
  { username: "alexmecum",          display_name: "Alex Mecum",     platform: "OnlyFans",  bio: "Bear muscle performer",          tags: ["muscle", "bear"] },
  { username: "colbykeller",        display_name: "Colby Keller",   platform: "OnlyFans",  bio: "Artist & gay performer",         tags: ["muscle", "artist"] },
  { username: "levicharming",       display_name: "Levi Charming",  platform: "OnlyFans",  bio: "Twink OnlyFans creator",         tags: ["twink"] },
  { username: "brenteverett",       display_name: "Brent Everett",  platform: "OnlyFans",  bio: "Veteran gay performer",          tags: ["muscle"] },
  { username: "nickfitt",           display_name: "Nick Fitt",      platform: "OnlyFans",  bio: "Muscle gay creator",             tags: ["muscle"] },
  { username: "pierrefitch",        display_name: "Pierre Fitch",   platform: "OnlyFans",  bio: "Athletic gay performer",         tags: ["athletic"] },
  { username: "troyedean",          display_name: "Troye Dean",     platform: "OnlyFans",  bio: "Twink gay performer",            tags: ["twink"] },
  { username: "devinfrancoxx",      display_name: "Devin Franco",   platform: "OnlyFans",  bio: "Muscle gay creator",             tags: ["muscle"] },
  { username: "manuelskye",         display_name: "Manuel Skye",    platform: "OnlyFans",  bio: "Hung muscle performer",          tags: ["muscle", "hung"] },
  { username: "joshmoorexxx",       display_name: "Josh Moore",     platform: "OnlyFans",  bio: "Muscle gay performer",           tags: ["muscle"] },
  { username: "boonerbanks",        display_name: "Boomer Banks",   platform: "OnlyFans",  bio: "Hung Latino gay performer",      tags: ["hung", "latino"] },
  { username: "skyyknox",           display_name: "Skyy Knox",      platform: "OnlyFans",  bio: "Muscle gay creator",             tags: ["muscle"] },
  { username: "rafaelalencar",      display_name: "Rafael Alencar", platform: "OnlyFans",  bio: "Hung muscle performer",          tags: ["hung", "muscle"] },
  { username: "adamramzi",          display_name: "Adam Ramzi",     platform: "OnlyFans",  bio: "Hairy muscle performer",         tags: ["hairy", "muscle"] },
]

function DiscoveryModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const addToast = useAppStore((s) => s.addToast)
  const [query, setQuery] = useState("")
  const [platform, setPlatform] = useState<string>("all")
  const [results, setResults] = useState<DiscoveredCreator[]>([])
  const [addedSet, setAddedSet] = useState<Set<string>>(new Set())
  const [showSuggested, setShowSuggested] = useState(true)

  const searchMutation = useMutation({
    mutationFn: () => api.discoverPerformers(query, platform === "all" ? undefined : platform),
    onSuccess: (data) => setResults(data),
    onError: () => addToast("Discovery failed", "error"),
  })

  const addMutation = useMutation({
    mutationFn: (c: DiscoveredCreator) =>
      api.importDiscoveredPerformers([c], true),
    onSuccess: (result, c) => {
      setAddedSet((prev) => new Set(prev).add(c.username))
      qc.invalidateQueries({ queryKey: ["performers"] })
      qc.invalidateQueries({ queryKey: ["performer-stats"] })
      qc.invalidateQueries({ queryKey: ["capture-queue"] })
      if (result.created > 0) {
        const createdPerformer = result.performers[0]
        addToast(`Added @${c.username} — capture queued`, "success")
        if (createdPerformer) {
          api.enrichPerformer(createdPerformer.id)
            .then(() => qc.invalidateQueries({ queryKey: ["performers"] }))
            .catch((err) => addToast(`Avatar enrichment failed: ${err?.message || 'unknown error'}`, "error"))
        }
        return
      }
      if (result.existing > 0) {
        addToast(`Capture queued for @${c.username}`, "success")
        return
      }
      addToast(`Nothing changed for @${c.username}`, "info")
    },
    onError: (_err, c) => addToast(`Failed to add @${c.username}`, "error"),
  })

  const addAll = useCallback(() => {
    for (const c of results) {
      if (!addedSet.has(c.username)) {
        addMutation.mutate(c)
      }
    }
  }, [results, addedSet, addMutation])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-6 pt-20 backdrop-blur-[2px]" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0d1a30] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Discover Creators</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Suggested creators section */}
        <div className="mb-5">
          <button
            onClick={() => setShowSuggested((v) => !v)}
            className="flex items-center gap-2 text-xs font-medium text-text-muted hover:text-text-secondary mb-2"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cn("transition-transform", showSuggested ? "rotate-0" : "-rotate-90")}><path d="M6 9l6 6 6-6"/></svg>
            Suggested Creators ({SUGGESTED_CREATORS.length})
            <span className="ml-1 text-[10px] text-text-muted opacity-60">auto-seeded on startup</span>
          </button>
          {showSuggested && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SUGGESTED_CREATORS.map((c) => {
                const added = addedSet.has(c.username)
                const pClass = PLATFORM_COLORS[c.platform] ?? "bg-white/10 text-text-secondary border-white/10"
                return (
                  <button
                    key={c.username}
                    onClick={() => !added && addMutation.mutate(c)}
                    disabled={added || addMutation.isPending}
                    title={c.bio}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors",
                      added
                        ? "border-emerald-500/30 bg-emerald-500/10"
                        : "border-white/8 bg-white/[0.03] hover:border-accent/40 hover:bg-accent/10"
                    )}
                  >
                    <div className={cn("h-8 w-8 shrink-0 overflow-hidden rounded-full ring-1", added ? "ring-emerald-500/40" : "ring-white/10")}>
                      <AvatarPlaceholder username={c.username} size="sm" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("truncate text-xs font-medium", added ? "text-emerald-400" : "text-text-primary")}>
                          {added && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="mr-1 inline-block"><path d="M20 6L9 17l-5-5"/></svg>}
                          @{c.username}
                        </span>
                      </div>
                      <span className={cn("mt-0.5 inline-block rounded-full border px-1.5 py-px text-[9px] leading-none", pClass)}>{c.platform}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="mb-4 border-t border-white/5 pt-4">
          <p className="mb-3 text-xs font-medium text-text-muted">AI Discovery — describe what you're looking for</p>
        </div>

        <div className="flex gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. hairy bear creators with tattoos on OnlyFans..."
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) searchMutation.mutate() }}
          />
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-secondary focus:border-accent focus:outline-none"
          >
            <option value="all">All Platforms</option>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button
            onClick={() => searchMutation.mutate()}
            disabled={!query.trim() || searchMutation.isPending}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {searchMutation.isPending ? "Searching..." : "Search"}
          </button>
        </div>

        {results.length > 0 && (
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-muted">{results.length} suggestions</p>
              <button
                onClick={addAll}
                className="rounded-lg bg-accent/20 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/30"
              >
                Add All
              </button>
            </div>
            {results.map((c) => {
              const added = addedSet.has(c.username)
              const pClass = PLATFORM_COLORS[c.platform] ?? "bg-white/10 text-text-secondary border-white/10"
              return (
                <div key={c.username} className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-text-muted">
                    {c.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">@{c.username}</span>
                      <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", pClass)}>{c.platform}</span>
                      {c.exists && (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                          Already tracked
                        </span>
                      )}
                    </div>
                    {c.display_name && <p className="text-xs text-text-secondary">{c.display_name}</p>}
                    {c.bio && <p className="mt-1 text-xs text-text-muted line-clamp-2">{c.bio}</p>}
                    {c.reason && <p className="mt-1 text-[11px] text-text-secondary">{c.reason}</p>}
                    {c.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.tags.map((t) => (
                          <span key={t} className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-text-muted">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => !added && addMutation.mutate(c)}
                    disabled={added || addMutation.isPending}
                    className={cn(
                      "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                      added
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-accent/20 text-accent hover:bg-accent/30"
                    )}
                  >
                    {added ? "Queued" : c.exists ? "Capture" : "Add"}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {searchMutation.isPending && (
          <div className="mt-6 flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Import URL Panel ──────────────────────────────────────────────────── */

function ImportUrlPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const addToast = useAppStore((s) => s.addToast)
  const [url, setUrl] = useState("")

  const mutation = useMutation({
    mutationFn: () => api.importPerformerUrl(url.trim()),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["performers"] })
      qc.invalidateQueries({ queryKey: ["performer-stats"] })
      qc.invalidateQueries({ queryKey: ["capture-queue"] })
      addToast(`Imported @${p.username} — capture queued`, "success")
      api.enrichPerformer(p.id).then(() => qc.invalidateQueries({ queryKey: ["performers"] })).catch((err) => addToast(`Avatar enrichment failed: ${err?.message || 'unknown error'}`, "error"))
      onClose()
    },
    onError: () => addToast("Import failed -- check the URL format", "error"),
  })

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
      <h3 className="mb-3 text-sm font-medium text-text-primary">Import from URL</h3>
      <p className="mb-3 text-xs text-text-muted">Paste a Twitter/X, Instagram, Reddit, OnlyFans, or Fansly profile URL</p>
      <div className="flex gap-3">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://x.com/username"
          className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          onKeyDown={(e) => { if (e.key === "Enter" && url.trim()) mutation.mutate() }}
        />
        <button
          onClick={() => mutation.mutate()}
          disabled={!url.trim() || mutation.isPending}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {mutation.isPending ? "Importing..." : "Import"}
        </button>
        <button onClick={onClose} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
      </div>
    </div>
  )
}

/* ── Bulk Import Panel ─────────────────────────────────────────────────── */

function BulkImportPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const addToast = useAppStore((s) => s.addToast)
  const [text, setText] = useState("")
  const [platform, setPlatform] = useState<string>("OnlyFans")

  const mutation = useMutation({
    mutationFn: () => {
      const usernames = text.split("\n").map((l) => l.trim()).filter(Boolean)
      return api.bulkImportPerformers(usernames, platform)
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["performers"] })
      qc.invalidateQueries({ queryKey: ["performer-stats"] })
      qc.invalidateQueries({ queryKey: ["capture-queue"] })
      addToast(`Created ${result.created}, skipped ${result.skipped} — capture queued for new creators`, "success")
      result.performers.forEach((p) => {
        api.enrichPerformer(p.id).catch((err) => addToast(`Avatar enrichment failed: ${err?.message || 'unknown error'}`, "error"))
      })
      onClose()
    },
    onError: () => addToast("Bulk import failed", "error"),
  })

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
      <h3 className="mb-3 text-sm font-medium text-text-primary">Bulk Import</h3>
      <p className="mb-3 text-xs text-text-muted">Paste usernames, one per line</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={"username1\nusername2\nusername3"}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none resize-none"
        />
        <div className="flex flex-col gap-2">
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-secondary focus:border-accent focus:outline-none"
          >
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button
            onClick={() => mutation.mutate()}
            disabled={!text.trim() || mutation.isPending}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {mutation.isPending ? "Importing..." : "Import"}
          </button>
          <button onClick={onClose} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
        </div>
      </div>
    </div>
  )
}

/* ── Capture Queue Panel ──────────────────────────────────────────────────── */

function CaptureQueuePanel({ queueData }: { queueData?: { queue: CaptureQueueEntry[] } }) {
  const addToast = useAppStore((s) => s.addToast)
  const qc = useQueryClient()

  const cancelMutation = useMutation({
    mutationFn: (entryId: number) => api.cancelQueueEntry(entryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["capture-queue"] }),
    onError: () => addToast("Could not cancel — may have already started", "error"),
  })

  const retryMutation = useMutation({
    mutationFn: (performerId: number) => api.capturePerformerMedia(performerId),
    onSuccess: () => {
      addToast("Retry queued", "success")
      qc.invalidateQueries({ queryKey: ["capture-queue"] })
    },
    onError: () => addToast("Retry failed", "error"),
  })

  const queue = queueData?.queue ?? []
  if (queue.length === 0) return null

  const activeCount = queue.filter((e) => e.status === "queued" || e.status === "running").length
  const doneCount = queue.filter((e) => e.status === "done").length
  const failedCount = queue.filter((e) => e.status === "failed").length

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0a1628]/95 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-text-muted">
            Capture queue
            {activeCount > 0 && (
              <span className="ml-2 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] text-accent">{activeCount} active</span>
            )}
            {doneCount > 0 && (
              <span className="ml-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-400">{doneCount} done</span>
            )}
            {failedCount > 0 && (
              <span className="ml-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] text-red-400">{failedCount} failed</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {queue.map((entry) => {
            const initials = (entry.display_name || entry.username).charAt(0).toUpperCase()
            const pClass = PLATFORM_COLORS[entry.platform] ?? "bg-white/10 text-text-secondary border-white/10"
            return (
              <div
                key={entry.id}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs",
                  entry.status === "running" && "border-accent/30 bg-accent/10",
                  entry.status === "queued" && "border-white/10 bg-white/5",
                  entry.status === "done" && "border-emerald-500/20 bg-emerald-500/5",
                  entry.status === "failed" && "border-red-500/20 bg-red-500/5",
                )}
              >
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[9px] font-bold text-text-muted">
                  {initials}
                </div>
                <span className="text-text-secondary">@{entry.username}</span>
                <span className={cn("rounded-full border px-1.5 py-px text-[9px] leading-none", pClass)}>{entry.platform}</span>
                {entry.status === "running" && (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                )}
                {entry.status === "queued" && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                )}
                {entry.status === "done" && (
                  <span className="text-emerald-400">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                  </span>
                )}
                {entry.status === "failed" && (
                  <>
                    <span className="text-red-400" title={entry.error_msg ?? ""}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </span>
                    <button
                      onClick={() => retryMutation.mutate(entry.performer_id)}
                      className="ml-1 rounded p-px text-text-muted hover:text-accent"
                      title="Retry capture"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    </button>
                  </>
                )}
                {entry.status === "done" && entry.captured_count > 0 && (
                  <span className="text-emerald-400">+{entry.captured_count}</span>
                )}
                {entry.status === "queued" && (
                  <button
                    onClick={() => cancelMutation.mutate(entry.id)}
                    className="ml-1 rounded p-px text-text-muted hover:text-red-400"
                    title="Cancel"
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ── Performer Card ────────────────────────────────────────────────────── */

const PerformerCard = memo(function PerformerCard({
  performer,
  onSelect,
  onTagClick,
  selected,
  onToggleSelect,
  selectMode,
  isInQueue,
  isFocused,
  cardRef,
}: {
  performer: Performer
  onSelect: (id: number) => void
  onTagClick?: (tag: string) => void
  selected?: boolean
  onToggleSelect?: (id: number) => void
  selectMode?: boolean
  isInQueue?: boolean
  isFocused?: boolean
  cardRef?: React.Ref<HTMLDivElement>
}) {
  const qc = useQueryClient()
  const setMediaCreator = useAppStore((s) => s.setMediaCreator)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const [hovered, setHovered] = useState(false)
  const avatarSrc = getPerformerAvatarSrc(performer)

  function handleViewMedia(e: React.MouseEvent) {
    e.stopPropagation()
    setMediaCreator(performer.id, performer.username)
    setActiveView("images")
  }

  const favMutation = useMutation({
    mutationFn: () => api.updatePerformer(performer.id, { is_favorite: performer.is_favorite ? 0 : 1 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["performers"] })
      qc.invalidateQueries({ queryKey: ["performer-stats"] })
      qc.invalidateQueries({ queryKey: ["watchlist"] })
    },
  })

  const tags = parseTags(performer.tags)
  const platformClass = PLATFORM_COLORS[performer.platform] ?? "bg-white/10 text-text-secondary border-white/10"
  const handlePrefetch = useCallback(() => {
    prefetchPerformerProfile(qc, performer.id)
  }, [qc, performer.id])

  return (
    <div
      ref={cardRef}
      className={cn(
        "group section-shell card-hover rounded-[26px] transition-[background-color,border-color,box-shadow,transform] hover:border-white/15 hover:bg-white/[0.05]",
        isFocused ? "border-accent/50 ring-1 ring-accent/30" : "border-white/8"
      )}
      style={{ contentVisibility: "auto", containIntrinsicSize: "360px 120px" }}
      onMouseEnter={() => { setHovered(true); handlePrefetch() }}
      onMouseLeave={() => setHovered(false)}
      onFocus={handlePrefetch}
    >
      <div
        onClick={() => onSelect(performer.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(performer.id) }}
        className="w-full cursor-pointer px-3.5 py-3 text-left"
      >
        <div className="flex items-start gap-3.5">
          {/* Avatar */}
          <div className="relative h-14 w-14 shrink-0">
            {selectMode && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSelect?.(performer.id) }}
                className={cn(
                  "absolute -left-1 -top-1 z-10 h-5 w-5 rounded border-2 transition-colors",
                  selected
                    ? "border-accent bg-accent text-white"
                    : "border-white/30 bg-[#0a1628]"
                )}
                aria-label="Select"
              >
                {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="m-auto"><path d="M20 6L9 17l-5-5"/></svg>}
              </button>
            )}
            <div className={cn(
              "h-full w-full overflow-hidden rounded-full ring-2 shadow-lg shadow-black/20",
              performer.is_favorite ? "ring-rose-500/40" : "ring-white/10"
            )}>
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt={performer.username}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                  fetchPriority="low"
                />
              ) : (
                <AvatarPlaceholder username={performer.username} size="md" />
              )}
            </div>
            {performer.status === "active" && (
              <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#0a1628] bg-emerald-400 shadow-sm shadow-emerald-400/40" title="Active" />
            )}
            {isInQueue && !selectMode && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-[#0a1628]/60">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="min-w-0 max-w-full truncate text-sm font-semibold text-text-primary">@{performer.username}</span>
              {performer.is_verified === 1 && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-accent">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                </svg>
              )}
            </div>
            {performer.display_name && (
              <p className="truncate text-xs text-text-secondary">{performer.display_name}</p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {performer.profile_url ? (
                <a
                  href={performer.profile_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className={cn("rounded-full border px-2 py-0.5 text-[10px] transition-opacity hover:opacity-80", platformClass)}
                >
                  {performer.platform}
                </a>
              ) : (
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", platformClass)}>
                  {performer.platform}
                </span>
              )}
              {tags.slice(0, 2).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onTagClick?.(t) }}
                  className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-white/10 hover:text-text-secondary transition-colors"
                >{t}</button>
              ))}
              {tags.length > 2 && (
                <span className="text-[10px] text-text-muted">+{tags.length - 2}</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
                {(performer.screenshots_count ?? 0).toLocaleString()} shots
              </span>
              {(performer.media_count ?? 0) > 0 && (
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
                  {(performer.media_count ?? 0).toLocaleString()} media
                </span>
              )}
              {performer.is_verified === 1 && (
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-emerald-200">
                  Verified
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex items-center gap-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); favMutation.mutate() }}
                className="rounded-lg p-1 transition-colors hover:bg-white/10"
                title={performer.is_favorite ? "Remove from watchlist" : "Add to watchlist"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={performer.is_favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.75" className={performer.is_favorite ? "text-rose-400" : "text-text-muted"}>
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </button>
            </div>
            {(performer.media_count ?? 0) > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-text-secondary">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-50"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                {performer.media_count}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Screenshot thumbnails — lazy-loaded on hover */}
      {(performer.screenshots_count ?? 0) > 0 && (
        <PerformerThumbs performerId={performer.id} username={performer.username} visible={hovered} />
      )}

      {/* Quick action bar */}
      <div className="flex items-center justify-between border-t border-white/5 px-3.5 py-2">
        <div className="flex gap-2">
          {performer.reddit_username && (
            <a
              href={`https://reddit.com/user/${performer.reddit_username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-orange-300 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              r/{performer.reddit_username}
            </a>
          )}
          {performer.twitter_username && (
            <a
              href={`https://twitter.com/${performer.twitter_username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-sky-300 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              @{performer.twitter_username}
            </a>
          )}
        </div>
        <div className="flex items-center gap-1">
          {performer.profile_url && (
            <a
              href={performer.profile_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 rounded-xl bg-white/5 px-2.5 py-1.5 text-[11px] text-text-muted transition-colors hover:bg-white/10 hover:text-text-secondary"
              title="Visit profile"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              Profile
            </a>
          )}
          <button
            onClick={handleViewMedia}
            className="flex items-center gap-1 rounded-xl bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-sky-500/15 hover:text-sky-300"
            title="View captured media"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
            View media
          </button>
        </div>
      </div>
    </div>
  )
}, (prev, next) =>
  prev.performer.id === next.performer.id &&
  prev.selected === next.selected &&
  prev.isInQueue === next.isInQueue &&
  prev.isFocused === next.isFocused &&
  prev.selectMode === next.selectMode &&
  prev.performer.is_favorite === next.performer.is_favorite &&
  prev.performer.is_subscribed === next.performer.is_subscribed &&
  prev.performer.username === next.performer.username &&
  prev.performer.display_name === next.performer.display_name &&
  prev.performer.platform === next.performer.platform &&
  prev.performer.profile_url === next.performer.profile_url &&
  prev.performer.is_verified === next.performer.is_verified &&
  prev.performer.tags === next.performer.tags &&
  prev.performer.media_count === next.performer.media_count &&
  prev.performer.screenshots_count === next.performer.screenshots_count &&
  prev.performer.avatar_url === next.performer.avatar_url
)

/* ── Analytics Panel ───────────────────────────────────────────────────── */

/* ── Billing Panel ─────────────────────────────────────────────────────── */

type EnrichedPerformer = Performer & { nextRenewal: Date | null; daysUntil: number | null }

function BillingRow({
  p,
  onSelect,
  onRenewToday,
}: {
  p: EnrichedPerformer
  onSelect: (id: number) => void
  onRenewToday: (id: number) => void
}) {
  const platformClass = PLATFORM_COLORS[p.platform] ?? "bg-white/10 text-text-secondary border-white/10"
  const avatarSrc = getPerformerAvatarSrc(p)

  const urgencyClass =
    p.daysUntil === null
      ? "text-text-muted"
      : p.daysUntil < 0
      ? "text-red-400"
      : p.daysUntil <= 7
      ? "text-orange-400"
      : "text-text-secondary"

  const urgencyLabel =
    p.daysUntil === null
      ? "unknown"
      : p.daysUntil < 0
      ? `${Math.abs(p.daysUntil)}d overdue`
      : p.daysUntil === 0
      ? "today"
      : `in ${p.daysUntil}d`

  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.03]">
      <button
        onClick={() => onSelect(p.id)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full ring-1 ring-white/10">
          {avatarSrc ? (
            <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
          ) : (
            <AvatarPlaceholder username={p.username} size="sm" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-text-primary">@{p.username}</span>
            <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px]", platformClass)}>{p.platform}</span>
          </div>
          {p.nextRenewal && (
            <p className="text-[11px] text-text-muted">
              {p.nextRenewal.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </p>
          )}
        </div>
      </button>

      <span className={cn("shrink-0 text-xs font-medium tabular-nums", urgencyClass)}>{urgencyLabel}</span>
      <span className="shrink-0 w-14 text-right text-xs text-text-secondary">
        {p.subscription_price != null ? `$${p.subscription_price.toFixed(2)}` : "--"}
      </span>
      <button
        onClick={() => onRenewToday(p.id)}
        className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[10px] text-text-muted transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-400"
        title="Set renewal to today"
      >
        renew
      </button>
    </div>
  )
}

function BillingPanel({ onSelect }: { onSelect: (id: number) => void }) {
  const qc = useQueryClient()
  const addToast = useAppStore((s) => s.addToast)

  const { data, isLoading } = useQuery({
    queryKey: ["performers-billing"],
    queryFn: () => api.browsePerformers({ limit: 120, offset: 0, is_subscribed: true, sort: "subscription_renewed_at" }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const renewMutation = useMutation({
    mutationFn: (id: number) =>
      api.updatePerformer(id, { subscription_renewed_at: new Date().toISOString() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["performers-billing"] })
      qc.invalidateQueries({ queryKey: ["performer-stats"] })
      qc.invalidateQueries({ queryKey: ["performers"] })
      addToast("Renewal date set to today", "success")
    },
    onError: () => addToast("Update failed", "error"),
  })

  const now = Date.now()

  const enriched: EnrichedPerformer[] = (data?.performers ?? []).map((p) => {
    const renewedAt = p.subscription_renewed_at ? new Date(p.subscription_renewed_at).getTime() : null
    const nextRenewal = renewedAt ? new Date(renewedAt + 30 * 24 * 60 * 60 * 1000) : null
    const daysUntil = nextRenewal ? Math.round((nextRenewal.getTime() - now) / (1000 * 60 * 60 * 24)) : null
    return { ...p, nextRenewal, daysUntil }
  })

  const sorted = [...enriched].sort((a, b) => {
    if (a.daysUntil === null && b.daysUntil === null) return 0
    if (a.daysUntil === null) return 1
    if (b.daysUntil === null) return -1
    return a.daysUntil - b.daysUntil
  })

  const overdue = sorted.filter((p) => p.daysUntil !== null && p.daysUntil < 0)
  const thisWeek = sorted.filter((p) => p.daysUntil !== null && p.daysUntil >= 0 && p.daysUntil <= 7)
  const thisMonth = sorted.filter((p) => p.daysUntil !== null && p.daysUntil > 7 && p.daysUntil <= 30)
  const later = sorted.filter((p) => p.daysUntil === null || p.daysUntil > 30)

  const monthlyTotal = enriched.reduce((sum, p) => sum + (p.subscription_price ?? 0), 0)
  const subscribedCount = enriched.length
  const overdueCount = overdue.length
  const thisWeekCost = thisWeek.reduce((s, p) => s + (p.subscription_price ?? 0), 0)

  if (isLoading) return <Skeleton variant="card" height="160px" />

  function renderGroup(label: string, items: EnrichedPerformer[], accent?: string) {
    if (items.length === 0) return null
    return (
      <div>
        <div className="mb-1 flex items-center gap-2 px-3">
          <span className={cn("text-[11px] font-medium uppercase tracking-wider", accent ?? "text-text-muted")}>{label}</span>
          <span className="text-[10px] text-text-muted">· {items.length}</span>
        </div>
        <div className="divide-y divide-white/[0.03]">
          {items.map((p) => (
            <BillingRow key={p.id} p={p} onSelect={onSelect} onRenewToday={(id) => renewMutation.mutate(id)} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
          <p className="text-[11px] text-text-muted">Active Subs</p>
          <p className="mt-1 text-2xl font-semibold text-text-primary">{subscribedCount}</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.04] px-4 py-3">
          <p className="text-[11px] text-emerald-400/70">Monthly Total</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-300">
            ${monthlyTotal.toFixed(2)}
          </p>
        </div>
        <div className={cn(
          "rounded-2xl border px-4 py-3",
          overdueCount > 0 ? "border-red-500/20 bg-red-500/[0.04]" : "border-white/8 bg-white/[0.03]"
        )}>
          <p className={cn("text-[11px]", overdueCount > 0 ? "text-red-400/70" : "text-text-muted")}>Overdue</p>
          <p className={cn("mt-1 text-2xl font-semibold", overdueCount > 0 ? "text-red-300" : "text-text-primary")}>{overdueCount}</p>
        </div>
        <div className={cn(
          "rounded-2xl border px-4 py-3",
          thisWeek.length > 0 ? "border-orange-500/15 bg-orange-500/[0.04]" : "border-white/8 bg-white/[0.03]"
        )}>
          <p className={cn("text-[11px]", thisWeek.length > 0 ? "text-orange-400/70" : "text-text-muted")}>Due This Week</p>
          <p className={cn("mt-1 text-2xl font-semibold", thisWeek.length > 0 ? "text-orange-300" : "text-text-primary")}>
            {thisWeek.length > 0 ? `${thisWeek.length} · $${thisWeekCost.toFixed(2)}` : "0"}
          </p>
        </div>
      </div>

      {/* Timeline */}
      {subscribedCount === 0 ? (
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] py-8 text-center">
          <p className="text-sm text-text-muted">No active subscriptions tracked</p>
          <p className="mt-1 text-xs text-text-muted">Mark creators as subscribed to track renewals</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] py-3">
          <div className="mb-2 flex items-center justify-between px-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Renewal Timeline</p>
            <p className="text-[11px] text-text-muted">
              {subscribedCount - later.filter((p) => p.daysUntil === null).length} with known dates
            </p>
          </div>
          <div className="space-y-1">
            {renderGroup("Overdue", overdue, "text-red-400")}
            {renderGroup("This Week", thisWeek, "text-orange-400")}
            {renderGroup("This Month", thisMonth, "text-sky-400")}
            {renderGroup("Later", later)}
          </div>
          {sorted.length > 0 && (
            <div className="mt-3 border-t border-white/5 px-4 pt-3">
              <div className="flex items-center justify-between text-[11px] text-text-muted">
                <span>{subscribedCount} subscriptions · ${monthlyTotal.toFixed(2)}/mo</span>
                {monthlyTotal > 0 && (
                  <span className="text-text-muted">${(monthlyTotal * 12).toFixed(2)}/yr</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Performer thumbnail strip ─────────────────────────────────────────── */

function PerformerThumbs({ performerId, username, visible }: { performerId: number; username: string; visible: boolean }) {
  const setMediaCreator = useAppStore((s) => s.setMediaCreator)
  const setActiveView = useAppStore((s) => s.setActiveView)

  const { data } = useQuery({
    queryKey: ["performer-thumbs", performerId],
    queryFn: () => api.browseScreenshots({ performer_id: performerId, limit: 4, sort: "newest", offset: 0 }),
    enabled: visible,
    staleTime: 120_000,
  })

  const shots = (data?.screenshots ?? []).filter((s) => getBestAvailablePreviewSrc(s) || getScreenshotMediaSrc(s))
  if (shots.length === 0) return null

  return (
    <div className="flex gap-1 px-3 pb-2">
      {shots.map((s) => (
        <button
          key={s.id}
          onClick={(e) => { e.stopPropagation(); setMediaCreator(performerId, username); setActiveView("images") }}
          className="group/thumb relative aspect-square flex-1 overflow-hidden rounded-lg bg-white/5"
          title={s.term ?? ""}
        >
          {getBestAvailablePreviewSrc(s) ? (
            <img
              src={getBestAvailablePreviewSrc(s)}
              alt=""
              className="h-full w-full object-cover opacity-70 transition-opacity group-hover/thumb:opacity-100"
              loading="lazy"
              decoding="async"
              fetchPriority="low"
            />
          ) : isVideoShot(s) ? (
            <video
              src={getScreenshotMediaSrc(s)}
              muted
              playsInline
              preload="metadata"
              className="h-full w-full object-cover opacity-70 transition-opacity group-hover/thumb:opacity-100"
            />
          ) : (
            <img
              src={getScreenshotMediaSrc(s)}
              alt=""
              className="h-full w-full object-cover opacity-70 transition-opacity group-hover/thumb:opacity-100"
              loading="lazy"
              decoding="async"
              fetchPriority="low"
            />
          )}
        </button>
      ))}
    </div>
  )
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(diff / 3_600_000)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(diff / 86_400_000)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

function prefetchPerformerProfile(qc: QueryClient, performerId: number) {
  void qc.prefetchQuery({
    queryKey: ["performer", performerId],
    queryFn: () => api.getPerformer(performerId),
    staleTime: 15_000,
  })
  void qc.prefetchQuery({
    queryKey: ["performer-shots-preview", performerId],
    queryFn: () => api.browseScreenshots({ performer_id: performerId, limit: 4, offset: 0 }),
    staleTime: 30_000,
  })
}

/* ── Performer Row (table view) ────────────────────────────────────────── */

function PerformerRow({
  performer,
  onSelect,
  selected,
  onToggleSelect,
  selectMode,
  isInQueue,
}: {
  performer: Performer
  onSelect: (id: number) => void
  selected?: boolean
  onToggleSelect?: (id: number) => void
  selectMode?: boolean
  isInQueue?: boolean
}) {
  const qc = useQueryClient()
  const addToast = useAppStore((s) => s.addToast)
  const setMediaCreator = useAppStore((s) => s.setMediaCreator)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const avatarSrc = getPerformerAvatarSrc(performer)

  const favMutation = useMutation({
    mutationFn: () => api.updatePerformer(performer.id, { is_favorite: performer.is_favorite ? 0 : 1 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["performers"] })
      qc.invalidateQueries({ queryKey: ["performer-stats"] })
      qc.invalidateQueries({ queryKey: ["watchlist"] })
    },
  })

  const tags = parseTags(performer.tags)
  const lastChecked = performer.last_checked_at ? formatRelativeTime(performer.last_checked_at) : "never"
  const renewingIn = performer.subscription_renewed_at
    ? Math.ceil((new Date(performer.subscription_renewed_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null
  const handlePrefetch = useCallback(() => {
    prefetchPerformerProfile(qc, performer.id)
  }, [qc, performer.id])

  return (
    <div
      className={cn(
        "group flex items-center gap-3 border-b border-white/5 px-3 py-2 transition-colors cursor-pointer",
        selected ? "bg-accent/8" : "hover:bg-white/[0.03]",
        isInQueue && "ring-inset ring-1 ring-amber-500/20"
      )}
      onClick={() => onSelect(performer.id)}
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
    >
      {selectMode && (
        <div
          className={cn(
            "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors",
            selected ? "border-accent bg-accent" : "border-white/20 bg-white/5"
          )}
          onClick={(e) => { e.stopPropagation(); onToggleSelect?.(performer.id) }}
        >
          {selected && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          )}
        </div>
      )}

      {/* Avatar */}
      <div className="relative h-7 w-7 flex-shrink-0">
        <div className="h-full w-full overflow-hidden rounded-full ring-1 ring-white/10">
          {avatarSrc ? (
            <img src={avatarSrc} alt={performer.username} className="h-full w-full object-cover" />
          ) : (
            <AvatarPlaceholder username={performer.username} size="sm" />
          )}
        </div>
        {isInQueue && (
          <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 ring-1 ring-surface" />
        )}
      </div>

      {/* Username + platform + tags */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-text-primary">@{performer.username}</span>
          {performer.is_favorite === 1 && (
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="flex-shrink-0 text-rose-400">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          )}
          <span className={cn("rounded-full border px-1.5 py-px text-[9px] uppercase tracking-wide", PLATFORM_COLORS[performer.platform] ?? "bg-white/10 text-text-muted border-white/10")}>
            {performer.platform}
          </span>
        </div>
        {tags.length > 0 && (
          <div className="mt-0.5 flex items-center gap-1">
            {tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded-full border border-white/10 bg-white/5 px-1.5 py-px text-[9px] text-text-muted">
                {t}
              </span>
            ))}
            {tags.length > 3 && <span className="text-[9px] text-text-muted">+{tags.length - 3}</span>}
          </div>
        )}
      </div>

      {/* Sub status */}
      <div className="w-20 flex-shrink-0 text-right">
        {performer.is_subscribed === 1 ? (
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-medium text-emerald-400">Active</span>
            {renewingIn !== null && renewingIn <= 30 && (
              <span className={cn("text-[9px]", renewingIn <= 7 ? "text-orange-400" : "text-text-muted")}>
                {renewingIn > 0 ? `${renewingIn}d` : "today"}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[10px] text-text-muted">—</span>
        )}
      </div>

      {/* Price */}
      <div className="w-14 flex-shrink-0 text-right text-[11px] text-text-secondary">
        {performer.subscription_price ? `$${performer.subscription_price.toFixed(2)}` : "—"}
      </div>

      {/* Media count */}
      <div className="w-14 flex-shrink-0 text-right text-[11px] text-text-secondary">
        {performer.media_count != null ? performer.media_count.toLocaleString() : "—"}
      </div>

      {/* Screenshots count */}
      <div className="w-14 flex-shrink-0 text-right text-[11px] text-text-secondary">
        {performer.screenshots_count != null ? performer.screenshots_count.toLocaleString() : "—"}
      </div>

      {/* Last checked */}
      <div className="w-16 flex-shrink-0 text-right text-[10px] text-text-muted">
        {lastChecked}
      </div>

      {/* Actions */}
      <div className="flex w-16 flex-shrink-0 items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => { e.stopPropagation(); favMutation.mutate() }}
          className={cn("rounded p-1 transition-colors", performer.is_favorite ? "text-rose-400 hover:text-rose-300" : "text-text-muted hover:text-rose-400")}
          title={performer.is_favorite ? "Unfavorite" : "Favorite"}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill={performer.is_favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
        {performer.profile_url && (
          <button
            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(performer.profile_url!); addToast(`@${performer.username} URL copied`, "success") }}
            className="rounded p-1 text-text-muted transition-colors hover:text-text-secondary"
            title="Copy URL"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); setMediaCreator(performer.id, performer.username); setActiveView("images") }}
          className="rounded p-1 text-text-muted transition-colors hover:text-text-secondary"
          title="View media"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/* ── More Menu (overflow actions) ─────────────────────────────────────── */

function MoreMenu({
  showBilling,
  showAnalytics,
  selectMode,
  onBilling,
  onAnalytics,
  onImportUrl,
  onBulkImport,
  exportUrl,
  onSelect,
  onCaptureStale,
  onCaptureAll,
}: {
  showBilling: boolean
  showAnalytics: boolean
  selectMode: boolean
  watchlistCount: number
  watchlistCapturing: boolean
  captureAllRunning: boolean
  onBilling: () => void
  onAnalytics: () => void
  onImportUrl: () => void
  onBulkImport: () => void
  onExportCsv: () => void
  exportUrl: string
  onSelect: () => void
  onCaptureStale: () => void
  onCaptureAll: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  const items: { label: string; onClick: () => void; active?: boolean; href?: string }[] = [
    { label: "Import URL", onClick: onImportUrl },
    { label: "Bulk Import", onClick: onBulkImport },
    { label: "Export CSV", onClick: () => {}, href: exportUrl },
    { label: selectMode ? "Exit Select" : "Select", onClick: onSelect, active: selectMode },
    { label: showBilling ? "Hide Billing" : "Billing", onClick: onBilling, active: showBilling },
    { label: showAnalytics ? "Hide Analytics" : "Analytics", onClick: onAnalytics, active: showAnalytics },
    { label: "Capture Stale", onClick: onCaptureStale },
    { label: "Capture All", onClick: onCaptureAll },
  ]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-xl border transition-colors",
          open ? "border-white/20 bg-white/10 text-text-primary" : "border-white/10 text-text-muted hover:text-text-primary hover:bg-white/5"
        )}
        aria-label="More actions"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-white/10 bg-[#0d1a30] py-1 shadow-2xl">
          {items.map((item) =>
            item.href ? (
              <a
                key={item.label}
                href={item.href}
                download="creators.csv"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                onClick={() => { item.onClick(); setOpen(false) }}
                className={cn(
                  "block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-white/5",
                  item.active ? "text-accent" : "text-text-secondary hover:text-text-primary"
                )}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}

/* ── Main Page ─────────────────────────────────────────────────────────── */

export default function PerformersPage() {
  const [showAdd, setShowAdd] = useState(false)
  const [showDiscover, setShowDiscover] = useState(false)
  const [showImportUrl, setShowImportUrl] = useState(false)
  const [showBulkImport, setShowBulkImport] = useState(false)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [showBilling, setShowBilling] = useState(false)
  const [search, setSearch] = useState("")
  const [platformFilter, setPlatformFilter] = useState<string>("all")
  const [sort, setSort] = useState<SortOption>("most_media")
  const [favOnly, setFavOnly] = useState(false)
  const [dueOnly, setDueOnly] = useState(false)
  const [renewingOnly, setRenewingOnly] = useState(false)
  const [selectedPerformerId, setSelectedPerformerId] = useState<number | null>(null)
  const [watchlistCapturing, setWatchlistCapturing] = useState(false)
  const [captureAllRunning, setCaptureAllRunning] = useState(false)
  const [subscribedOnly, setSubscribedOnly] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [focusedIdx, setFocusedIdx] = useState(-1)
  const [queueReady, setQueueReady] = useState(false)
  const [tableView, setTableView] = useState(() => localStorage.getItem("performers-view") === "table")
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [showTagCloud, setShowTagCloud] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const focusedCardRef = useRef<HTMLDivElement>(null)

  const runUiTransition = useCallback((update: () => void) => {
    startTransition(update)
  }, [])

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function clearSelect() {
    setSelectedIds(new Set())
    setSelectMode(false)
  }

  const addToast = useAppStore((s) => s.addToast)
  const pendingPerformerId = useAppStore((s) => s.pendingPerformerId)
  const setPendingPerformer = useAppStore((s) => s.setPendingPerformer)
  const qcMain = useQueryClient()

  // Deep-link: if another page pushed a pendingPerformerId, open that profile
  useEffect(() => {
    if (pendingPerformerId != null) {
      runUiTransition(() => setSelectedPerformerId(pendingPerformerId))
      setPendingPerformer(null)
    }
  }, [pendingPerformerId, runUiTransition, setPendingPerformer])

  useEffect(() => {
    let cancelled = false

    const enableQueue = () => {
      if (!cancelled) setQueueReady(true)
    }

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(enableQueue, { timeout: 1500 })
      return () => {
        cancelled = true
        window.cancelIdleCallback(idleId)
      }
    }

    const timeoutId = setTimeout(enableQueue, 600)
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [])

  const { data: statsData } = useCreatorStats()

  const { data: analyticsData } = useQuery({
    queryKey: ["performer-analytics"],
    queryFn: () => api.performerAnalytics(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const tagCloud = (analyticsData?.tag_cloud ?? []).slice(0, 12)

  const { data: watchlistData } = useQuery({
    queryKey: ["watchlist"],
    queryFn: api.getWatchlist,
    staleTime: 30_000,
    enabled: showBilling,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const watchlistCount = watchlistData?.total ?? 0

  const { data: queueData } = useQuery({
    queryKey: ["capture-queue"],
    queryFn: () => api.getCaptureQueue(),
    enabled: queueReady,
    refetchInterval: (query) => {
      const queue = query.state.data?.queue ?? []
      const hasActive = queue.some((e) => e.status === "queued" || e.status === "running")
      return hasActive ? 5_000 : 120_000
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const activePerformerIds = useMemo(() => new Set(
    (queueData?.queue ?? [])
      .filter((e) => e.status === "queued" || e.status === "running")
      .map((e) => e.performer_id)
  ), [queueData])
  async function handleCaptureAll() {
    setCaptureAllRunning(true)
    try {
      const res = await api.captureAllPerformers()
      addToast(`Capturing all ${res.queued} creator${res.queued !== 1 ? "s" : ""} in background…`, "success")
      qcMain.invalidateQueries({ queryKey: ["performers"] })
    } catch {
      addToast("Capture all failed", "error")
    } finally {
      setCaptureAllRunning(false)
    }
  }

  async function handleCaptureWatchlist() {
    setWatchlistCapturing(true)
    try {
      const res = await api.captureWatchlist()
      if (res.status === "no_watchlist") {
        addToast("No favorited creators to capture. Favorite some first.", "info")
      } else {
        addToast(`Capturing ${res.queued} creator${res.queued !== 1 ? "s" : ""} in background…`, "success")
        qcMain.invalidateQueries({ queryKey: ["performers"] })
      }
    } catch {
      addToast("Watchlist capture failed", "error")
    } finally {
      setWatchlistCapturing(false)
    }
  }

  const [visibleLimit, setVisibleLimit] = useState(24)

  // Debounce search to avoid firing a query on every keystroke
  const debouncedSearch = useDebounce(search, 300)

  const activeFilterSummary = useMemo(() => {
    const labels: string[] = []
    if (debouncedSearch.trim()) labels.push(`Search: "${debouncedSearch.trim()}"`)
    if (platformFilter !== "all") labels.push(platformFilter)
    if (favOnly) labels.push("Favorites")
    if (tagFilter) labels.push(`#${tagFilter}`)
    if (sort !== "most_media") labels.push(`Sort: ${sort.replace(/_/g, " ")}`)
    return labels
  }, [debouncedSearch, platformFilter, favOnly, tagFilter, sort])

  // Reset visible limit when filters change
  const filterKey = `${debouncedSearch}|${platformFilter}|${sort}|${favOnly}|${dueOnly}|${renewingOnly}|${subscribedOnly}|${tagFilter}`
  const prevFilterKey = useRef(filterKey)
  useEffect(() => {
    if (prevFilterKey.current === filterKey) return
    prevFilterKey.current = filterKey
    setVisibleLimit(24)
    setFocusedIdx(-1)
  }, [filterKey])

  const queryParams = useMemo<Record<string, string | number | boolean>>(() => {
    const needsWideQuery = Boolean(
      debouncedSearch.trim() ||
      platformFilter !== "all" ||
      favOnly ||
      dueOnly ||
      renewingOnly
    )
    const params: Record<string, string | number | boolean> = {
      limit: needsWideQuery ? 120 : 72,
      offset: 0,
    }
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
    if (platformFilter !== "all") params.platform = platformFilter
    if (sort) params.sort = sort
    if (favOnly) params.is_favorite = true
    if (dueOnly) params.stale_days = 7
    if (renewingOnly) params.renewing_only = true
    if (subscribedOnly) params.is_subscribed = true
    if (tagFilter) params.tags = tagFilter
    return params
  }, [debouncedSearch, platformFilter, sort, favOnly, dueOnly, renewingOnly, subscribedOnly, tagFilter])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["performers", queryParams],
    queryFn: () => api.browsePerformers(queryParams),
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const allPerformers = data?.performers ?? []
  const filteredPerformers = useMemo(() => allPerformers
    .filter((p) => !subscribedOnly || p.is_subscribed === 1)
    .filter((p) => {
      if (!tagFilter) return true
      const tags = parseTags(p.tags)
      return tags.some((t) => t.toLowerCase() === tagFilter.toLowerCase())
    }), [allPerformers, subscribedOnly, tagFilter])
  const deferredFilteredPerformers = useDeferredValue(filteredPerformers)
  const performers = deferredFilteredPerformers.slice(0, visibleLimit)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  const closeForm = useCallback(() => setShowAdd(false), [])
  const handleTagClick = useCallback((tag: string) => {
    runUiTransition(() => setTagFilter(tag))
  }, [runUiTransition])

  const handleCardSelect = useCallback((id: number, idx: number) => {
    setFocusedIdx(idx)
    if (selectMode) {
      toggleSelect(id)
    } else {
      runUiTransition(() => setSelectedPerformerId(id))
    }
  }, [selectMode, runUiTransition])

  useEffect(() => {
    const el = loadMoreRef.current
    if (!el || performers.length >= deferredFilteredPerformers.length) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleLimit((v) => Math.min(v + 24, deferredFilteredPerformers.length))
        }
      },
      { rootMargin: "500px 0px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [performers.length, deferredFilteredPerformers.length])

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
      if (inInput) return

      if (e.key === "/" && !inInput) {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      if (e.key === "t" && !inInput) {
        e.preventDefault()
        runUiTransition(() => {
          setTableView((v) => {
            const next = !v
            localStorage.setItem("performers-view", next ? "table" : "grid")
            return next
          })
        })
        return
      }
      if (selectedPerformerId !== null) return // profile overlay open

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault()
        setFocusedIdx((prev) => Math.min(prev + 1, performers.length - 1))
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault()
        setFocusedIdx((prev) => Math.max(prev - 1, 0))
      } else if ((e.key === "Enter" || e.key === " ") && focusedIdx >= 0 && performers[focusedIdx]) {
        e.preventDefault()
        if (selectMode) {
          toggleSelect(performers[focusedIdx].id)
        } else {
          runUiTransition(() => setSelectedPerformerId(performers[focusedIdx].id))
        }
      } else if (e.key === "Escape") {
        setFocusedIdx(-1)
      } else if (e.key === "f" && focusedIdx >= 0 && performers[focusedIdx]) {
        e.preventDefault()
        const p = performers[focusedIdx]
        api.updatePerformer(p.id, { is_favorite: p.is_favorite ? 0 : 1 })
          .then(() => {
            qcMain.invalidateQueries({ queryKey: ["performers"] })
            qcMain.invalidateQueries({ queryKey: ["performer-stats"] })
          })
          .catch((err) => addToast(`Avatar enrichment failed: ${err?.message || 'unknown error'}`, "error"))
      } else if (e.key === "c" && focusedIdx >= 0 && performers[focusedIdx]) {
        e.preventDefault()
        const p = performers[focusedIdx]
        api.capturePerformerMedia(p.id)
          .then(() => {
            addToast(`Capture queued for @${p.username}`, "success")
            qcMain.invalidateQueries({ queryKey: ["capture-queue"] })
          })
          .catch(() => addToast("Capture failed", "error"))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [performers, focusedIdx, selectedPerformerId, selectMode, addToast, qcMain])

  // Scroll focused card into view
  useEffect(() => {
    if (focusedIdx >= 0 && focusedCardRef.current) {
      focusedCardRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
  }, [focusedIdx])

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 pb-24">
      {/* Header */}
      <div className="hero-surface rounded-[30px] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div>
              <p className="eyebrow mb-2">Creator Roster</p>
              <h1 className="hero-title text-[clamp(1.8rem,3vw,2.7rem)] leading-none text-text-primary">Creators</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary sm:text-[15px]">
                Keep the roster fast, trustworthy, and publication-ready with better identity matching, lighter cards, and faster jumps into captured media.
              </p>
            </div>
            {statsData && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                <span className="ui-chip"><span className="font-mono text-text-primary">{statsData.total ?? 0}</span> tracked</span>
                <span className="ui-chip"><span className="font-mono text-text-primary">{statsData.with_media ?? 0}</span> with media</span>
                <span className="ui-chip"><span className="font-mono text-text-primary">{watchlistCount}</span> favorites</span>
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-3 xl:max-w-[640px] xl:items-end">
            <div className="relative w-full xl:max-w-md">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search creators... (/)"
                className="w-full rounded-2xl border border-white/10 bg-black/20 py-3 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
            </div>

            <div className="grid w-full gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <button
                onClick={() => runUiTransition(() => setShowDiscover(true))}
                className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-3 text-left text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-400/16"
              >
                Discover creators
              </button>
              <button
                onClick={() => runUiTransition(() => { setShowAdd(!showAdd); setShowImportUrl(false); setShowBulkImport(false) })}
                className="rounded-2xl border border-accent/30 bg-accent/12 px-3 py-3 text-left text-sm font-medium text-text-primary transition-colors hover:bg-accent/18"
                data-add-performer
              >
                {showAdd ? "Close add panel" : "Add creator"}
              </button>
              <button
                onClick={handleCaptureAll}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-left text-sm font-medium text-text-primary transition-colors hover:bg-white/[0.07]"
              >
                Capture all due
              </button>
              <div className="flex items-stretch">
                <MoreMenu
                  showBilling={showBilling}
                  showAnalytics={showAnalytics}
                  selectMode={selectMode}
                  watchlistCount={watchlistCount}
                  watchlistCapturing={watchlistCapturing}
                  captureAllRunning={captureAllRunning}
                  onBilling={() => runUiTransition(() => { setShowBilling(!showBilling); setShowAnalytics(false) })}
                  onAnalytics={() => runUiTransition(() => { setShowAnalytics(!showAnalytics); setShowBilling(false) })}
                  onImportUrl={() => runUiTransition(() => { setShowImportUrl(!showImportUrl); setShowBulkImport(false); setShowAdd(false) })}
                  onBulkImport={() => runUiTransition(() => { setShowBulkImport(!showBulkImport); setShowImportUrl(false); setShowAdd(false) })}
                  onExportCsv={() => {}}
                  exportUrl={api.exportPerformersUrl()}
                  onSelect={() => runUiTransition(() => { setSelectMode((v) => !v); setSelectedIds(new Set()) })}
                  onCaptureStale={() => {
                    api.captureStale().then((r) => {
                      addToast(`Queued ${r.queued} stale creators for capture`, "success")
                      qcMain.invalidateQueries({ queryKey: ["capture-queue"] })
                    }).catch(() => addToast("Failed to queue stale captures", "error"))
                  }}
                  onCaptureAll={handleCaptureAll}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Discovery modal */}
      {showDiscover && <DiscoveryModal onClose={() => runUiTransition(() => setShowDiscover(false))} />}

      {/* Add form */}
      {showAdd && <AddCreatorForm onClose={closeForm} />}

      {/* Import URL */}
      {showImportUrl && <ImportUrlPanel onClose={() => runUiTransition(() => setShowImportUrl(false))} />}

      {/* Bulk Import */}
      {showBulkImport && <BulkImportPanel onClose={() => runUiTransition(() => setShowBulkImport(false))} />}

      {activeFilterSummary.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-xs text-text-secondary">
          <span className="text-text-muted">Active filters</span>
          {activeFilterSummary.map((label) => (
            <span
              key={label}
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-text-primary"
            >
              {label}
            </span>
          ))}
          <button
            onClick={() => runUiTransition(() => {
              setSearch("")
              setPlatformFilter("all")
              setSort("most_media")
              setFavOnly(false)
              setDueOnly(false)
              setRenewingOnly(false)
              setSubscribedOnly(false)
              setTagFilter(null)
            })}
            className="ml-auto rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:text-text-primary"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Billing */}
      {showBilling && <BillingPanel onSelect={(id) => runUiTransition(() => setSelectedPerformerId(id))} />}

      {/* Analytics */}
      {showAnalytics && (
        <Suspense fallback={<Skeleton variant="card" height="200px" />}>
          <PerformerAnalyticsPanel onTagClick={handleTagClick} />
        </Suspense>
      )}

      {/* Filters */}
      <div className="section-shell flex flex-wrap items-center gap-3 rounded-[24px] px-4 py-3">
        <div className="flex items-center gap-1 rounded-xl border border-white/8 bg-white/[0.02] p-1">
          {["all", ...PLATFORMS].map((p) => (
            <button
              key={p}
              onClick={() => runUiTransition(() => setPlatformFilter(p))}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs transition-colors",
                platformFilter === p
                  ? "bg-white/10 text-text-primary font-medium"
                  : "text-text-muted hover:text-text-secondary"
              )}
            >
              {p === "all" ? "All" : p}
            </button>
          ))}
        </div>

        <select
          value={sort}
          onChange={(e) => runUiTransition(() => setSort(e.target.value as SortOption))}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-text-secondary focus:border-accent focus:outline-none"
        >
          <option value="most_media">Most Content</option>
          <option value="newest">Newest</option>
          <option value="az">A-Z</option>
        </select>

        <button
          onClick={() => runUiTransition(() => setFavOnly(!favOnly))}
          className={cn(
            "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-colors",
            favOnly
              ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
              : "border-white/10 text-text-muted hover:text-text-secondary"
          )}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill={favOnly ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          Favorites
        </button>

        {/* View toggle */}
        <div className="ml-auto flex items-center gap-1 rounded-xl border border-white/8 bg-white/[0.02] p-1">
          <button
            onClick={() => runUiTransition(() => { setTableView(false); localStorage.setItem("performers-view", "grid") })}
            className={cn("rounded-lg p-1.5 transition-colors", !tableView ? "bg-white/10 text-text-primary" : "text-text-muted hover:text-text-secondary")}
            title="Grid view"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
            </svg>
          </button>
          <button
            onClick={() => runUiTransition(() => { setTableView(true); localStorage.setItem("performers-view", "table") })}
            className={cn("rounded-lg p-1.5 transition-colors", tableView ? "bg-white/10 text-text-primary" : "text-text-muted hover:text-text-secondary")}
            title="Table view"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tag filter strip — collapsed by default */}
      {tagCloud.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tagFilter && (
            <button
              onClick={() => runUiTransition(() => setTagFilter(null))}
              className="flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              {tagFilter}
            </button>
          )}
          <button
            onClick={() => setShowTagCloud((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
              showTagCloud
                ? "border-white/15 bg-white/5 text-text-secondary"
                : "border-white/8 bg-white/[0.03] text-text-muted hover:border-white/15 hover:text-text-secondary"
            )}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cn("transition-transform", showTagCloud ? "rotate-0" : "-rotate-90")}><path d="M6 9l6 6 6-6"/></svg>
            Tags ({tagCloud.length})
          </button>
          {showTagCloud && tagCloud
            .filter((t) => t.tag !== tagFilter)
            .map(({ tag, count }) => (
              <button
                key={tag}
                onClick={() => runUiTransition(() => setTagFilter(tag))}
                className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[11px] text-text-muted hover:border-white/15 hover:text-text-secondary transition-colors"
                title={`Filter by tag: ${tag} (${count} creators)`}
              >
                {tag}
                <span className="ml-1 font-mono text-[9px] opacity-50">{count}</span>
              </button>
            ))}
        </div>
      )}

      {/* Bulk action bar */}
      {selectMode && (
        <div className="flex items-center gap-3 rounded-2xl border border-accent/20 bg-accent/5 px-4 py-2.5">
          <span className="text-sm text-text-secondary">{selectedIds.size} selected</span>
          <button
            onClick={() => {
              if (selectedIds.size === performers.length) {
                setSelectedIds(new Set())
              } else {
                setSelectedIds(new Set(performers.map((p) => p.id)))
              }
            }}
            className="text-xs text-accent hover:text-accent/80"
          >
            {selectedIds.size === performers.length ? "Deselect all" : `Select all ${performers.length}`}
          </button>
          {selectedIds.size > 0 && (
            <>
              <button
                onClick={() => {
                  Array.from(selectedIds).forEach((id) => api.capturePerformerMedia(id))
                  addToast(`Queued ${selectedIds.size} creators for capture`, "success")
                  qcMain.invalidateQueries({ queryKey: ["capture-queue"] })
                  clearSelect()
                }}
                className="rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Capture {selectedIds.size}
              </button>
              <button
                onClick={() => {
                  Array.from(selectedIds).forEach((id) => api.enrichPerformer(id).catch((err) => addToast(`Avatar enrichment failed: ${err?.message || 'unknown error'}`, "error")))
                  addToast(`Refreshing avatars for ${selectedIds.size} creator${selectedIds.size !== 1 ? "s" : ""}…`, "info")
                  clearSelect()
                }}
                className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                Refresh Avatars
              </button>
            </>
          )}
          <button onClick={clearSelect} className="ml-auto text-sm text-text-muted hover:text-text-primary">
            Cancel
          </button>
        </div>
      )}

      {/* Grid / Table */}
      {error ? (
        <EmptyState
          icon="⚠️"
          eyebrow="Temporary issue"
          title="Couldn't load creators"
          description="The server is starting up. Try refreshing in a moment."
          action={{ label: "Retry", onClick: () => refetch() }}
        />
      ) : isLoading ? (
        tableView ? (
          <div className="overflow-hidden rounded-2xl border border-white/8">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} variant="card" height="44px" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="h-40 rounded-xl border border-white/8 bg-white/[0.03]">
                <div className="flex gap-3.5 p-4">
                  <div className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-white/10 ring-2 ring-white/5" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3.5 w-24 animate-pulse rounded bg-white/10" />
                    <div className="h-3 w-16 animate-pulse rounded bg-white/[0.06]" />
                    <div className="flex gap-1.5 pt-1">
                      <div className="h-4 w-14 animate-pulse rounded-full bg-white/[0.06]" />
                      <div className="h-4 w-10 animate-pulse rounded-full bg-white/[0.06]" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : deferredFilteredPerformers.length === 0 ? (
        <EmptyState
          icon="👤"
          eyebrow="Roster ready"
          title="No creators yet"
          description="Add creators to start tracking their content"
          action={{ label: "Add Creator", onClick: () => runUiTransition(() => { setShowAdd(true); setShowImportUrl(false); setShowBulkImport(false) }) }}
        />
      ) : tableView ? (
        <div className="overflow-hidden rounded-2xl border border-white/8">
          {/* Table header */}
          <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.02] px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-text-muted select-none">
            {selectMode && <div className="w-4 flex-shrink-0" />}
            <div className="w-7 flex-shrink-0" />
            {/* Sortable column headers */}
            {([
              ["flex-1 text-left", "az", "Creator"],
              ["w-20 flex-shrink-0 text-right", "subscription_renewed_at", "Sub"],
              ["w-14 flex-shrink-0 text-right", "subscription_price", "Price"],
              ["w-14 flex-shrink-0 text-right", "most_media", "Media"],
              ["w-14 flex-shrink-0 text-right", "screenshots_count", "Shots"],
              ["w-16 flex-shrink-0 text-right", "last_checked_at", "Checked"],
            ] as [string, SortOption, string][]).map(([cls, col, label]) => (
              <button
                key={col}
                onClick={() => runUiTransition(() => setSort(sort === col ? "newest" : col))}
                className={cn(cls, "flex items-center gap-0.5 transition-colors hover:text-text-secondary", sort === col ? "text-accent" : "")}
              >
                {sort === col && (
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="shrink-0">
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                )}
                {label}
              </button>
            ))}
            <div className="w-16 flex-shrink-0" />
          </div>
          {performers.map((p, idx) => (
            <PerformerRow
              key={p.id}
              performer={p}
              onSelect={(id) => handleCardSelect(id, idx)}
              selected={selectedIds.has(p.id)}
              onToggleSelect={toggleSelect}
              selectMode={selectMode}
              isInQueue={activePerformerIds.has(p.id)}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {/* Discover CTA card */}
          {!selectMode && !search && platformFilter === "all" && !tagFilter && (
            <button
              onClick={() => runUiTransition(() => setShowDiscover(true))}
              className="group/cta flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-accent/30 bg-gradient-to-br from-accent/5 via-transparent to-violet-500/5 p-6 text-center transition-[background-color,border-color,box-shadow,transform] hover:border-accent/50 hover:from-accent/10 hover:to-violet-500/10 hover:shadow-lg hover:shadow-accent/5"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent transition-transform group-hover/cta:scale-110">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /><path d="M11 8v6M8 11h6" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">Discover Creators</p>
                <p className="mt-0.5 text-[11px] text-text-muted">Find new creators with AI-powered search</p>
              </div>
            </button>
          )}
          {performers.map((p, idx) => (
            <PerformerCard
              key={p.id}
              performer={p}
              onSelect={(id) => handleCardSelect(id, idx)}
              onTagClick={handleTagClick}
              selected={selectedIds.has(p.id)}
              onToggleSelect={toggleSelect}
              selectMode={selectMode}
              isInQueue={activePerformerIds.has(p.id)}
              isFocused={focusedIdx === idx}
              cardRef={focusedIdx === idx ? focusedCardRef : undefined}
            />
          ))}
        </div>
      )}

      {performers.length < deferredFilteredPerformers.length && <div ref={loadMoreRef} className="h-1" />}

      {deferredFilteredPerformers.length > 0 && (
        <div className="text-center text-xs text-text-muted">
          {performers.length < deferredFilteredPerformers.length ? (
            <div className="flex flex-col items-center gap-2">
              <span>Showing {performers.length} of {(subscribedOnly || tagFilter) ? deferredFilteredPerformers.length : (data?.total ?? deferredFilteredPerformers.length)} creators</span>
              <button
                onClick={() => setVisibleLimit((v) => v + 24)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
              >
                Load more ({Math.min(24, deferredFilteredPerformers.length - performers.length)} more)
              </button>
            </div>
          ) : !subscribedOnly && data?.total && data.total > allPerformers.length ? (
            <span>{data.total} total · showing all {allPerformers.length} loaded</span>
          ) : null}
        </div>
      )}

      {/* Capture queue bottom panel */}
      <CaptureQueuePanel queueData={queueData} />

      {/* Full-screen performer profile overlay */}
      {selectedPerformerId !== null && (
        <PerformerProfile
          performerId={selectedPerformerId}
          onClose={() => runUiTransition(() => setSelectedPerformerId(null))}
          onNavigate={(id) => runUiTransition(() => setSelectedPerformerId(id))}
        />
      )}
    </div>
  )
}
