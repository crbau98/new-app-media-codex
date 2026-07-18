import { cn } from '@/lib/utils'

interface SkeletonGridProps {
  count?: number
  className?: string
}

/** Sunken pulsing tiles (opacity pulse only — no shimmer). */
export default function SkeletonGrid({ count = 12, className }: SkeletonGridProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4', className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="skeleton-tile" />
      ))}
    </div>
  )
}
