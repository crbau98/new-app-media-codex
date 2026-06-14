import { useMemo } from "react"
import { useWindowVirtualizer } from "@tanstack/react-virtual"
import { cn } from "@/lib/cn"
import type { Screenshot } from "@/lib/api"
import { MediaCard } from "../components/MediaCard"
import { GRID_ROW_SIZE_ESTIMATE, estimateGridSectionHeight } from "../mediaHelpers"

export interface MediaGridViewProps {
  visibleShots: Screenshot[]
  showGrouped: boolean
  gridDensity: string
  gridClass: string
  colCount: number
  scrollMargin: number
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
  onSetTerm: (term: string) => void
}

export function MediaGridView({
  visibleShots,
  showGrouped,
  gridDensity,
  gridClass,
  colCount,
  scrollMargin,
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
  onSetTerm,
}: MediaGridViewProps) {
  const grouped = useMemo<Map<string, Screenshot[]>>(() => {
    if (!showGrouped) return new Map()
    const m = new Map<string, Screenshot[]>()
    for (const s of visibleShots) {
      const arr = m.get(s.term)
      if (arr) arr.push(s)
      else m.set(s.term, [s])
    }
    return m
  }, [showGrouped, visibleShots])

  const groupedSections = useMemo(
    () => [...grouped.entries()].map(([label, shots]) => ({ label, shots })),
    [grouped]
  )

  const flatGridRows = useMemo(() => {
    if (showGrouped) return []
    const rows: Screenshot[][] = []
    for (let i = 0; i < visibleShots.length; i += colCount) {
      rows.push(visibleShots.slice(i, i + colCount))
    }
    return rows
  }, [visibleShots, showGrouped, colCount])

  const sectionVirtualizer = useWindowVirtualizer({
    count: groupedSections.length,
    estimateSize: (index) =>
      estimateGridSectionHeight(groupedSections[index]?.shots.length ?? 1, colCount, gridDensity),
    overscan: 4,
    scrollMargin,
    scrollPaddingStart: 8,
  })

  const flatGridVirtualizer = useWindowVirtualizer({
    count: flatGridRows.length,
    estimateSize: () => GRID_ROW_SIZE_ESTIMATE[gridDensity],
    overscan: 6,
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

  if (showGrouped) {
    if (groupedSections.length <= 20) {
      return (
        <div className="py-2">
          {groupedSections.map(({ label: groupTerm, shots }) => (
            <section key={groupTerm}>
              <button
                onClick={() => onSetTerm(groupTerm)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
              >
                {groupTerm}
                <span className="text-xs font-normal text-[var(--color-text-muted)]">{shots.length}</span>
              </button>
              <div className={cn("grid", gridClass)}>{renderGrid(shots)}</div>
            </section>
          ))}
        </div>
      )
    }

    return (
      <div
        className="py-2"
        style={{ height: `${sectionVirtualizer.getTotalSize()}px`, position: "relative" }}
      >
        {sectionVirtualizer.getVirtualItems().map((virtualSection) => {
          const section = groupedSections[virtualSection.index]
          if (!section) return null
          const { label: groupTerm, shots } = section
          return (
            <section
              key={groupTerm}
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
              <button
                onClick={() => onSetTerm(groupTerm)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
              >
                {groupTerm}
                <span className="text-xs font-normal text-[var(--color-text-muted)]">{shots.length}</span>
              </button>
              <div className={cn("grid", gridClass)}>{renderGrid(shots)}</div>
            </section>
          )
        })}
      </div>
    )
  }

  // Flat grid
  if (flatGridRows.length <= 30) {
    return (
      <div className="py-2 space-y-1">
        {flatGridRows.map((rowShots, i) => (
          <div key={i} className={cn("grid", gridClass)}>{renderGrid(rowShots)}</div>
        ))}
      </div>
    )
  }

  return (
    <div
      style={{ height: `${flatGridVirtualizer.getTotalSize()}px`, position: "relative" }}
      className="py-2"
    >
      {flatGridVirtualizer.getVirtualItems().map((virtualRow) => {
        const rowShots = flatGridRows[virtualRow.index]
        if (!rowShots) return null
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={flatGridVirtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start - flatGridVirtualizer.options.scrollMargin}px)`,
            }}
            className={cn("grid", gridClass)}
          >
            {renderGrid(rowShots)}
          </div>
        )
      })}
    </div>
  )
}
