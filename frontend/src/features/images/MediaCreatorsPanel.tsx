import { memo, useMemo } from "react"
import { cn } from "@/lib/cn"
import type { Performer } from "@/lib/api"
import { getPerformerAvatarSrc, getPerformerDisplayName } from "@/lib/performer"

type CreatorCounts = {
  total: number
  favorites: number
  linked: number
}

type CreatorSort = "shots" | "name"

type MediaCreatorsPanelProps = {
  creatorsLoading: boolean
  creators: Performer[]
  filteredCreators: Performer[]
  creatorCounts: CreatorCounts
  creatorSearch: string
  onCreatorSearchChange: (value: string) => void
  onClearCreatorSearch: () => void
  creatorPlatformFilter: string
  onCreatorPlatformFilterChange: (value: string) => void
  creatorFavoritesOnly: boolean
  onToggleCreatorFavoritesOnly: () => void
  onClearCreatorFilters: () => void
  hasCreatorFilters: boolean
  onBackfillPerformers: () => void
  onCaptureAllCreators: () => void
  capturingAll: boolean
  onGoToPerformers: () => void
  creatorSort: CreatorSort
  onCreatorSortChange: (value: CreatorSort) => void
  onSelectCreator: (creator: Performer) => void
  onToggleFavoriteCreator: (creator: Performer) => void
  onCaptureCreator: (creator: Performer) => void
  onHoverCreator: (creator: Performer) => void
}

function parseTags(tags: string | null): string[] {
  if (!tags) return []
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : []
  } catch {
    return tags.split(",").map((tag) => tag.trim()).filter(Boolean)
  }
}

function CreatorMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.22em] text-white/40">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  )
}

const CreatorCard = memo(function CreatorCard({
  creator,
  onSelect,
  onToggleFavorite,
  onCapture,
  onHover,
}: {
  creator: Performer
  onSelect: (creator: Performer) => void
  onToggleFavorite: (creator: Performer) => void
  onCapture: (creator: Performer) => void
  onHover: (creator: Performer) => void
}) {
  const avatarSrc = getPerformerAvatarSrc(creator)
  const displayName = getPerformerDisplayName(creator)
  const tags = parseTags(creator.tags).slice(0, 3)
  const mediaCount = (creator.screenshots_count ?? creator.media_count ?? creator.media_total ?? 0).toLocaleString()
  const isFavorite = Boolean(creator.is_favorite)

  return (
    <article
      className="group overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03] transition-all hover:border-white/15 hover:bg-white/[0.06]"
      onMouseEnter={() => onHover(creator)}
      onFocus={() => onHover(creator)}
    >
      <button
        type="button"
        onClick={() => onSelect(creator)}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl ring-1 ring-white/10">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={displayName}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-cyan-500 to-fuchsia-600 text-lg font-semibold text-white">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="absolute bottom-1 right-1 rounded-full border border-black/40 bg-black/70 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/80">
            {creator.platform}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-white">{displayName}</h3>
            {creator.is_verified === 1 && (
              <span className="rounded-full bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-300">verified</span>
            )}
          </div>
          <p className="truncate text-[11px] text-white/45">@{creator.username}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/65">
                {tag}
              </span>
            ))}
            {tags.length === 0 && (
              <span className="text-[10px] text-white/35">No tags yet</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/60">{mediaCount} shots</span>
          {isFavorite && <span className="text-[10px] text-rose-300">watchlisted</span>}
        </div>
      </button>

      <div className="flex items-center justify-between border-t border-white/5 px-4 py-3">
        <button
          type="button"
          onClick={() => onToggleFavorite(creator)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-[11px] transition-colors",
            isFavorite
              ? "border-rose-500/25 bg-rose-500/10 text-rose-300"
              : "border-white/10 bg-white/5 text-white/60 hover:text-white"
          )}
        >
          {isFavorite ? "Remove favorite" : "Favorite"}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onCapture(creator)}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-white/65 transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-200"
          >
            Capture
          </button>
          <button
            type="button"
            onClick={() => onSelect(creator)}
            className="rounded-full bg-cyan-500/15 px-3 py-1.5 text-[11px] font-medium text-cyan-200 transition-colors hover:bg-cyan-500/25"
          >
            Open
          </button>
        </div>
      </div>
    </article>
  )
}, (prev, next) =>
  prev.creator.id === next.creator.id &&
  prev.creator.username === next.creator.username &&
  prev.creator.display_name === next.creator.display_name &&
  prev.creator.platform === next.creator.platform &&
  prev.creator.is_favorite === next.creator.is_favorite &&
  prev.creator.avatar_url === next.creator.avatar_url &&
  prev.creator.media_count === next.creator.media_count &&
  prev.creator.screenshots_count === next.creator.screenshots_count &&
  prev.creator.tags === next.creator.tags
)

