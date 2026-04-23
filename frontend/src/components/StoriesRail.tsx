import { memo } from "react"
import type { Performer } from "@/lib/api"
import { getPerformerAvatarSrc, getPerformerDisplayName } from "@/lib/performer"
import { cn } from "@/lib/cn"

interface StoriesRailProps {
  performers: Performer[]
  onNavigate: (performerId: number, username: string) => void
  className?: string
}

export const StoriesRail = memo(function StoriesRail({
  performers,
  onNavigate,
  className,
}: StoriesRailProps) {
  if (performers.length === 0) return null

  return (
    <div className={cn("hide-scrollbar overflow-x-auto", className)}>
      <div className="flex items-start gap-4 px-1 py-2">
        {performers.map((performer) => {
          const avatarSrc = getPerformerAvatarSrc(performer)
          const name = getPerformerDisplayName(performer)
          return (
            <button
              key={performer.id}
              onClick={() => onNavigate(performer.id, performer.username)}
              className="group flex flex-col items-center gap-1.5 min-w-[68px]"
            >
              <div className="relative h-14 w-14 rounded-full p-[2px] bg-gradient-to-tr from-accent via-purple-500 to-pink-500">
                <div className="h-full w-full rounded-full overflow-hidden bg-bg-surface ring-2 ring-bg-base">
                  {avatarSrc ? (
                    <img
                      src={avatarSrc}
                      alt={name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-text-muted bg-white/5">
                      {name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              </div>
              <span className="max-w-[68px] truncate text-[11px] font-medium text-text-secondary group-hover:text-text-primary transition-colors">
                @{performer.username}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
})
