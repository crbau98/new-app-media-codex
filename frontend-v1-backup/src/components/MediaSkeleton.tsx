import { cn } from "@/lib/cn"

interface MediaSkeletonProps {
  count?: number
  density?: "compact" | "normal" | "spacious"
  className?: string
}

const densityGridClass: Record<string, string> = {
  compact: "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-px",
  normal: "grid-cols-3 gap-px sm:gap-0.5",
  spacious: "grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-2",
}

export function MediaSkeleton({ count = 12, density = "normal", className }: MediaSkeletonProps) {
  return (
    <div className={cn("grid", densityGridClass[density], className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="aspect-square rounded-2xl skeleton-grid-tile shimmer" />
      ))}
    </div>
  )
}
