import { memo, useEffect, useRef, useState } from 'react'
import { Images, Play } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { formatMetric, relativeTime } from '@/lib/discovery'
import MediaImage from '@/components/MediaImage'
import { hueFor, readMediaMeta } from './mediaMeta'
import '@/styles/discovery.css'

interface MediaListProps {
  items: MediaItem[]
  onSelect: (id: string) => void
  pageSize?: number
  resetKey?: string
  loading?: boolean
  ariaLabel?: string
}

const Row = memo(function Row({ item, onSelect }: { item: MediaItem; onSelect: (id: string) => void }) {
  const meta = readMediaMeta(item)
  const hue = hueFor(item.id)
  return (
    <li className="d-list-row">
      <button
        type="button"
        data-testid={item.isVideo ? 'video-row' : 'media-row'}
        className="d-list-btn tap-highlight-none"
        onClick={() => onSelect(item.id)}
        aria-label={`Open ${item.title}`}
      >
        <span
          className="d-list-thumb"
          style={{ background: meta.dominantColor ?? `linear-gradient(155deg, hsl(${hue} 30% 22%), hsl(${(hue + 40) % 360} 34% 10%))` }}
        >
          <MediaImage
            sources={item.isVideo ? [item.thumbnail] : [item.thumbnail, item.mediaUrl]}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            skeletonClassName="absolute inset-0 !bg-transparent !animate-none opacity-0"
          />
          {item.isVideo ? (
            <span className="d-list-badge">
              <Play size={8} strokeWidth={0} fill="currentColor" /> {item.duration}
            </span>
          ) : meta.galleryCount > 1 ? (
            <span className="d-list-badge">
              <Images size={9} strokeWidth={2} /> {meta.galleryCount}
            </span>
          ) : null}
        </span>
        <span className="d-list-body">
          <span className="d-list-title">{item.title}</span>
          <span className="d-list-meta">
            @{item.creator} · {item.source} · {relativeTime(item.createdAt)}
            {item.views > 0 ? ` · ${formatMetric(item.views)} views` : ''}
          </span>
          {item.tags.length > 0 && (
            <span className="d-list-tags">
              {item.tags.slice(0, 3).map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </span>
          )}
        </span>
      </button>
    </li>
  )
})

/** Dense, scannable list layout with the same incremental rendering as the grids. */
function MediaListImpl({ items, onSelect, pageSize = 30, resetKey = '', loading = false, ariaLabel = 'Media' }: MediaListProps) {
  const [visible, setVisible] = useState(pageSize)
  const sentinel = useRef<HTMLDivElement>(null)
  const [lastKey, setLastKey] = useState(resetKey)
  if (lastKey !== resetKey) {
    setLastKey(resetKey)
    setVisible(pageSize)
  }
  const hasMore = visible < items.length

  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible((value) => value + pageSize)
      },
      { rootMargin: '700px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, pageSize, visible])

  if (loading) {
    return (
      <ul className="d-list" aria-hidden="true">
        {Array.from({ length: 8 }).map((_, index) => (
          <li key={index} className="d-list-row">
            <span className="d-list-btn">
              <span className="d-list-thumb d-skel" />
              <span className="d-list-body">
                <span className="d-skel d-skel-line" style={{ width: '60%' }} />
                <span className="d-skel d-skel-line" style={{ width: '38%', height: 10 }} />
              </span>
            </span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <ul className="d-list" aria-label={ariaLabel}>
        {items.slice(0, visible).map((item) => (
          <Row key={item.id} item={item} onSelect={onSelect} />
        ))}
      </ul>
      {hasMore && (
        <div ref={sentinel} className="d-more">
          <button type="button" className="btn-secondary" onClick={() => setVisible((value) => value + pageSize)}>
            Show more · {items.length - visible} remaining
          </button>
        </div>
      )}
    </>
  )
}

export default memo(MediaListImpl)
