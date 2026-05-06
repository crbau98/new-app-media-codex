import { memo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import { MessageCircle, Send, Trash2, CornerDownRight } from "lucide-react"
import { cn } from "@/lib/cn"
import { api, type Comment } from "@/lib/api"
import { useAppStore } from "@/store"

interface CommentThreadProps {
  screenshotId?: number
  performerId?: number
  className?: string
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(diff / 3_600_000)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(diff / 86_400_000)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function CommentItem({
  comment,
  depth = 0,
  type,
  targetId,
}: {
  comment: Comment
  depth?: number
  type: "screenshot" | "performer"
  targetId: number
}) {
  const qc = useQueryClient()
  const addToast = useAppStore((s) => s.addToast)
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyText, setReplyText] = useState("")

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteComment(comment.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comments", type, targetId] })
      addToast("Comment deleted", "success")
    },
    onError: () => addToast("Failed to delete comment", "error"),
  })

  const replyMutation = useMutation({
    mutationFn: () => api.postComment(targetId, type, replyText.trim(), comment.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comments", type, targetId] })
      setReplyText("")
      setReplyOpen(false)
    },
    onError: () => addToast("Failed to post reply", "error"),
  })

  return (
    <div className={cn("group", depth > 0 && "ml-6 border-l border-white/5 pl-3")}>
      <div className="flex gap-2.5 py-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-[10px] font-bold text-text-muted">
          {comment.avatar_url ? (
            <img src={comment.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            (comment.username?.charAt(0) ?? "?").toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-primary">{comment.username}</span>
            <span className="text-[10px] text-text-muted">{formatTimeAgo(comment.created_at)}</span>
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">{comment.content}</p>
          <div className="mt-1 flex items-center gap-3">
            <button
              onClick={() => setReplyOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[10px] text-text-muted transition-colors hover:text-text-secondary"
            >
              <CornerDownRight size={10} />
              Reply
            </button>
            {(comment.likes_count ?? 0) > 0 && (
              <span className="text-[10px] text-text-muted">{comment.likes_count} like{comment.likes_count !== 1 ? "s" : ""}</span>
            )}
            <button
              onClick={() => {
                if (confirm("Delete this comment?")) deleteMutation.mutate()
              }}
              className="ml-auto inline-flex items-center gap-1 text-[10px] text-text-muted opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
            >
              <Trash2 size={10} />
            </button>
          </div>

          <AnimatePresence>
            {replyOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-2 flex gap-2">
                  <input
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && replyText.trim()) replyMutation.mutate()
                    }}
                    placeholder="Write a reply..."
                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                  />
                  <button
                    onClick={() => replyMutation.mutate()}
                    disabled={!replyText.trim() || replyMutation.isPending}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/20 text-accent transition-colors hover:bg-accent/30 disabled:opacity-40"
                  >
                    <Send size={12} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-1">
          {comment.replies.map((reply) => (
            <CommentItem key={reply.id} comment={reply} depth={depth + 1} type={type} targetId={targetId} />
          ))}
        </div>
      )}
    </div>
  )
}

export const CommentThread = memo(function CommentThread({
  screenshotId,
  performerId,
  className,
}: CommentThreadProps) {
  const qc = useQueryClient()
  const addToast = useAppStore((s) => s.addToast)
  const [input, setInput] = useState("")

  const type: "screenshot" | "performer" = screenshotId ? "screenshot" : "performer"
  const targetId = screenshotId ?? performerId ?? 0

  const { data, isLoading } = useQuery({
    queryKey: ["comments", type, targetId],
    queryFn: () => api.getComments(targetId, type),
    enabled: targetId > 0,
    staleTime: 30_000,
  })

  const postMutation = useMutation({
    mutationFn: () => api.postComment(targetId, type, input.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comments", type, targetId] })
      setInput("")
    },
    onError: () => addToast("Failed to post comment", "error"),
  })

  const comments = data?.comments ?? []

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="mb-2 flex items-center gap-2">
        <MessageCircle size={14} className="text-text-muted" />
        <span className="text-xs font-medium text-text-primary">
          {comments.length} comment{comments.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {isLoading ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-2">
                <div className="h-7 w-7 shrink-0 rounded-full bg-white/5" />
                <div className="flex-1 space-y-1">
                  <div className="h-2.5 w-20 rounded bg-white/5" />
                  <div className="h-2 w-full rounded bg-white/5" />
                </div>
              </div>
            ))}
          </div>
        ) : comments.length === 0 ? (
          <p className="py-4 text-center text-xs text-text-muted">No comments yet. Be the first!</p>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {comments.map((c) => (
              <CommentItem key={c.id} comment={c} type={type} targetId={targetId} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 flex gap-2 border-t border-white/5 pt-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim()) postMutation.mutate()
          }}
          placeholder="Add a comment..."
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
        <button
          onClick={() => postMutation.mutate()}
          disabled={!input.trim() || postMutation.isPending}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20 text-accent transition-colors hover:bg-accent/30 disabled:opacity-40"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
})
