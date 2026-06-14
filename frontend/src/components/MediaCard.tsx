import { useState, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { MediaItem } from '@/lib/mockData'
import { Play, RefreshCw } from 'lucide-react'
import { motion } from 'framer-motion'

interface MediaCardProps {
  item: MediaItem
  aspectRatio?: string
  className?: string
  selected?: boolean
  onSelect?: (id: string) => void
}

export default function MediaCard({
  item,
  aspectRatio = '4/5',
  className,
  selected,
  onSelect,
}: MediaCardProps) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [hovered, setHovered] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  const handleLoad = useCallback(() => setLoaded(true), [])
  const handleError = useCallback(() => setError(true), [])
  const handleRetry = useCallback(() => {
    setError(false)
    setLoaded(false)
    if (imgRef.current) {
      imgRef.current.src = item.thumbnail + '?retry=' + Date.now()
    }
  }, [item.thumbnail])

  const isNew = item.isNew
  const isVideo = item.isVideo

  return (
    <motion.div
      layout
      className={cn(
        'group relative rounded-[var(--radius-md)] overflow-hidden cursor-pointer',
        'border border-[var(--border-subtle)] shadow-sm',
        'card-lift tile-zoom',
        selected && 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-base)]',
        className
      )}
      style={{ aspectRatio }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect?.(item.id)}
      whileTap={{ scale: 0.98 }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
    >
      {/* Image */}
      {!error ? (
        <>
          <img
            ref={imgRef}
            src={item.thumbnail}
            alt={item.title}
            className={cn(
              'absolute inset-0 w-full h-full object-cover transition-opacity duration-500',
              loaded ? 'opacity-100' : 'opacity-0'
            )}
            onLoad={handleLoad}
            onError={handleError}
            loading="lazy"
          />
          {/* Blur-up placeholder */}
          {!loaded && (
            <div
              className="absolute inset-0 bg-[var(--bg-elevated)]"
              style={{
                backgroundImage: `url(${item.thumbnail})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'blur(20px)',
                transform: 'scale(1.1)',
              }}
            />
          )}
        </>
      ) : (
        /* Error fallback */
        <div className="absolute inset-0 bg-[var(--bg-elevated)] flex flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]">
          <RefreshCw size={20} />
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleRetry()
            }}
            className="text-xs hover:text-[var(--text-secondary)] transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* NEW dot */}
      {isNew && (
        <span className="absolute top-2 left-2 w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-live-pulse" />
      )}

      {/* Duration badge */}
      {isVideo && item.duration && (
        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-sm bg-[var(--bg-overlay)] text-[var(--text-primary)] text-[11px] font-mono">
          {item.duration}
        </div>
      )}

      {/* Trending dot */}
      {item.isTrending && (
        <div className="absolute top-2 right-2 translate-x-0" style={{ right: isVideo ? '58px' : '8px' }}>
          <span className="live-dot" title="Trending now" />
        </div>
      )}

      {/* Bottom gradient overlay + info */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 p-3 flex flex-col gap-1',
          'bg-gradient-to-t from-[rgba(3,3,5,0.7)] via-[rgba(3,3,5,0.35)] to-transparent',
          'transition-opacity duration-300',
          hovered ? 'opacity-100' : 'opacity-0 md:opacity-0'
        )}
      >
        <h4 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2 leading-snug">
          {item.title}
        </h4>
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
          <span>{item.creator}</span>
          <span>•</span>
          <span>{item.source}</span>
        </div>
      </div>

      {/* Source badge (bottom-left, always visible but subtle) */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1 text-[10px] text-[var(--text-tertiary)] bg-[var(--bg-overlay)] px-1.5 py-0.5 rounded-sm opacity-70 group-hover:opacity-100 transition-opacity">
        {item.source}
      </div>

      {/* Play overlay */}
      {isVideo && (
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center transition-all duration-300',
            hovered ? 'opacity-100' : 'opacity-0'
          )}
        >
          <div className="w-12 h-12 rounded-full bg-[var(--bg-overlay)] flex items-center justify-center backdrop-blur-sm">
            <Play size={20} className="text-white ml-0.5" fill="white" />
          </div>
        </div>
      )}

      {/* Selected checkmark */}
      {selected && (
        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[var(--accent)] flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6L5 8.5L9.5 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </motion.div>
  )
}
