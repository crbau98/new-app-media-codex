import { memo, useState, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { MessageCircle, Share2, Bookmark } from "lucide-react"
import { cn } from "@/lib/cn"
import { LikeButton } from "./LikeButton"
import { CommentThread } from "./CommentThread"
import type { Screenshot, Performer } from "@/lib/api"

interface EngagementBarProps {
  screenshot?: Screenshot
  performer?: Performer
  className?: string
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

async function handleShare(item: Screenshot | Performer | undefined) {
  if (!item) return
  const url = window.location.href
  const title = "term" in item ? item.term : `@${item.username}`
  if (navigator.share) {
    try {
      await navigator.share({ title, url })
    } catch {
      // ignored
    }
  } else {
    await navigator.clipboard.writeText(url)
  }
}

export const EngagementBar = memo(function EngagementBar({
  screenshot,
  performer,
  className,
}: EngagementBarProps) {
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  const commentCount = screenshot?.comments_count ?? 0

  const toggleComments = useCallback(() => {
    setCommentsOpen((v) => !v)
  }, [])

  return (
    <div className={cn("", className)}>
      <div className="flex items-center gap-1">
        <LikeButton
          screenshotId={screenshot?.id}
          performerId={performer?.id}
          initialLiked={screenshot?.is_liked ?? false}
          initialCount={screenshot?.likes_count ?? 0}
          size="sm"
        />

        <button
          onClick={toggleComments}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors",
            commentsOpen ? "text-accent bg-accent/10" : "text-text-muted hover:text-text-secondary hover:bg-white/5"
          )}
          title="Comments"
        >
          <MessageCircle size={14} />
          {commentCount > 0 && <span className="font-medium tabular-nums">{formatCount(commentCount)}</span>}
        </button>

        <button
          onClick={() => handleShare(screenshot ?? performer)}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-text-muted transition-colors hover:text-text-secondary hover:bg-white/5"
          title="Share"
        >
          <Share2 size={14} />
        </button>

        <button
          onClick={() => setSaved((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors",
            saved ? "text-amber-400 bg-amber-400/10" : "text-text-muted hover:text-text-secondary hover:bg-white/5"
          )}
          title={saved ? "Saved" : "Save"}
        >
          <Bookmark size={14} className={cn(saved && "fill-current")} />
        </button>
      </div>

      <AnimatePresence>
        {commentsOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-xl border border-white/8 bg-white/[0.02] p-3">
              <CommentThread
                screenshotId={screenshot?.id}
                performerId={performer?.id}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
