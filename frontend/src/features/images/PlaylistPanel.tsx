import { useState, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, type Playlist, type SmartRules } from "@/lib/api"
import { cn } from "@/lib/cn"
import { Spinner } from "@/components/Spinner"

// ── PlaylistDropdown ─────────────────────────────────────────────────────────

export function PlaylistDropdown({
  open,
  onClose,
  onSelectPlaylist,
  onCreateNew,
}: {
  open: boolean
  onClose: () => void
  onSelectPlaylist: (id: number) => void
  onCreateNew: () => void
}) {
  const { data: playlists, isLoading } = useQuery({
    queryKey: ["playlists"],
    queryFn: () => api.playlists(),
    enabled: open,
  })

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-white/10 bg-[#0d1424] shadow-2xl">
        <div className="border-b border-white/10 px-3 py-2">
          <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
            Playlists
          </p>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-4"><Spinner /></div>
          ) : playlists && playlists.length > 0 ? (
            playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => { onSelectPlaylist(p.id); onClose() }}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
              >
                <span className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm",
                  p.is_smart ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"
                )}>
                  {p.is_smart ? "\u26A1" : "\u25B6"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[var(--color-text-primary)]">{p.name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {p.item_count} items{p.is_smart ? " \u00B7 Smart" : ""}
                  </p>
                </div>
              </button>
            ))
          ) : (
            <p className="px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">
              No playlists yet
            </p>
          )}
        </div>
        <div className="border-t border-white/10">
          <button
            onClick={() => { onCreateNew(); onClose() }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-[var(--color-accent)] transition-colors hover:bg-white/5"
          >
            <span className="text-lg">+</span>
            New Playlist
          </button>
        </div>
      </div>
    </>
  )
}

// ── AddToPlaylistDropdown (for batch bar) ────────────────────────────────────

export function AddToPlaylistDropdown({
  open,
  onClose,
  screenshotIds,
  onDone,
  onCreateNew,
}: {
  open: boolean
  onClose: () => void
  screenshotIds: number[]
  onDone: () => void
  onCreateNew: () => void
}) {
  const queryClient = useQueryClient()
  const { data: playlists, isLoading } = useQuery({
    queryKey: ["playlists"],
    queryFn: () => api.playlists(),
    enabled: open,
  })

  const addMutation = useMutation({
    mutationFn: (playlistId: number) => api.addToPlaylist(playlistId, screenshotIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] })
      onDone()
      onClose()
    },
  })

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div className="absolute bottom-full left-0 z-50 mb-1 w-60 rounded-xl border border-white/10 bg-[#0d1424] shadow-2xl">
        <div className="border-b border-white/10 px-3 py-2">
          <p className="text-xs font-semibold text-[var(--color-text-secondary)]">
            Add {screenshotIds.length} to playlist
          </p>
        </div>
        <div className="max-h-48 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-3"><Spinner /></div>
          ) : playlists && playlists.length > 0 ? (
            playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => addMutation.mutate(p.id)}
                disabled={addMutation.isPending}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-text-primary)] transition-colors hover:bg-white/5 disabled:opacity-50"
              >
                <span className="text-xs">{p.is_smart ? "\u26A1" : "\u25B6"}</span>
                <span className="truncate">{p.name}</span>
                <span className="ml-auto text-xs text-[var(--color-text-muted)]">{p.item_count}</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-3 text-center text-xs text-[var(--color-text-muted)]">No playlists</p>
          )}
        </div>
        <div className="border-t border-white/10">
          <button
            onClick={() => { onCreateNew(); onClose() }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--color-accent)] hover:bg-white/5"
          >
            <span>+</span> New Playlist
          </button>
        </div>
      </div>
    </>
  )
}

// ── CreatePlaylistModal ──────────────────────────────────────────────────────

