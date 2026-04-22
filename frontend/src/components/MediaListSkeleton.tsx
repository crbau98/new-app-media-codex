import { cn } from "@/lib/cn"

interface MediaListSkeletonProps {
  count?: number
  className?: string
}

export function MediaListSkeleton({ count = 8, className }: MediaListSkeletonProps) {
  return (
    <div className={cn("space-y-0.5 px-2 py-2", className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2">
          <div className="h-12 w-12 flex-shrink-0 rounded-lg skeleton-surface shimmer" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded skeleton-line shimmer" />
            <div className="h-3 w-2/3 rounded skeleton-line shimmer" />
          </div>
          <div className="h-3 w-16 rounded skeleton-line shimmer" />
        </div>
      ))}
    </div>
  )
}
