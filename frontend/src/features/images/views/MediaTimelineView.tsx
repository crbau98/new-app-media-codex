import { useMemo } from "react"
import { useWindowVirtualizer } from "@tanstack/react-virtual"
import { cn } from "@/lib/cn"
import type { Screenshot } from "@/lib/api"
import { MediaCard } from "../components/MediaCard"
import { getTimelineGroup, estimateGridSectionHeight } from "../mediaHelpers"

export interface MediaTimelineViewProps {
  visibleShots: Screenshot[]
  gridClass: string
  colCount: number
  scrollMargin: number
  gridDensity: string
  batchMode: boolean
  selectedIds: Set<number>
  favorites: Set<number>
  onOpenMedia: (shot: Screenshot) => void
  onToggleSelect: (id: number) => void
  onToggleFavorite: (id: number) => void
  onSingleDescribe: (id: number) => void
  onRate: (id: number, rating: number) => void
  onContextMenu: (e: React.MouseEvent, shot: Screenshot) => void
  onNavigateToPerformer: (performerId: number, username: string) => void
  onPrefetchViewer: (shot: Screenshot) => void
}

export function MediaTimelineView({
  visibleShots,
  gridClass,
  colCount,
  scrollMargin,
  gridDensity,
  batchMode,
  selectedIds,
  favorites,
  onOpenMedia,
  onToggleSelect,
  onToggleFavorite,
  onSingleDescribe,
  onRate,
  onContextMenu,
  onNavigateToPerformer,
  onPrefetchViewer,
}: MediaTimelineViewProps) {
  const timelineGroups = useMemo(() => {
    const m = new Map<string, Screenshot[]>()
    const order = ["Today", "Yesterday", "This Week", "This Month", "Older"]
    for (const label of order) m.set(label, [])
    for (const s of visibleShots) {
      const group = getTimelineGroup(s.captured_at)
      const arr = m.get(group)
      if (arr) arr.push(s)
    }
    for (const [key, val] of m) {
      if (val.length === 0) m.delete(key)
    }
    return m
  }, [visibleShots])

  const timelineSections = useMemo(
    () => [...timelineGroups.entries()].map(([label, shots]) => ({ label, shots })),
    [timelineGroups]
  )

  const sectionVirtualizer = useWindowVirtualizer({
    count: timelineSections.length,
    estimateSize: (index) =>
      estimateGridSectionHeight(timelineSections[index]?.shots.length ?? 1, colCount, gridDensity),
    overscan: 4,
    scrollMargin,
    scrollPaddingStart: 8,
  })

  function renderCard(shot: Screenshot, index = 0) {
    const prefetchViewer = () => onPrefetchViewer(shot)
    return (
      <MediaCard
        key={shot.id}
        shot={shot}
        index={index}
        profileTile={gridDensity === "normal"}
        onClick={() => onOpenMedia(shot)}
        onHover={prefetchViewer}
        batchMode={batchMode}
        selected={selectedIds.has(shot.id)}
        onSelect={() => onToggleSelect(shot.id)}
        favorite={favorites.has(shot.id)}
        onToggleFavorite={() => onToggleFavorite(shot.id)}
        onDescribe={() => onSingleDescribe(shot.id)}
        onRate={(rating) => onRate(shot.id, rating)}
        onContextMenu={(e) => onContextMenu(e, shot)}
        onNavigateToPerformer={onNavigateToPerformer}
      />
    )
  }

  function renderGrid(shots: Screenshot[]) {
    const items: React.ReactNode[] = []
    for (let i = 0; i < shots.length; i++) {
      items.push(renderCard(shots[i], i))
    }
    return items
  }

  return (
    <div
      className="py-2"
      style={{ height: `${sectionVirtualizer.getTotalSize()}px`, position: "relative" }}
    >
      {sectionVirtualizer.getVirtualItems().map((virtualSection) => {
        const section = timelineSections[virtualSection.index]
        if (!section) return null
        const { label: groupLabel, shots } = section
        return (
          <section
            key={groupLabel}
            data-index={virtualSection.index}
            ref={sectionVirtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualSection.start - sectionVirtualizer.options.scrollMargin}px)`,
            }}
          >
            <div className="flex items-center gap-3 px-4 py-2">
              <div className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {groupLabel}
              </h3>
              <span className="text-xs text-[var(--color-text-muted)]">{shots.length}</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
            <div className={cn("grid", gridClass)}>{renderGrid(shots)}</div>
          </section>
        )
      })}
    </div>
  )
}
