import { memo, useCallback, useState, useRef } from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/cn"
import { api } from "@/lib/api"
import { useAppStore } from "@/store"

interface FollowButtonProps {
  performerId: number
  initialFollowing?: boolean
  initialCount?: number
  size?: "sm" | "md" | "lg"
  className?: string
}

export const FollowButton = memo(function FollowButton({
  performerId,
  initialFollowing = false,
  initialCount = 0,
  size = "md",
  className,
}: FollowButtonProps) {
  const storeSetFollowing = useAppStore((s) => s.setFollowing)
  const followCache = useAppStore((s) => s.followCache)
  const cached = followCache.get(performerId)

  const [following, setFollowing] = useState(cached ?? initialFollowing)
  const [count, setCount] = useState(initialCount)
  const [hovered, setHovered] = useState(false)
  const busyRef = useRef(false)

  const label = following ? (hovered ? "Unfollow" : "Following") : "Follow"

  const toggle = useCallback(async () => {
    if (busyRef.current) return
    const next = !following
    const nextCount = next ? count + 1 : Math.max(0, count - 1)

    setFollowing(next)
    setCount(nextCount)
    storeSetFollowing(performerId, next)

    busyRef.current = true
    try {
      const res = next
        ? await api.followPerformer(performerId)
        : await api.unfollowPerformer(performerId)
      setFollowing(res.following)
      setCount(res.count)
      storeSetFollowing(performerId, res.following)
    } catch {
      setFollowing(following)
      setCount(count)
      storeSetFollowing(performerId, following)
    } finally {
      busyRef.current = false
    }
  }, [following, count, performerId, storeSetFollowing])

  const sizeClasses =
    size === "sm"
      ? "px-2.5 py-1 text-[11px]"
      : size === "lg"
      ? "px-5 py-2 text-sm"
      : "px-4 py-1.5 text-xs"

  return (
    <motion.button
      onClick={(e) => {
        e.stopPropagation()
        toggle()
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      whileTap={{ scale: 0.96 }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium transition-colors",
        sizeClasses,
        following
          ? "bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25"
          : "bg-white/10 text-text-primary border border-white/10 hover:bg-white/15",
        className
      )}
    >
      <span>{label}</span>
      {count > 0 && (
        <span className="text-white/40">{count.toLocaleString()}</span>
      )}
    </motion.button>
  )
})
