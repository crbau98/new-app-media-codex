import { cn } from '@/lib/cn'

type SkeletonVariant = 'text' | 'card' | 'image' | 'circle'

interface SkeletonProps {
  variant?: SkeletonVariant
  width?: string | number
  height?: string | number
  className?: string
  /** Number of lines for text variant */
  lines?: number
}

const shimmerClass =
  'shimmer'

export function Skeleton({
  variant = 'text',
  width,
  height,
  className,
  lines = 1,
}: SkeletonProps) {
  const widthStyle = width !== undefined ? (typeof width === 'number' ? `${width}px` : width) : undefined
  const heightStyle = height !== undefined ? (typeof height === 'number' ? `${height}px` : height) : undefined

  if (variant === 'text') {
    if (lines > 1) {
      return (
        <div className={cn('flex flex-col gap-1.5', className)} aria-hidden="true">
          {Array.from({ length: lines }).map((_, i) => (
            <div
              key={i}
              className={cn('h-[1em] rounded-md skeleton-line', shimmerClass)}
              style={{
                width: i === lines - 1 && lines > 1 ? '70%' : widthStyle ?? '100%',
              }}
            />
          ))}
        </div>
      )
    }
    return (
      <div
        className={cn('h-[1em] rounded-md skeleton-line', shimmerClass, className)}
        style={{ width: widthStyle ?? '100%', height: heightStyle }}
        aria-hidden="true"
      />
    )
  }

  if (variant === 'card') {
    return (
      <div
        className={cn('w-full rounded-xl skeleton-surface', shimmerClass, className)}
        style={{ height: heightStyle ?? '120px', width: widthStyle }}
        aria-hidden="true"
      />
    )
  }

  if (variant === 'image') {
    return (
      <div
        className={cn('rounded-xl skeleton-surface', shimmerClass, className)}
        style={{
          width: widthStyle ?? '100%',
          height: heightStyle ?? '200px',
        }}
        aria-hidden="true"
      />
    )
  }

  // circle
  const size = widthStyle ?? heightStyle ?? '40px'
  return (
    <div
      className={cn('rounded-full skeleton-surface', shimmerClass, className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
}

/* ── Preset skeleton shapes ──────────────────────────────────────────────── */

/** Multiple text lines with varying widths */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn('h-3 rounded skeleton-line', shimmerClass)}
          style={{ width: i === lines - 1 ? '60%' : i % 2 === 0 ? '100%' : '85%' }}
        />
      ))}
    </div>
  )
}

/** Card-shaped skeleton matching SourceCard dimensions */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-border bg-bg-surface overflow-hidden skeleton-surface', className)} aria-hidden="true">
      <div className={cn('h-[2px] w-full', shimmerClass)} />
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className={cn('h-3 w-16 rounded skeleton-line', shimmerClass)} />
          <div className={cn('h-3 w-12 rounded skeleton-line', shimmerClass)} />
        </div>
        <div className="space-y-1.5">
          <div className={cn('h-4 w-full rounded skeleton-line', shimmerClass)} />
          <div className={cn('h-4 w-3/4 rounded skeleton-line', shimmerClass)} />
        </div>
        <div className="space-y-1">
          <div className={cn('h-3 w-full rounded skeleton-line', shimmerClass)} />
          <div className={cn('h-3 w-5/6 rounded skeleton-line', shimmerClass)} />
        </div>
        <div className="flex items-center justify-between mt-1">
          <div className={cn('h-3 w-24 rounded skeleton-line', shimmerClass)} />
          <div className={cn('h-5 w-16 rounded skeleton-line', shimmerClass)} />
        </div>
      </div>
    </div>
  )
}

/** Grid of square skeletons for the media / image gallery */
export function SkeletonGrid({ count = 12, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1', className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn('aspect-square skeleton-grid-tile', shimmerClass)} />
      ))}
    </div>
  )
}

/** Rectangle matching chart dimensions */
export function SkeletonChart({ className }: { className?: string }) {
  return (
    <div className={cn('w-full rounded-xl skeleton-surface', shimmerClass, className)} style={{ height: 300 }} aria-hidden="true" />
  )
}

/** Row of stat pill skeletons */
export function SkeletonStatBar({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 sm:grid-cols-5 gap-3', className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border bg-bg-surface p-4 space-y-2 skeleton-surface">
          <div className={cn('h-3 w-1/2 rounded skeleton-line', shimmerClass)} />
          <div className={cn('h-8 w-16 rounded skeleton-line', shimmerClass)} />
        </div>
      ))}
    </div>
  )
}
