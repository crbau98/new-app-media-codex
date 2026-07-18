import { memo, useState, useCallback } from 'react'
import { Play, RefreshCw } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { relativeTime } from '@/lib/discovery'
import MediaImage from '@/components/MediaImage'
import { cn } from '@/lib/utils'

interface MediaCardProps {
  item: MediaItem
  aspectRatio?: string
  className?: string
  onSelect?: (id: string) => void
}

/**
 * Archive media card: image, mono metadata row, title. Hover affordance is a
 * hairline + slight brightness — siblings dim via the parent `.media-grid`.
 */
function MediaCard({ item, aspectRatio = '2/3', className, onSelect }: MediaCardProps) {
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  const handleRetry = useCallback(() => {
    setError(false)
    setRetryKey((value) => value + 1)
  }, [])

  // Cards stay thumbnail-first for speed. Photos may fall back to the full-size
  // public media URL when a provider thumbnail is missing or temporarily 404s;
  // videos never use a stream URL as an <img> fallback.
  const imageSources = item.isVideo ? [item.thumbnail] : [item.thumbnail, item.mediaUrl]

  return (
    <button
      type="button"
      data-testid={item.isVideo ? 'video-tile' : 'media-tile'}
      className={cn('media-card group block w-full text-left tap-highlight-none', className)}
      onClick={() => (error ? handleRetry() : onSelect?.(item.id))}
      aria-label={error ? `Retry loading ${item.title}` : `${item.isVideo ? 'Play' : 'View'} ${item.title} by ${item.creator}`}
    >
      <div className="relative overflow-hidden rounded-md bg-sunken" style={{ aspectRatio }}>
        {!error ? (
          <MediaImage
            sources={imageSources}
            alt=""
            retryToken={retryKey}
            className="media-card-img absolute inset-0 h-full w-full object-cover transition-opacity duration-200"
            skeletonClassName="absolute inset-0"
            onExhausted={() => setError(true)}
          />
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ink-3">
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="font-mono text-[10px] uppercase tracking-[0.08em]">Retry</span>
          </span>
        )}

        {item.isNew && (
          <span className="absolute left-2 top-2 h-1.5 w-1.5 rounded-full bg-heat" aria-label="New" />
        )}
        {item.isVideo && item.duration && (
          <span className="absolute right-2 top-2 rounded-sm bg-canvas/85 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.04em] text-ink">
            {item.duration}
          </span>
        )}
        {item.isVideo && (
          <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100" aria-hidden="true">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-canvas/80">
              <Play size={16} strokeWidth={1.75} className="ml-0.5 text-ink" fill="currentColor" />
            </span>
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
        <span className="truncate">{item.source}</span>
        <span aria-hidden="true">·</span>
        <span className="shrink-0">{relativeTime(item.createdAt)}</span>
      </div>
      <h4 className="mt-0.5 line-clamp-2 text-[13px] font-medium leading-snug text-ink">
        {item.title}
      </h4>
    </button>
  )
}

export default memo(MediaCard)
