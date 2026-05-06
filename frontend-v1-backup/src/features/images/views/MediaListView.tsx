import { Suspense } from "react"
import { useWindowVirtualizer } from "@tanstack/react-virtual"
import type { Screenshot } from "@/lib/api"
import { MediaListItem } from "../MediaListItem"
import { InlineLoadingFallback } from "../mediaHelpers"

export interface MediaListViewProps {
  visibleShots: Screenshot[]
  scrollMargin: number
  favorites: Set<number>
  onOpenMedia: (shot: Screenshot) => void
  onToggleFavorite: (id: number) => void
  onRate: (id: number, rating: number) => void
  onContextMenu: (e: React.MouseEvent, shot: Screenshot) => void
  onPrefetchViewer: (shot: Screenshot) => void
}

export function MediaListView({
  visibleShots,
  scrollMargin,
  favorites,
  onOpenMedia,
  onToggleFavorite,
  onRate,
  onContextMenu,
  onPrefetchViewer,
}: MediaListViewProps) {
  const listVirtualizer = useWindowVirtualizer({
    count: visibleShots.length,
    estimateSize: () => 86,
    overscan: 12,
    scrollMargin,
  })

  function renderListItem(shot: Screenshot) {
    const prefetchViewer = () => onPrefetchViewer(shot)
    return (
      <Suspense fallback={<InlineLoadingFallback label="Loading item" />}>
        <MediaListItem
          shot={shot}
          onClick={() => onOpenMedia(shot)}
          onHover={prefetchViewer}
          favorite={favorites.has(shot.id)}
          onToggleFavorite={() => onToggleFavorite(shot.id)}
          onRate={(rating) => onRate(shot.id, rating)}
          onContextMenu={(e) => onContextMenu(e, shot)}
        />
      </Suspense>
    )
  }

  if (visibleShots.length <= 100) {
    return (
      <div className="px-2 py-2 space-y-0.5">
        {visibleShots.map((shot) => (
          <div key={shot.id}>{renderListItem(shot)}</div>
        ))}
      </div>
    )
  }

  return (
    <div
      className="px-2 py-2"
      style={{ height: `${listVirtualizer.getTotalSize()}px`, position: "relative" }}
    >
      {listVirtualizer.getVirtualItems().map((virtualRow) => {
        const shot = visibleShots[virtualRow.index]
        if (!shot) return null
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={listVirtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start - listVirtualizer.options.scrollMargin}px)`,
            }}
          >
            {renderListItem(shot)}
          </div>
        )
      })}
    </div>
  )
}
