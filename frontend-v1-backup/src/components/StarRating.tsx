import { useState, useCallback } from "react"
import { cn } from "@/lib/cn"

interface StarRatingProps {
  value: number
  onChange: (rating: number) => void
  compact?: boolean
  className?: string
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

export function StarRating({ value, onChange, compact, className }: StarRatingProps) {
  const [hoverValue, setHoverValue] = useState(0)

  const handleClick = useCallback(
    (star: number) => {
      // Click active rating to clear
      onChange(star === value ? 0 : star)
    },
    [value, onChange],
  )

  const displayValue = hoverValue || value

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5",
        className,
      )}
      onMouseLeave={() => setHoverValue(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleClick(star)
          }}
          onMouseEnter={() => setHoverValue(star)}
          className={cn(
            "transition-[color,transform,filter] duration-150 ease-out",
            compact ? "h-3.5 w-3.5" : "h-5 w-5",
            star <= displayValue
              ? "text-amber-400 scale-110"
              : "text-white/25 hover:text-white/40",
            star <= displayValue && "drop-shadow-[0_0_3px_rgba(251,191,36,0.4)]",
          )}
          title={star === value ? "Clear rating" : `Rate ${star} star${star > 1 ? "s" : ""}`}
        >
          <StarIcon filled={star <= displayValue} />
        </button>
      ))}
    </div>
  )
}

/** Read-only display of stars (no interactivity) */
export function StarDisplay({ value, compact }: { value: number; compact?: boolean }) {
  if (!value || value <= 0) return null
  return (
    <div className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          className={cn(
            "inline-block transition-colors",
            compact ? "h-3 w-3" : "h-4 w-4",
            star <= value ? "text-amber-400" : "text-white/15",
          )}
        >
          <StarIcon filled={star <= value} />
        </span>
      ))}
    </div>
  )
}
