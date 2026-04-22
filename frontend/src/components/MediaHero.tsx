import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import type { Screenshot } from "@/lib/api"
import { getScreenshotMediaSrc, isVideoShot } from "@/lib/media"
import { resolvePublicUrl } from "@/lib/backendOrigin"

interface MediaHeroProps {
  shots: Screenshot[]
  onClick: (shot: Screenshot) => void
}

export function MediaHero({ shots, onClick }: MediaHeroProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isHovering, setIsHovering] = useState(false)

  const featured = shots.slice(0, 5).filter((s) => s.preview_url || s.local_url || s.thumbnail_url)
  if (featured.length === 0) return null

  const current = featured[currentIndex]
  const isVideo = isVideoShot(current)
  const bgImage =
    resolvePublicUrl(current.preview_url || current.local_url || current.thumbnail_url || "")

  const nextSlide = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % featured.length)
  }, [featured.length])

  // Auto-advance every 6 seconds unless hovering
  useEffect(() => {
    if (isHovering || featured.length <= 1) return
    const id = setInterval(nextSlide, 6000)
    return () => clearInterval(id)
  }, [isHovering, featured.length, nextSlide])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="relative mb-6 overflow-hidden rounded-[28px] border border-white/[0.08]"
      style={{ aspectRatio: "21 / 9", maxHeight: "420px" }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Background image with crossfade */}
      <AnimatePresence mode="sync">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
          className="absolute inset-0"
        >
          <img
            src={bgImage}
            alt={current.term}
            className="h-full w-full object-cover"
            loading="eager"
          />
          {/* Gradient overlays */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />
        </motion.div>
      </AnimatePresence>

      {/* Content */}
      <div className="absolute inset-0 flex flex-col justify-end p-6 sm:p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full bg-accent/20 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-accent backdrop-blur-sm">
                Featured
              </span>
              {isVideo && (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/80 backdrop-blur-sm">
                  Video
                </span>
              )}
            </div>
            <h2
              className="mb-1 max-w-xl text-xl font-semibold text-white sm:text-2xl md:text-3xl"
              style={{ textShadow: "0 2px 12px rgba(0,0,0,0.5)" }}
            >
              {current.term}
            </h2>
            {current.ai_summary && (
              <p className="mb-4 max-w-lg text-sm text-white/70 line-clamp-2 sm:text-base">
                {current.ai_summary}
              </p>
            )}
            <button
              onClick={() => onClick(current)}
              className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-white/25"
            >
              {isVideo ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                  Watch Now
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                  View
                </>
              )}
            </button>
          </motion.div>
        </AnimatePresence>

        {/* Pagination dots */}
        {featured.length > 1 && (
          <div className="absolute bottom-6 right-6 flex items-center gap-1.5 sm:bottom-8 sm:right-8">
            {featured.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentIndex(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === currentIndex
                    ? "w-6 bg-white"
                    : "w-1.5 bg-white/40 hover:bg-white/60"
                }`}
                aria-label={`Go to slide ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
