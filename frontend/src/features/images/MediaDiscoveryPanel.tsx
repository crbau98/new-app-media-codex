import { useState, useCallback } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api, type DiscoveredCreator, type Performer } from "@/lib/api"
import { useAppStore } from "@/store"
import { cn } from "@/lib/cn"
import { sharedQueryKeys } from "@/features/sharedQueries"

interface MediaDiscoveryPanelProps {
  discoverySeedLabel?: string
  mediaCreatorId?: number | null
  mediaCreatorName?: string | null
  term?: string | null
  activeTagFilter?: string | null
  similarCreators?: Performer[]
  onSelectSimilarCreator?: (id: number, username: string) => void
  onCaptureSimilarCreator?: (creator: Performer) => void | Promise<void>
  discoveryQuery?: string
  onDiscoveryQueryChange?: (value: string) => void
  discoveryPrompt?: string
  discoveryPlatform?: string
  onDiscoveryPlatformChange?: (value: string) => void
  onRunDiscovery?: () => void | Promise<void>
  discoverPending?: boolean
  discoveryCandidatesLength?: number
  onImportAllSuggestedCreators?: () => void | Promise<void>
  importPending?: boolean
  discoveryOverview?: unknown
  orderedDiscoveryResults?: DiscoveredCreator[]
  isImportedUsername?: (username: string) => boolean
  onImportSuggestedCreator?: (creator: DiscoveredCreator) => void | Promise<void>
}

const PLATFORMS = ["OnlyFans", "Twitter/X", "Fansly", "Reddit", "Instagram"]

const PLATFORM_COLORS: Record<string, string> = {
  OnlyFans: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Twitter/X": "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Fansly: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Reddit: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  Instagram: "bg-pink-500/15 text-pink-300 border-pink-500/30",
}

