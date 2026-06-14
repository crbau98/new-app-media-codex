import { memo, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import type { Screenshot } from "@/lib/api"
import { useResolvedScreenshotMedia } from "@/lib/media"
import { ViewCounter } from "@/components/ViewCounter"

interface ImmersiveViewerProps {
  shot: Screenshot
  onClose: () => void
}

export const ImmersiveViewer = memo(function ImmersiveViewer({
  shot,
  onClose,
}: ImmersiveViewerProps) {
  const { mediaSrc, previewSrc, isVideo } = useResolvedScreenshotMedia(shot)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose])

  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}${window.location.pathname}#/media?shot=${shot.id}`
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: shot.term, url })
      } catch {
        // user cancelled or error
      }
    } else {
      try {
        await navigator.clipboard.writeText(url)
      } catch {
        // ignore
      }
    }
  }, [shot.id, shot.term])

  const mediaUrl = mediaSrc || previewSrc

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="absolute top-4 right-4 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
        aria-label="Close viewer"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="4" y1="4" x2="20" y2="20" />
          <line x1="20" y1="4" x2="4" y2="20" />
        </svg>
      </button>

      {/* Media */}
      <div
        className="relative h-full w-full flex items-center justify-center p-4 pb-28"
        onClick={(e) => e.stopPropagation()}
      >
        {isVideo && mediaUrl ? (
          <video
            src={mediaUrl}
            controls
            autoPlay
            playsInline
            loop
            muted
            className="max-h-full max-w-full object-contain rounded-lg"
          />
        ) : mediaUrl ? (
          <img
            src={mediaUrl}
            alt={shot.term}
            className="max-h-full max-w-full object-contain rounded-lg"
            loading="eager"
            decoding="async"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-white/60">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
            <span className="text-sm">Media unavailable</span>
          </div>
        )}
      </div>

      {/* Bottom overlay */}
      <div
        className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-6 pb-8 pt-16"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto max-w-3xl flex items-end justify-between gap-4">
          <div className="min-w-0">
            {shot.performer_username && (
              <p className="mb-1 text-sm font-medium text-white/80">@{shot.performer_username}</p>
            )}
            <p className="text-lg font-semibold text-white truncate">{shot.term}</p>
          </div>
          <div className="flex items-center gap-4 shrink-0 text-white/70">
            {(shot.likes_count ?? 0) > 0 && (
              <span className="flex items-center gap-1.5 text-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                {shot.likes_count}
              </span>
            )}
            {(shot.views_count ?? 0) > 0 && (
              <ViewCounter screenshotId={shot.id} count={shot.views_count} className="text-sm text-white/70" />
            )}
            <button
              onClick={handleShare}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
              aria-label="Share"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
})
