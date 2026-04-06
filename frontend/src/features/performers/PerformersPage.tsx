import { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense, startTransition, memo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import { cn } from "@/lib/cn"
import { api, type Performer, type DiscoveredCreator, type CaptureQueueEntry } from "@/lib/api"
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

/* ── Stats Bar ─────────────────────────────────────────────────────────── */

function StatsBar({ onRenewingClick }: { onRenewingClick?: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["performer-stats"],
    queryFn: () => api.performerStats(),
    staleTime: 30_000,
  })

  if (isLoading) return <Skeleton variant="card" height="72px" />

  const stats = data

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
        <p className="text-[10px] text-text-muted">Total</p>
        <p className="mt-0.5 font-mono text-lg font-semibold text-text-primary">{stats?.total ?? 0}</p>
      </div>
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
        <p className="text-[10px] text-text-muted">Watchlist</p>
        <p className="mt-0.5 font-mono text-lg font-semibold text-text-primary">{stats?.favorites ?? 0}</p>
      </div>
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
        <p className="text-[10px] text-text-muted">With Media</p>
        <p className="mt-0.5 font-mono text-lg font-semibold text-text-primary">{stats?.with_media ?? 0}</p>
      </div>
      <div className="rounded-xl border border-sky-500/15 bg-sky-500/[0.03] px-3 py-2.5">
        <p className="text-[10px] text-sky-400/70">Subscribed</p>
        <p className="mt-0.5 font-mono text-lg font-semibold text-sky-300">{stats?.subscribed_count ?? 0}</p>
      </div>
      <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.03] px-3 py-2.5">
        <p className="text-[10px] text-emerald-400/70">Spend/mo</p>
        <p className="mt-0.5 font-mono text-lg font-semibold text-emerald-300">
          {stats?.monthly_spend ? `$${stats.monthly_spend.toFixed(0)}` : "--"}
        </p>
      </div>
      <button
        type="button"
        onClick={onRenewingClick}
        className={cn(
          "rounded-xl border px-3 py-2.5 text-left transition-opacity hover:opacity-80",
          (stats?.renewing_soon_count ?? 0) > 0
            ? "border-orange-500/15 bg-orange-500/[0.03]"
            : "border-white/[0.06] bg-white/[0.03]"
        )}
        title="Filter by subscriptions renewing within 7 days"
      >
        <p className={cn("text-[10px]", (stats?.renewing_soon_count ?? 0) > 0 ? "text-orange-400/70" : "text-text-muted")}>Renewing</p>
        <p className={cn("mt-0.5 font-mono text-lg font-semibold", (stats?.renewing_soon_count ?? 0) > 0 ? "text-orange-300" : "text-text-primary")}>
          {stats?.renewing_soon_count ?? 0}
        </p>
      </button>
      <div className={cn(
        "rounded-xl border px-3 py-2.5",
        (stats?.stale_count ?? 0) > 0
          ? "border-amber-500/15 bg-amber-500/[0.03]"
          : "border-white/[0.06] bg-white/[0.03]"
      )}>
        <p className={cn("text-[10px]", (stats?.stale_count ?? 0) > 0 ? "text-amber-400/70" : "text-text-muted")}>Stale</p>
        <p className={cn("mt-0.5 font-mono text-lg font-semibold", (stats?.stale_count ?? 0) > 0 ? "text-amber-300" : "text-text-primary")}>
          {stats?.stale_count ?? 0}
        </p>
      </div>
    </div>
  )
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-6 pt-20 backdrop-blur-sm" onClick={onClose}>
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
            <div className="flex flex-wrap gap-2">
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
                      "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                      added
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : "border-white/10 bg-white/5 text-text-secondary hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
                    )}
                  >
                    {added && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>}
                    @{c.username}
                    <span className={cn("rounded-full border px-1.5 py-px text-[9px] leading-none", pClass)}>{c.platform}</span>
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
  const addToast = useAppStore((s) => s.addToast)
  const setMediaCreator = useAppStore((s) => s.setMediaCreator)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const [capturing, setCapturing] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState("")

  const notesMutation = useMutation({
    mutationFn: (notes: string) => api.updatePerformer(performer.id, { notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["performers"] })
      addToast("Notes saved", "success")
      setShowNotes(false)
    },
    onError: () => addToast("Failed to save notes", "error"),
  })

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

  const subMutation = useMutation({
    mutationFn: () => {
      const newSub = performer.is_subscribed === 1 ? 0 : 1
      const updates: Record<string, unknown> = { is_subscribed: newSub }
      if (newSub === 1) updates.subscription_renewed_at = new Date().toISOString()
      return api.updatePerformer(performer.id, updates as Parameters<typeof api.updatePerformer>[1])
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["performers"] })
      qc.invalidateQueries({ queryKey: ["performer-stats"] })
    },
  })

  async function handleRefreshAvatar(e: React.MouseEvent) {
    e.stopPropagation()
    setEnriching(true)
    try {
      await api.enrichPerformer(performer.id)
      qc.invalidateQueries({ queryKey: ["performers"] })
    } catch {
      // silent — enrich is best-effort
    } finally {
      setEnriching(false)
    }
  }

  async function handleQuickCapture(e: React.MouseEvent) {
    e.stopPropagation()
    setCapturing(true)
    try {
      await api.capturePerformerMedia(performer.id)
      addToast(`Capture queued for @${performer.username}`, "success")
      qc.invalidateQueries({ queryKey: ["capture-queue"] })
    } catch {
      addToast("Capture failed", "error")
    } finally {
      setCapturing(false)
    }
  }

  const tags = parseTags(performer.tags)
  const platformClass = PLATFORM_COLORS[performer.platform] ?? "bg-white/10 text-text-secondary border-white/10"
  const handlePrefetch = useCallback(() => {
    prefetchPerformerProfile(qc, performer.id)
  }, [qc, performer.id])

  function daysAgo(dateStr: string): string {
    const d = new Date(dateStr)
    const diff = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
    if (diff === 0) return "today"
    if (diff === 1) return "1d ago"
    return `${diff}d ago`
  }

  return (
    <div
      ref={cardRef}
      className={cn(
        "group rounded-2xl border bg-white/[0.03] transition-all hover:border-white/15 hover:bg-white/[0.05]",
        isFocused ? "border-accent/50 ring-1 ring-accent/30" : "border-white/8"
      )}
      onMouseEnter={() => { setHovered(true); handlePrefetch() }}
      onMouseLeave={() => setHovered(false)}
      onFocus={handlePrefetch}
    >
      <div
        onClick={() => onSelect(performer.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(performer.id) }}
        className="w-full cursor-pointer p-4 text-left"
      >
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/10">
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
            {performer.avatar_url || performer.avatar_local ? (
              <img
                src={performer.avatar_local ?? performer.avatar_url ?? ""}
                alt={performer.username}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xl font-bold text-text-muted">
                {performer.username.charAt(0).toUpperCase()}
              </div>
            )}
            {performer.status === "active" && (
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#0a1628] bg-emerald-400" title="Active" />
            )}
            {isInQueue && !selectMode && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[#0a1628]/60">
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
              {performer.is_subscribed === 1 && (() => {
                if (performer.subscription_renewed_at) {
                  const daysUntil = Math.round(
                    (new Date(performer.subscription_renewed_at).getTime() + 30 * 24 * 60 * 60 * 1000 - Date.now()) / (1000 * 60 * 60 * 24)
                  )
                  if (daysUntil < 0) return (
                    <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[9px] font-medium text-red-400 border border-red-500/30" title="Subscription overdue">⚡ overdue</span>
                  )
                  if (daysUntil <= 7) return (
                    <span className="rounded-full bg-orange-500/20 px-1.5 py-0.5 text-[9px] font-medium text-orange-400 border border-orange-500/30" title={`Renews in ${daysUntil} days`}>⚡ {daysUntil}d</span>
                  )
                }
                return <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400 border border-emerald-500/30">✓ Sub'd</span>
              })()}
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
              {performer.subscription_price != null && (
                <span className="rounded-full bg-sky-500/20 border border-sky-500/30 px-1.5 py-0.5 text-[10px] text-sky-300">
                  ${performer.subscription_price}/mo
                </span>
              )}
              {performer.is_subscribed === 1 && performer.subscription_renewed_at && (() => {
                const nextRenewal = new Date(new Date(performer.subscription_renewed_at).getTime() + 30 * 24 * 60 * 60 * 1000)
                const daysUntil = Math.round((nextRenewal.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                if (daysUntil >= 0 && daysUntil > 7) {
                  return <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] text-white/30" title="Next renewal date">{nextRenewal.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                }
                return null
              })()}
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
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex items-center gap-0.5">
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setNotesDraft(performer.notes ?? "")
                    setShowNotes((v) => !v)
                  }}
                  className={cn(
                    "rounded-lg p-1 transition-colors hover:bg-white/10",
                    performer.notes ? "text-amber-400/70 hover:text-amber-400" : "text-text-muted/40 hover:text-text-muted"
                  )}
                  title={showNotes ? "Close notes" : (performer.notes ? "Edit notes" : "Add notes")}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/>
                  </svg>
                </button>
                {showNotes && (
                  <div
                    className="absolute right-0 top-8 z-30 w-64 rounded-xl border border-white/15 bg-[#0d1a30] p-3 shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <textarea
                      autoFocus
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      rows={4}
                      placeholder="Add notes…"
                      className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent/60 focus:outline-none"
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { e.stopPropagation(); setShowNotes(false) }
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.stopPropagation()
                          notesMutation.mutate(notesDraft)
                        }
                      }}
                    />
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowNotes(false) }}
                        className="text-xs text-text-muted hover:text-text-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); notesMutation.mutate(notesDraft) }}
                        disabled={notesMutation.isPending}
                        className="rounded-lg bg-accent px-2.5 py-1 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        {notesMutation.isPending ? "Saving…" : "Save"}
                      </button>
                    </div>
                    <p className="mt-1.5 text-[9px] text-text-muted">⌘↵ to save · Esc to close</p>
                  </div>
                )}
              </div>
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
            <div className="flex flex-col items-end gap-1">
              {(performer.media_count ?? 0) > 0 && (
                <span className="text-[10px] text-text-muted">{performer.media_count} media</span>
              )}
              {(performer.screenshots_count ?? 0) > 0 && (
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                  {performer.screenshots_count} shots
                </span>
              )}
              {performer.last_checked_at ? (() => {
                const diff = Math.floor((Date.now() - new Date(performer.last_checked_at).getTime()) / (1000 * 60 * 60 * 24))
                const color = diff === 0 ? "text-emerald-400" : diff <= 3 ? "text-white/50" : diff <= 7 ? "text-amber-400" : "text-red-400"
                return <span className={cn("text-[10px]", color)}>{daysAgo(performer.last_checked_at)}</span>
              })() : (
                <span className="text-[10px] text-red-400/60">never</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Screenshot thumbnails — lazy-loaded on hover */}
      {(performer.screenshots_count ?? 0) > 0 && (
        <PerformerThumbs performerId={performer.id} username={performer.username} visible={hovered} />
      )}

      {/* Quick action bar */}
      <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex gap-2">
          {performer.reddit_username && (
            <a
              href={`https://reddit.com/user/${performer.reddit_username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-orange-400 hover:underline"
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
              className="text-[10px] text-sky-400 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              @{performer.twitter_username}
            </a>
          )}
        </div>
        <div className="flex items-center gap-1">
          {performer.profile_url && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard.writeText(performer.profile_url!)
                addToast(`@${performer.username} URL copied`, "success")
              }}
              className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-white/10 hover:text-text-secondary"
              title="Copy profile URL"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy
            </button>
          )}
          <button
            onClick={handleViewMedia}
            className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-white/10 hover:text-sky-400"
            title="View captured media"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
            Media
          </button>
          <button
            onClick={handleRefreshAvatar}
            disabled={enriching}
            className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-white/10 hover:text-text-secondary disabled:opacity-40"
            title="Refresh avatar from Redgifs"
          >
            {enriching ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
            )}
            Avatar
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); subMutation.mutate() }}
            disabled={subMutation.isPending}
            className={cn(
              "flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] transition-colors disabled:opacity-40",
              performer.is_subscribed === 1
                ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                : "bg-white/5 text-text-muted hover:bg-white/10 hover:text-emerald-400"
            )}
            title={performer.is_subscribed === 1 ? "Mark as unsubscribed" : "Mark as subscribed (sets today as renewal date)"}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill={performer.is_subscribed === 1 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
            {performer.is_subscribed === 1 ? "Sub'd" : "Subscribe"}
          </button>
          <button
            onClick={handleQuickCapture}
            disabled={capturing || isInQueue}
            className={cn(
              "flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] transition-colors disabled:opacity-40",
              isInQueue
                ? "bg-accent/10 text-accent"
                : "bg-white/5 text-text-muted hover:bg-white/10 hover:text-text-secondary"
            )}
            title={isInQueue ? "Already in capture queue" : "Queue capture"}
          >
            {capturing || isInQueue ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
            )}
            {capturing ? "Starting…" : isInQueue ? "Queued" : "Capture"}
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
  prev.performer.media_count === next.performer.media_count &&
  prev.performer.screenshots_count === next.performer.screenshots_count &&
  prev.performer.last_checked_at === next.performer.last_checked_at &&
  prev.performer.avatar_url === next.performer.avatar_url &&
  prev.performer.notes === next.performer.notes
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
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-sm font-semibold text-text-muted">
          {p.avatar_local || p.avatar_url ? (
            <img src={p.avatar_local ?? p.avatar_url ?? ""} alt="" className="h-full w-full object-cover" />
          ) : (
            p.username.charAt(0).toUpperCase()
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
    queryFn: () => api.browseScreenshots({ performer_id: performerId, limit: 5, sort: "newest", offset: 0 }),
    enabled: visible,
    staleTime: 120_000,
  })

  const shots = (data?.screenshots ?? []).filter((s) => s.local_url)
  if (shots.length === 0) return null

  return (
    <div className="flex gap-1 px-4 pb-2.5">
      {shots.map((s) => (
        <button
          key={s.id}
          onClick={(e) => { e.stopPropagation(); setMediaCreator(performerId, username); setActiveView("images") }}
          className="group/thumb relative aspect-square flex-1 overflow-hidden rounded-lg bg-white/5"
          title={s.term ?? ""}
        >
          <img src={s.local_url!} alt="" className="h-full w-full object-cover opacity-70 transition-opacity group-hover/thumb:opacity-100" />
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
    queryFn: () => api.browseScreenshots({ performer_id: performerId, limit: 6, offset: 0 }),
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
        {performer.avatar_url ? (
          <img src={performer.avatar_url} alt={performer.username} className="h-full w-full rounded-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-full bg-white/10 text-[10px] text-text-muted">
            {performer.username[0]?.toUpperCase()}
          </div>
        )}
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
  const [sort, setSort] = useState<SortOption>("newest")
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
    if (dueOnly) labels.push("Due")
    if (renewingOnly) labels.push("Renewing")
    if (subscribedOnly) labels.push("Subscribed")
    if (tagFilter) labels.push(`#${tagFilter}`)
    if (sort !== "newest") labels.push(`Sort: ${sort.replace(/_/g, " ")}`)
    return labels
  }, [debouncedSearch, platformFilter, favOnly, dueOnly, renewingOnly, subscribedOnly, tagFilter, sort])

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
  const performers = filteredPerformers.slice(0, visibleLimit)
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
    if (!el || performers.length >= filteredPerformers.length) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleLimit((v) => Math.min(v + 24, filteredPerformers.length))
        }
      },
      { rootMargin: "500px 0px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [performers.length, filteredPerformers.length])

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
    <div className="mx-auto max-w-6xl space-y-6 p-6 pb-24">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Creators</h1>
          <p className="mt-1 text-sm text-text-secondary">Track and manage content creators</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search creators... (/)"
              className="w-48 rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>
          <button
            onClick={() => runUiTransition(() => { setShowBilling(!showBilling); setShowAnalytics(false) })}
            className={cn(
              "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
              showBilling
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-white/10 text-text-secondary hover:text-text-primary"
            )}
          >
            {showBilling ? "Hide Billing" : "Billing"}
          </button>
          <button
            onClick={() => runUiTransition(() => { setShowAnalytics(!showAnalytics); setShowBilling(false) })}
            className={cn(
              "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
              showAnalytics
                ? "border-accent/40 bg-accent/15 text-accent"
                : "border-white/10 text-text-secondary hover:text-text-primary"
            )}
          >
            {showAnalytics ? "Hide Analytics" : "Analytics"}
          </button>
          <button
            onClick={() => runUiTransition(() => setShowDiscover(true))}
            className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20"
          >
            Discover
          </button>
          <button
            onClick={() => runUiTransition(() => { setShowImportUrl(!showImportUrl); setShowBulkImport(false); setShowAdd(false) })}
            className="rounded-xl border border-white/10 px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            Import URL
          </button>
          <button
            onClick={() => runUiTransition(() => { setShowBulkImport(!showBulkImport); setShowImportUrl(false); setShowAdd(false) })}
            className="rounded-xl border border-white/10 px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            Bulk Import
          </button>
          <a
            href={api.exportPerformersUrl()}
            download="creators.csv"
            className="rounded-xl border border-white/10 px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            Export CSV
          </a>
          <button
            onClick={() => runUiTransition(() => { setSelectMode((v) => !v); setSelectedIds(new Set()) })}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors",
              selectMode
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-white/10 text-text-secondary hover:text-text-primary"
            )}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg>
            Select
          </button>
          <button
            onClick={() => {
              api.captureStale().then((r) => {
                addToast(`Queued ${r.queued} stale creators for capture`, "success")
                qcMain.invalidateQueries({ queryKey: ["capture-queue"] })
              }).catch(() => addToast("Failed to queue stale captures", "error"))
            }}
            className="flex items-center gap-1.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-400 transition-colors hover:bg-amber-500/10"
            title="Capture all creators not checked in 7+ days"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            Capture Stale
          </button>
          {watchlistCount > 0 && (
            <button
              onClick={handleCaptureWatchlist}
              disabled={watchlistCapturing}
              title={`Capture content for all ${watchlistCount} favorited creators`}
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50 whitespace-nowrap"
            >
              {watchlistCapturing ? "Capturing…" : `♥ Capture ${watchlistCount}`}
            </button>
          )}
          <button
            onClick={handleCaptureAll}
            disabled={captureAllRunning}
            title="Capture fresh content for all active creators"
            className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-300 transition-colors hover:bg-violet-500/20 disabled:opacity-50 whitespace-nowrap"
          >
            {captureAllRunning ? "Queuing…" : "Capture All"}
          </button>
          <button
            onClick={() => runUiTransition(() => { setShowAdd(!showAdd); setShowImportUrl(false); setShowBulkImport(false) })}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            data-add-performer
          >
            {showAdd ? "Close" : "Add Creator"}
          </button>
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

      {/* Stats */}
      <StatsBar onRenewingClick={() => runUiTransition(() => setRenewingOnly((v) => !v))} />

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
              setSort("newest")
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
      <div className="flex flex-wrap items-center gap-3">
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
          <option value="newest">Newest</option>
          <option value="az">A-Z</option>
          <option value="most_media">Most Media</option>
          <option value="screenshots_count">Most Shots</option>
          <option value="last_checked_at">Recently Checked</option>
          <option value="subscription_price">Price</option>
          <option value="subscription_renewed_at">Renewal Date</option>
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

        <button
          onClick={() => runUiTransition(() => setDueOnly(!dueOnly))}
          className={cn(
            "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-colors",
            dueOnly
              ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
              : "border-white/10 text-text-muted hover:text-text-secondary"
          )}
          title="Show creators not checked in 7+ days"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
          </svg>
          Due
        </button>
        <button
          onClick={() => runUiTransition(() => setRenewingOnly(!renewingOnly))}
          className={cn(
            "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-colors",
            renewingOnly
              ? "border-orange-500/30 bg-orange-500/10 text-orange-400"
              : "border-white/10 text-text-muted hover:text-text-secondary"
          )}
          title="Show subscriptions renewing within 7 days"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
          </svg>
          Renewing
        </button>
        <button
          onClick={() => runUiTransition(() => setSubscribedOnly(!subscribedOnly))}
          className={cn(
            "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-colors",
            subscribedOnly
              ? "border-sky-500/30 bg-sky-500/10 text-sky-400"
              : "border-white/10 text-text-muted hover:text-text-secondary"
          )}
          title="Show subscribed creators only"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill={subscribedOnly ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
          </svg>
          Subscribed
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

      {/* Tag filter strip */}
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
          {tagCloud
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
          title="Couldn't load creators"
          description="The server is starting up. Try refreshing in a moment."
          action={{ label: "Retry", onClick: () => refetch() }}
        />
      ) : isLoading ? (
        tableView ? (
          <div className="overflow-hidden rounded-2xl border border-white/8">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-[fade-in-up_300ms_ease-out_both]" style={{ animationDelay: `${i * 50}ms` }}>
                <Skeleton variant="card" height="44px" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="h-40 rounded-xl border border-white/8 bg-white/[0.03] animate-[fade-in-up_300ms_ease-out_both]"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="flex gap-3 p-4">
                  <div className="h-14 w-14 shrink-0 animate-pulse rounded-xl bg-white/10" />
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
      ) : filteredPerformers.length === 0 ? (
        <EmptyState
          icon="👤"
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {performers.map((p, idx) => (
            <div
              key={p.id}
              className="animate-[fade-in-up_300ms_ease-out_both]"
              style={{ animationDelay: `${Math.min(idx * 30, 600)}ms` }}
            >
              <PerformerCard
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
            </div>
          ))}
        </div>
      )}

      {performers.length < filteredPerformers.length && <div ref={loadMoreRef} className="h-1" />}

      {filteredPerformers.length > 0 && (
        <div className="text-center text-xs text-text-muted">
          {performers.length < filteredPerformers.length ? (
            <div className="flex flex-col items-center gap-2">
              <span>Showing {performers.length} of {(subscribedOnly || tagFilter) ? filteredPerformers.length : (data?.total ?? filteredPerformers.length)} creators</span>
              <button
                onClick={() => setVisibleLimit((v) => v + 24)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
              >
                Load more ({Math.min(24, filteredPerformers.length - performers.length)} more)
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