export function MediaDiscoveryPanel({
  discoverySeedLabel,
  mediaCreatorName,
  term,
  similarCreators = [],
  discoveryQuery = "",
  onDiscoveryQueryChange,
  discoveryPlatform = "all",
  onDiscoveryPlatformChange,
  onRunDiscovery,
  discoverPending = false,
  orderedDiscoveryResults = [],
  isImportedUsername,
  onImportSuggestedCreator,
  onImportAllSuggestedCreators,
  importPending = false,
}: MediaDiscoveryPanelProps) {
  const qc = useQueryClient()
  const addToast = useAppStore((s) => s.addToast)
  const [addedSet, setAddedSet] = useState<Set<string>>(new Set())
  const [localQuery, setLocalQuery] = useState(discoveryQuery)
  const [localPlatform, setLocalPlatform] = useState(discoveryPlatform)

  // Sync with parent when props change
  const effectiveQuery = onDiscoveryQueryChange ? discoveryQuery : localQuery
  const effectivePlatform = onDiscoveryPlatformChange ? discoveryPlatform : localPlatform

  const handleQueryChange = (v: string) => {
    if (onDiscoveryQueryChange) onDiscoveryQueryChange(v)
    else setLocalQuery(v)
  }
  const handlePlatformChange = (v: string) => {
    if (onDiscoveryPlatformChange) onDiscoveryPlatformChange(v)
    else setLocalPlatform(v)
  }

  const importMutation = useMutation({
    mutationFn: (creator: DiscoveredCreator) =>
      api.importDiscoveredPerformers([creator], true),
    onSuccess: (result, creator) => {
      setAddedSet((prev) => new Set(prev).add(creator.username.toLowerCase()))
      qc.invalidateQueries({ queryKey: ["performers"] })
      qc.invalidateQueries({ queryKey: ["performers-for-media"] })
      qc.invalidateQueries({ queryKey: sharedQueryKeys.captureQueue() })
      if (result.created > 0) {
        addToast(`Added @${creator.username} — capture queued`, "success")
        const created = result.performers[0]
        if (created) {
          api.enrichPerformer(created.id)
            .then(() => qc.invalidateQueries({ queryKey: ["performers"] }))
            .catch(() => {})
        }
      } else if (result.existing > 0) {
        addToast(`Capture queued for @${creator.username}`, "success")
      } else {
        addToast(`Nothing changed for @${creator.username}`, "info")
      }
      onImportSuggestedCreator?.(creator)
    },
    onError: (_err, creator) => {
      addToast(`Failed to add @${creator.username}`, "error")
    },
  })

  const importAllMutation = useMutation({
    mutationFn: () => {
      const toImport = orderedDiscoveryResults.filter(
        (c) => !addedSet.has(c.username.toLowerCase()) && !isImportedUsername?.(c.username)
      )
      if (!toImport.length) return Promise.resolve({ created: 0, existing: 0, performers: [], skipped: 0, existing_performers: [] })
      return api.importDiscoveredPerformers(toImport, true)
    },
    onSuccess: (result) => {
      setAddedSet((prev) => {
        const next = new Set(prev)
        orderedDiscoveryResults.forEach((c) => next.add(c.username.toLowerCase()))
        return next
      })
      qc.invalidateQueries({ queryKey: ["performers"] })
      qc.invalidateQueries({ queryKey: ["performers-for-media"] })
      qc.invalidateQueries({ queryKey: sharedQueryKeys.captureQueue() })
      addToast(`Queued ${result.created} new and ${result.existing} existing creators`, "success")
      onImportAllSuggestedCreators?.()
    },
    onError: () => addToast("Bulk import failed", "error"),
  })

  const handleSearch = useCallback(() => {
    if (!effectiveQuery.trim()) return
    onRunDiscovery?.()
  }, [effectiveQuery, onRunDiscovery])

  const handleAddAll = useCallback(() => {
    importAllMutation.mutate()
  }, [importAllMutation])

  const results = orderedDiscoveryResults
  const hasResults = results.length > 0

  return (
    <div className="border-b border-white/10 bg-white/[0.015] px-4 py-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">AI Creator Discovery</h3>
          {(discoverySeedLabel || mediaCreatorName || term) && (
            <p className="mt-0.5 text-xs text-text-muted">
              Seed: {[discoverySeedLabel, mediaCreatorName, term].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {similarCreators.length > 0 && (
          <div className="text-right">
            <p className="text-xs text-text-muted">{similarCreators.length} similar creators</p>
          </div>
        )}
      </div>

      {/* Similar creators quick row */}
      {similarCreators.length > 0 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {similarCreators.map((c) => (
            <button
              key={c.id}
              onClick={() => {}}
              className="shrink-0 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-1.5 text-left text-xs hover:border-accent/40 hover:bg-accent/10"
              title={`@${c.username} — click to filter`}
            >
              <span className="font-medium text-text-primary">@{c.username}</span>
              {c.platform && (
                <span className={cn("ml-1.5 rounded-full border px-1.5 py-px text-[9px]", PLATFORM_COLORS[c.platform] ?? "bg-white/10 text-text-secondary border-white/10")}>
                  {c.platform}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Search controls */}
      <div className="flex gap-2">
        <input
          type="text"
          value={effectiveQuery}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Describe creators you're looking for..."
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          onKeyDown={(e) => { if (e.key === "Enter" && effectiveQuery.trim()) handleSearch() }}
        />
        <select
          value={effectivePlatform}
          onChange={(e) => handlePlatformChange(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-sm text-text-secondary focus:border-accent focus:outline-none"
        >
          <option value="all">All Platforms</option>
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button
          onClick={handleSearch}
          disabled={!effectiveQuery.trim() || discoverPending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {discoverPending ? "Searching..." : "Discover"}
        </button>
      </div>

      {/* Results */}
      {hasResults && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-muted">{results.length} suggestion{results.length === 1 ? "" : "s"}</p>
            <button
              onClick={handleAddAll}
              disabled={importAllMutation.isPending || importPending}
              className="rounded-md bg-accent/20 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/30 disabled:opacity-40"
            >
              {importAllMutation.isPending || importPending ? "Adding..." : "Add All"}
            </button>
          </div>

          {results.map((creator) => {
            const added = addedSet.has(creator.username.toLowerCase()) || isImportedUsername?.(creator.username)
            const pClass = PLATFORM_COLORS[creator.platform] ?? "bg-white/10 text-text-secondary border-white/10"
            return (
              <div
                key={creator.username}
                className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-text-muted">
                  {creator.username.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">@{creator.username}</span>
                    <span className={cn("rounded-full border px-2 py-px text-[10px]", pClass)}>
                      {creator.platform}
                    </span>
                    {creator.exists && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-px text-[10px] text-emerald-300">
                        Tracked
                      </span>
                    )}
                  </div>
                  {creator.display_name && (
                    <p className="text-xs text-text-secondary">{creator.display_name}</p>
                  )}
                  {creator.bio && (
                    <p className="mt-0.5 text-xs text-text-muted line-clamp-2">{creator.bio}</p>
                  )}
                  {creator.reason && (
                    <p className="mt-0.5 text-[11px] text-text-secondary">{creator.reason}</p>
                  )}
                  {creator.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {creator.tags.map((t) => (
                        <span key={t} className="rounded-full bg-white/5 px-1.5 py-px text-[10px] text-text-muted">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => !added && importMutation.mutate(creator)}
                  disabled={added || importMutation.isPending}
                  className={cn(
                    "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    added
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-accent/20 text-accent hover:bg-accent/30"
                  )}
                >
                  {added ? "Queued" : creator.exists ? "Capture" : "Add"}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {discoverPending && !hasResults && (
        <div className="mt-6 flex justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      )}
    </div>
  )
}
