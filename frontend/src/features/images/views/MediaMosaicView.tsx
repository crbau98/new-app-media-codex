import type { Screenshot } from "@/lib/api"
import { MosaicCard } from "../components/MediaCard"

export interface MediaMosaicViewProps {
  visibleMosaicShots: Screenshot[]
  hasMoreMosaicShots: boolean
  mosaicSentinelRef: (node: HTMLDivElement | null) => void
  favorites: Set<number>
  onOpenMedia: (shot: Screenshot) => void
  onToggleFavorite: (id: number) => void
  onContextMenu: (e: React.MouseEvent, shot: Screenshot) => void
}

export function MediaMosaicView({
  visibleMosaicShots,
  hasMoreMosaicShots,
  mosaicSentinelRef,
  favorites,
  onOpenMedia,
  onToggleFavorite,
  onContextMenu,
}: MediaMosaicViewProps) {
  return (
    <>
      <div
        className="py-2 px-1"
        style={{ columns: "var(--mosaic-cols, 4)", columnGap: "4px" }}
      >
        <style>{`
          @media (max-width: 640px) { :root { --mosaic-cols: 2; } }
          @media (min-width: 641px) and (max-width: 1024px) { :root { --mosaic-cols: 3; } }
          @media (min-width: 1025px) { :root { --mosaic-cols: 4; } }
          @media (min-width: 1400px) { :root { --mosaic-cols: 5; } }
        `}</style>
        {visibleMosaicShots.map((shot) => (
          <MosaicCard
            key={shot.id}
            shot={shot}
            onClick={() => onOpenMedia(shot)}
            favorite={favorites.has(shot.id)}
            onToggleFavorite={() => onToggleFavorite(shot.id)}
            onContextMenu={(e) => onContextMenu(e, shot)}
          />
        ))}
      </div>
      {hasMoreMosaicShots && (
        <>
          <div ref={mosaicSentinelRef} className="h-4" />
          <div className="flex justify-center py-3 text-xs text-[var(--color-text-muted)]">
            Loading more mosaic items...
          </div>
        </>
      )}
    </>
  )
}