export function CreatePlaylistModal({
  open,
  onClose,
  initialScreenshotIds,
}: {
  open: boolean
  onClose: () => void
  initialScreenshotIds?: number[]
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [isSmart, setIsSmart] = useState(false)
  const [rules, setRules] = useState<SmartRules>({})

  const createMutation = useMutation({
    mutationFn: async () => {
      const playlist = await api.createPlaylist({
        name,
        description: description || undefined,
        is_smart: isSmart,
        smart_rules: isSmart ? rules : undefined,
      })
      if (initialScreenshotIds && initialScreenshotIds.length > 0) {
        await api.addToPlaylist(playlist.id, initialScreenshotIds)
      }
      if (isSmart) {
        await api.populatePlaylist(playlist.id)
      }
      return playlist
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] })
      setName("")
      setDescription("")
      setIsSmart(false)
      setRules({})
      onClose()
    },
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1424] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-[var(--color-text-primary)]">
          New Playlist
        </h2>

        <div className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Playlist name"
            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
            autoFocus
          />

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] resize-none"
          />

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isSmart}
              onChange={(e) => setIsSmart(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-black/30 accent-amber-500"
            />
            <span className="text-sm text-[var(--color-text-secondary)]">
              Smart playlist (auto-populates by rules)
            </span>
          </label>

          {isSmart && (
            <SmartRulesBuilder rules={rules} onChange={setRules} />
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            Cancel
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || createMutation.isPending}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── SmartRulesBuilder ────────────────────────────────────────────────────────

function SmartRulesBuilder({
  rules,
  onChange,
}: {
  rules: SmartRules
  onChange: (r: SmartRules) => void
}) {
  const update = useCallback(
    (patch: Partial<SmartRules>) => onChange({ ...rules, ...patch }),
    [rules, onChange],
  )

  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-black/10 p-3">
      <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Smart Rules</p>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-[var(--color-text-muted)]">Source</label>
          <select
            value={rules.source ?? ""}
            onChange={(e) => update({ source: e.target.value || undefined })}
            className="w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
          >
            <option value="">Any</option>
            <option value="ddg">DDG</option>
            <option value="redgifs">Redgifs</option>
            <option value="x">X</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-[var(--color-text-muted)]">Media Type</label>
          <select
            value={rules.media_type ?? ""}
            onChange={(e) => update({ media_type: (e.target.value as SmartRules["media_type"]) || undefined })}
            className="w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
          >
            <option value="">Any</option>
            <option value="video">Video</option>
            <option value="image">Image</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-[var(--color-text-muted)]">Term (partial match)</label>
        <input
          type="text"
          value={rules.term ?? ""}
          onChange={(e) => update({ term: e.target.value || undefined })}
          placeholder="e.g. muscle"
          className="w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
        />
      </div>

      <div>
        <label className="text-xs text-[var(--color-text-muted)]">Captured after</label>
        <input
          type="date"
          value={rules.min_date ?? ""}
          onChange={(e) => update({ min_date: e.target.value || undefined })}
          className="w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
        />
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={rules.has_ai_summary ?? false}
            onChange={(e) => update({ has_ai_summary: e.target.checked || undefined })}
            className="h-3.5 w-3.5 rounded border-white/20 bg-black/30 accent-amber-500"
          />
          <span className="text-xs text-[var(--color-text-secondary)]">Has AI description</span>
        </label>

        <div className="flex items-center gap-1.5">
          <label className="text-xs text-[var(--color-text-muted)]">Max items</label>
          <input
            type="number"
            value={rules.limit ?? 50}
            min={1}
            max={500}
            onChange={(e) => update({ limit: parseInt(e.target.value) || 50 })}
            className="w-16 rounded border border-white/10 bg-black/20 px-2 py-1 text-xs text-[var(--color-text-primary)]"
          />
        </div>
      </div>
    </div>
  )
}

// ── PlaylistHeader (shown when viewing a playlist) ───────────────────────────

export function PlaylistHeader({
  playlist,
  onBack,
  onPopulate,
  onDelete,
}: {
  playlist: Playlist
  onBack: () => void
  onPopulate?: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
      <button
        onClick={onBack}
        className="rounded-lg px-2 py-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        &larr; Back
      </button>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
          {playlist.is_smart && (
            <span className="mr-1 text-amber-400" title="Smart playlist">{"\u26A1"}</span>
          )}
          {playlist.name}
        </h2>
        {playlist.description && (
          <p className="truncate text-xs text-[var(--color-text-muted)]">{playlist.description}</p>
        )}
      </div>
      <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-[var(--color-text-secondary)]">
        {playlist.item_count} items
      </span>
      {playlist.is_smart && onPopulate && (
        <button
          onClick={onPopulate}
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20 transition-colors"
        >
          Refresh
        </button>
      )}
      <button
        onClick={onDelete}
        className="rounded-lg px-2 py-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
      >
        Delete
      </button>
    </div>
  )
}
