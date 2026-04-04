import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { Screenshot, Playlist, UserTagCount } from "@/lib/api"
import { cn } from "@/lib/cn"

interface MediaContextMenuProps {
  x: number
  y: number
  shot: Screenshot
  playlists: Playlist[]
  onClose: () => void
  onRate: (rating: number) => void
  onAddToPlaylist: (playlistId: number) => void
  onCopyUrl: () => void
  onDescribe: () => void
  onOpenSource: () => void
  onDelete: () => void
  userTags?: string[]
  allTags?: UserTagCount[]
  aiTags?: string[]
  onAddTag?: (tag: string) => void
  onRemoveTag?: (tag: string) => void
  onFilterByCreator?: (performerId: number, username: string) => void
}

export function MediaContextMenu({
  x,
  y,
  shot,
  playlists,
  onClose,
  onRate,
  onAddToPlaylist,
  onCopyUrl,
  onDescribe,
  onOpenSource,
  onDelete,
  userTags = [],
  allTags = [],
  aiTags = [],
  onAddTag,
  onRemoveTag,
  onFilterByCreator,
}: MediaContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [rateOpen, setRateOpen] = useState(false)
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tagOpen, setTagOpen] = useState(false)
  const [tagInput, setTagInput] = useState("")
  const [pos, setPos] = useState({ x, y })

  // Reposition if menu overflows viewport
  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let newX = x
    let newY = y
    if (rect.right > window.innerWidth - 8) newX = window.innerWidth - rect.width - 8
    if (rect.bottom > window.innerHeight - 8) newY = window.innerHeight - rect.height - 8
    if (newX < 8) newX = 8
    if (newY < 8) newY = 8
    setPos({ x: newX, y: newY })
  }, [x, y])

  // Close on click outside or escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", handleClick)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      document.removeEventListener("keydown", handleKey)
    }
  }, [onClose])

  const menuItemClass =
    "flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs transition-colors hover:bg-white/10"

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[70] min-w-[180px] rounded-lg border border-white/10 bg-[#0c1424]/95 backdrop-blur-xl p-1 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
    >
      {/* Rate submenu */}
      <div
        className="relative"
        onMouseEnter={() => setRateOpen(true)}
        onMouseLeave={() => setRateOpen(false)}
      >
        <button className={cn(menuItemClass, "text-white/80")} role="menuitem">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          Rate
          <span className="ml-auto text-white/30">&#9654;</span>
        </button>
        {rateOpen && (
          <div className="absolute left-full top-0 ml-1 rounded-lg border border-white/10 bg-[#0c1424]/95 backdrop-blur-xl p-1 shadow-xl">
            {[1, 2, 3, 4, 5].map((r) => (
              <button
                key={r}
                onClick={() => { onRate(r); onClose() }}
                className={cn(
                  menuItemClass,
                  (shot.rating ?? 0) === r ? "text-yellow-400" : "text-white/70"
                )}
                role="menuitem"
              >
                {"★".repeat(r)}{"☆".repeat(5 - r)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Add to playlist submenu */}
      <div
        className="relative"
        onMouseEnter={() => setPlaylistOpen(true)}
        onMouseLeave={() => setPlaylistOpen(false)}
      >
        <button className={cn(menuItemClass, "text-white/80")} role="menuitem">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          Add to Playlist
          <span className="ml-auto text-white/30">&#9654;</span>
        </button>
        {playlistOpen && (
          <div className="absolute left-full top-0 ml-1 min-w-[140px] rounded-lg border border-white/10 bg-[#0c1424]/95 backdrop-blur-xl p-1 shadow-xl">
            {playlists.length === 0 ? (
              <p className="px-3 py-1.5 text-xs text-white/40">No playlists</p>
            ) : (
              playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => { onAddToPlaylist(pl.id); onClose() }}
                  className={cn(menuItemClass, "text-white/70")}
                  role="menuitem"
                >
                  {pl.name}
                  <span className="ml-auto text-[10px] text-white/30">{pl.item_count}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="my-1 h-px bg-white/10" />

      {/* Copy URL */}
      <button
        onClick={() => { onCopyUrl(); onClose() }}
        className={cn(menuItemClass, "text-white/80")}
        role="menuitem"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
        Copy URL
      </button>

      {/* AI Describe */}
      <button
        onClick={() => { onDescribe(); onClose() }}
        className={cn(menuItemClass, "text-white/80")}
        role="menuitem"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
        </svg>
        AI Describe
      </button>

      {/* Open Source */}
      {shot.page_url && (
        <button
          onClick={() => { onOpenSource(); onClose() }}
          className={cn(menuItemClass, "text-white/80")}
          role="menuitem"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Open Source
        </button>
      )}

      {/* Filter by creator */}
      {shot.performer_id != null && shot.performer_username && onFilterByCreator && (
        <button
          onClick={() => { onFilterByCreator(shot.performer_id!, shot.performer_username!); onClose() }}
          className={cn(menuItemClass, "text-sky-300")}
          role="menuitem"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="7" r="4"/><path d="M2 18c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          Filter: @{shot.performer_username}
        </button>
      )}

      {/* Tags submenu */}
      {onAddTag && (
        <div
          className="relative"
          onMouseEnter={() => setTagOpen(true)}
          onMouseLeave={() => setTagOpen(false)}
        >
          <button className={cn(menuItemClass, "text-white/80")} role="menuitem">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            Tags
            {userTags.length > 0 && <span className="ml-auto text-[10px] text-white/30">{userTags.length}</span>}
            <span className="text-white/30">&#9654;</span>
          </button>
          {tagOpen && (
            <div
              className="absolute left-full top-0 ml-1 min-w-[180px] rounded-lg border border-white/10 bg-[#0c1424]/95 backdrop-blur-xl p-2 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Current tags */}
              {userTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {userTags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] text-blue-300">
                      {t}
                      {onRemoveTag && (
                        <button onClick={() => { onRemoveTag(t); }} className="hover:text-white">&times;</button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {/* Add tag input */}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tagInput.trim()) {
                    onAddTag(tagInput.trim().toLowerCase())
                    setTagInput("")
                  }
                }}
                placeholder="Add tag..."
                className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] mb-1"
              />
              {/* Suggestions */}
              {(() => {
                const usedSet = new Set(userTags.map((t) => t.toLowerCase()))
                const lc = tagInput.toLowerCase().trim()
                const suggestions = [
                  ...aiTags.filter((t) => !usedSet.has(t.toLowerCase()) && (!lc || t.toLowerCase().includes(lc))).map((t) => ({ tag: t, ai: true })),
                  ...allTags.filter((t) => !usedSet.has(t.tag) && (!lc || t.tag.includes(lc))).map((t) => ({ tag: t.tag, ai: false })),
                ].slice(0, 6)
                if (suggestions.length === 0) return null
                return (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {suggestions.map((s) => (
                      <button
                        key={s.tag}
                        onClick={() => { onAddTag(s.tag.toLowerCase()); }}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] transition-colors",
                          s.ai ? "bg-purple-500/20 text-purple-300 hover:bg-purple-500/30" : "bg-white/5 text-white/50 hover:bg-white/10"
                        )}
                      >
                        + {s.tag}
                      </button>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}

      <div className="my-1 h-px bg-white/10" />

      {/* Delete */}
      {confirmDelete ? (
        <div className="flex items-center gap-1 px-1">
          <button
            onClick={() => { onDelete(); onClose() }}
            className="flex-1 rounded px-2 py-1.5 text-xs text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
          >
            Confirm
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="flex-1 rounded px-2 py-1.5 text-xs text-white/60 hover:text-white/80 transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          className={cn(menuItemClass, "text-red-400 hover:text-red-300")}
          role="menuitem"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
          Delete
        </button>
      )}
    </div>,
    document.body
  )
}
