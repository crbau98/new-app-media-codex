import { useEffect, useRef, useState } from 'react'
import { BookmarkCheck, Pencil, Undo2 } from 'lucide-react'
import { formatTime } from '@/lib/player/controls'
import { isClip, MAX_LABEL, type Moment } from '@/features/queue/momentsModel'

interface MomentChipProps {
  moment: Moment
  updated: boolean
  onLabel: (label: string) => void
  onUndo: () => void
  onDismiss: () => void
}

const VISIBLE_MS = 6500

/**
 * Confirmation after saving a moment: shows the timestamp, lets the viewer add
 * an optional label right there, or undo. Fades itself out unless they engage.
 */
export default function MomentChip({ moment, updated, onLabel, onUndo, onDismiss }: MomentChipProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(moment.label)
  const inputRef = useRef<HTMLInputElement>(null)
  const dismissRef = useRef(onDismiss)
  useEffect(() => {
    dismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    if (editing) return undefined
    const timer = window.setTimeout(() => dismissRef.current(), VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [editing, moment.id, moment.label, updated])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const when = isClip(moment) ? `${formatTime(moment.t)}–${formatTime(moment.end ?? moment.t)}` : formatTime(moment.t)
  const commit = () => {
    onLabel(draft.trim())
    setEditing(false)
  }

  return (
    <div
      className="mc-hud-in pointer-events-auto relative flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-[rgb(12_9_18/0.88)] py-1 pl-3 pr-1 text-white shadow-xl"
      data-testid="moment-chip"
      role="status"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <BookmarkCheck size={15} className="shrink-0 text-gold-ink" aria-hidden="true" />
      {editing ? (
        <form
          className="flex min-w-0 items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            commit()
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            maxLength={MAX_LABEL}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setEditing(false)
              }
            }}
            aria-label="Moment label"
            placeholder="Label (optional)"
            className="h-9 w-40 min-w-0 rounded-full border border-white/15 bg-white/10 px-3 text-base text-white outline-none placeholder:text-white/45 focus:border-gold-line sm:w-52 sm:text-[13px]"
          />
          <button type="submit" className="inline-flex min-h-9 items-center rounded-full bg-heat px-3 text-xs font-semibold text-canvas outline-none focus-visible:ring-2 focus-visible:ring-white/80">
            Save
          </button>
        </form>
      ) : (
        <>
          <span className="min-w-0 truncate text-xs font-medium">
            {updated ? 'Moment updated' : isClip(moment) ? 'Clip saved' : 'Moment saved'} <span className="font-mono tabular-nums text-white/70">· {when}</span>
            {moment.label && <span className="text-white/70"> · {moment.label}</span>}
          </span>
          <button
            type="button"
            onClick={() => {
              setDraft(moment.label)
              setEditing(true)
            }}
            className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-white/85 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <Pencil size={12} aria-hidden="true" /> {moment.label ? 'Edit' : 'Add label'}
          </button>
          {!updated && (
            <button
              type="button"
              onClick={onUndo}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/70 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70"
              aria-label="Undo save moment"
              title="Undo"
            >
              <Undo2 size={14} aria-hidden="true" />
            </button>
          )}
        </>
      )}
    </div>
  )
}
