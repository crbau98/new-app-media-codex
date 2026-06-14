import { memo, useCallback, useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Heart } from "lucide-react"
import { cn } from "@/lib/cn"
import { api } from "@/lib/api"
import { useAppStore } from "@/store"

interface LikeButtonProps {
  screenshotId?: number
  performerId?: number
  initialLiked?: boolean
  initialCount?: number
  size?: "sm" | "md" | "lg"
  className?: string
}

const SIZE_MAP = {
  sm: { btn: "h-6 w-6", icon: 12, text: "text-[10px]" },
  md: { btn: "h-8 w-8", icon: 16, text: "text-xs" },
  lg: { btn: "h-9 w-9", icon: 18, text: "text-sm" },
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export const LikeButton = memo(function LikeButton({
  screenshotId,
  performerId,
  initialLiked = false,
  initialCount = 0,
  size = "md",
  className,
}: LikeButtonProps) {
  const storeSetLiked = useAppStore((s) => s.setLiked)
  const likeCache = useAppStore((s) => s.likeCache)
  const cacheKey = screenshotId ?? performerId ?? 0
  const cached = likeCache.get(cacheKey)

  const [liked, setLiked] = useState(cached?.liked ?? initialLiked)
  const [count, setCount] = useState(cached?.count ?? initialCount)
  const [burst, setBurst] = useState(false)
  const busyRef = useRef(false)

  const s = SIZE_MAP[size]

  const toggle = useCallback(async () => {
    if (busyRef.current) return
    if (!screenshotId && !performerId) return

    const nextLiked = !liked
    const nextCount = nextLiked ? count + 1 : Math.max(0, count - 1)

    // Optimistic update
    setLiked(nextLiked)
    setCount(nextCount)
    storeSetLiked(cacheKey, nextLiked, nextCount)
    if (nextLiked) setBurst(true)

    busyRef.current = true
    try {
      if (screenshotId) {
        const res = nextLiked
          ? await api.likeScreenshot(screenshotId)
          : await api.unlikeScreenshot(screenshotId)
        setLiked(res.liked)
        setCount(res.count)
        storeSetLiked(cacheKey, res.liked, res.count)
      } else if (performerId) {
        const res = nextLiked
          ? await api.likePerformer(performerId)
          : await api.unlikePerformer(performerId)
        setLiked(res.liked)
        setCount(res.count)
        storeSetLiked(cacheKey, res.liked, res.count)
      }
    } catch {
      // Rollback
      setLiked(liked)
      setCount(count)
      storeSetLiked(cacheKey, liked, count)
    } finally {
      busyRef.current = false
      setTimeout(() => setBurst(false), 600)
    }
  }, [liked, count, screenshotId, performerId, cacheKey, storeSetLiked])

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        toggle()
      }}
      className={cn(
        "group inline-flex items-center gap-1 rounded-full transition-colors",
        s.btn,
        liked ? "text-rose-400" : "text-white/60 hover:text-rose-300",
        className
      )}
      title={liked ? "Unlike" : "Like"}
    >
      <motion.div
        className="relative flex items-center justify-center"
        whileTap={{ scale: 0.8 }}
        animate={burst ? { scale: [1, 1.4, 1] } : { scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        <Heart
          size={s.icon}
          className={cn("transition-colors", liked && "fill-current")}
        />
        <AnimatePresence>
          {burst && (
            <>
              {Array.from({ length: 6 }).map((_, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 1, scale: 0.5, x: 0, y: 0 }}
                  animate={{
                    opacity: 0,
                    scale: 0,
                    x: Math.cos((i * Math.PI) / 3) * 16,
                    y: Math.sin((i * Math.PI) / 3) * 16,
                  }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="absolute block h-1 w-1 rounded-full bg-rose-400"
                />
              ))}
            </>
          )}
        </AnimatePresence>
      </motion.div>
      {count > 0 && <span className={cn("font-medium tabular-nums", s.text)}>{formatCount(count)}</span>}
    </button>
  )
})