export function MediaCreatorsPanel({
  creatorsLoading,
  creators,
  filteredCreators,
  creatorCounts,
  creatorSearch,
  onCreatorSearchChange,
  onClearCreatorSearch,
  creatorPlatformFilter,
  onCreatorPlatformFilterChange,
  creatorFavoritesOnly,
  onToggleCreatorFavoritesOnly,
  onClearCreatorFilters,
  hasCreatorFilters,
  onBackfillPerformers,
  onCaptureAllCreators,
  capturingAll,
  onGoToPerformers,
  creatorSort,
  onCreatorSortChange,
  onSelectCreator,
  onToggleFavoriteCreator,
  onCaptureCreator,
  onHoverCreator,
}: MediaCreatorsPanelProps) {
  const platformOptions = useMemo(() => {
    return ["all", ...Array.from(new Set(creators.map((creator) => creator.platform))).sort()]
  }, [creators])

  return (
    <section className="space-y-4 rounded-[28px] border border-white/8 bg-gradient-to-br from-white/[0.05] via-white/[0.03] to-transparent p-4 shadow-2xl shadow-black/10 sm:p-5">
      <div className="grid gap-3 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/40">Creators</p>
              <div>
                <h2 className="text-2xl font-semibold text-white">Browse the people behind the feed</h2>
                <p className="mt-1 max-w-2xl text-sm text-white/55">
                  Remote-first avatars, fast filters, and creator actions stay responsive even when the library grows.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onBackfillPerformers}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/65 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
              >
                Backfill links
              </button>
              <button
                type="button"
                onClick={onCaptureAllCreators}
                disabled={capturingAll}
                className="rounded-full bg-cyan-500 px-3 py-2 text-xs font-medium text-black transition-colors hover:bg-cyan-400 disabled:opacity-50"
              >
                {capturingAll ? "Capturing..." : "Capture all"}
              </button>
              <button
                type="button"
                onClick={onGoToPerformers}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/65 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
              >
                Open full creators page
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <CreatorMetric label="Creators" value={creatorCounts.total.toLocaleString()} />
            <CreatorMetric label="Watchlisted" value={creatorCounts.favorites.toLocaleString()} />
            <CreatorMetric label="With media" value={creatorCounts.linked.toLocaleString()} />
          </div>
        </div>

        <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
          <div className="grid gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-[0.24em] text-white/40">Search</span>
              <div className="relative">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  value={creatorSearch}
                  onChange={(e) => onCreatorSearchChange(e.target.value)}
                  placeholder="Search creators..."
                  className="w-full rounded-2xl border border-white/10 bg-black/30 py-3 pl-9 pr-10 text-sm text-white placeholder:text-white/30 focus:border-cyan-500/40 focus:outline-none"
                />
                {creatorSearch.trim() && (
                  <button
                    type="button"
                    onClick={onClearCreatorSearch}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-[10px] text-white/45 hover:text-white"
                  >
                    Clear
                  </button>
                )}
              </div>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-[0.24em] text-white/40">Platform</span>
                <select
                  value={creatorPlatformFilter}
                  onChange={(e) => onCreatorPlatformFilterChange(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white focus:border-cyan-500/40 focus:outline-none"
                >
                  {platformOptions.map((platform) => (
                    <option key={platform} value={platform}>
                      {platform === "all" ? "All platforms" : platform}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-[0.24em] text-white/40">Sort</span>
                <select
                  value={creatorSort}
                  onChange={(e) => onCreatorSortChange(e.target.value as CreatorSort)}
                  className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white focus:border-cyan-500/40 focus:outline-none"
                >
                  <option value="shots">Most content</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onToggleCreatorFavoritesOnly}
                className={cn(
                  "rounded-full border px-3 py-2 text-xs transition-colors",
                  creatorFavoritesOnly
                    ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                    : "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:bg-white/10 hover:text-white"
                )}
              >
                Favorites only
              </button>
              {hasCreatorFilters && (
                <button
                  type="button"
                  onClick={onClearCreatorFilters}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
                >
                  Clear filters
                </button>
              )}
              <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/55">
                {filteredCreators.length.toLocaleString()} visible
              </span>
            </div>
          </div>
        </div>
      </div>

      {creatorsLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-44 animate-pulse rounded-2xl border border-white/8 bg-white/[0.03]" />
          ))}
        </div>
      ) : filteredCreators.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-white/10 bg-black/20 px-6 py-10 text-center">
          <p className="text-lg font-semibold text-white">No creators match those filters</p>
          <p className="mt-1 text-sm text-white/45">
            Try clearing the search, switching platforms, or broadening the sort to bring more creators back.
          </p>
          <button
            type="button"
            onClick={onClearCreatorFilters}
            className="mt-4 rounded-full bg-cyan-500 px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-cyan-400"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredCreators.map((creator) => (
            <CreatorCard
              key={creator.id}
              creator={creator}
              onSelect={onSelectCreator}
              onToggleFavorite={onToggleFavoriteCreator}
              onCapture={onCaptureCreator}
              onHover={onHoverCreator}
            />
          ))}
        </div>
      )}
    </section>
  )
}
