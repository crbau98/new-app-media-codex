import { cn } from '@/lib/utils'

interface SkeletonGridProps {
  count?: number
  className?: string
}

export default function SkeletonGrid({ count = 6, className }: SkeletonGridProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4',
        className
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="skeleton-grid-tile"
          style={{ animationDelay: `${i * 0.05}s` }}
        />
      ))}
    </div>
  )
}
