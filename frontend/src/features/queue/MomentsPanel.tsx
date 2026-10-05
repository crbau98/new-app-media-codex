import { useState } from 'react'
import { BookmarkCheck, Check, Pencil, Repeat, X } from 'lucide-react'
import { formatTime } from '@/lib/player/controls'
import type { MediaItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useItemMoments, useMoments } from './hooks'
import { defaultLabel, isClip, MAX_LABEL, type Moment } from './momentsModel'
import { momentsActions } from './momentsStore'
import MomentsTools from './MomentsTools'
import { requestSeek } from './startIntent'

function MomentRow({ moment, itemId }: { moment: Moment; itemId: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(moment.label)
  const clip = isClip(moment)
  const when = clip ? `${formatTime(moment.t)}–${formatTime(moment.end ?? moment.t)}` : formatTime(moment.t)

  const commit = () => {
    momentsActions.rename(moment.id, draft)
    setEditing(false)
  }

  return (
    <li className="flex items-center gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.03] pl-1.5 pr-1" data-testid="moment-row">
      {editing ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            commit()
          }}
        >
          <span className="shrink-0 rounded-md bg-gold-dim px-1.5 py-1 font-mono text-[11px] tabular-nums text-gold-ink">{when}</span>
          <input
            value={draft}
            maxLength={MAX_LABEL}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setEditing(false)
              }
            }}
            aria-label="Moment label"
            placeholder="Label"
            className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-transparent px-2 text-base text-ink outline-none placeholder:text-ink-3 focus:border-line-strong sm:text-[13px]"
          />
          <button type="submit" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-white/10" aria-label="Save label">
            <Check size={15} aria-hidden="true" />
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={() => requestSeek({ id: itemId, t: moment.t, end: moment.end, play: true })}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-left outline-none transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-heat/70"
            aria-label={`${clip ? 'Play clip' : 'Jump to'} ${defaultLabel(moment)} at ${when}`}
          >
            <span className="shrink-0 rounded-md bg-gold-dim px-1.5 py-1 font-mono text-[11px] tabular-nums text-gold-ink">{when}</span>
            <span className={cn('min-w-0 flex-1 truncate text-[13px]', moment.label ? 'text-ink' : 'text-ink-3')}>{moment.label || (clip ? 'Saved clip' : 'Saved moment')}</span>
            {clip && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-ink-2">
                <Repeat size={10} aria-hidden="true" /> Loop
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(moment.label)
              setEditing(true)
            }}
            className="grid h-11 w-9 shrink-0 place-items-center rounded-full text-ink-3 outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-heat/70"
            aria-label={`Edit label for ${defaultLabel(moment)}`}
          >
            <Pencil size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => momentsActions.remove(moment.id)}
            className="grid h-11 w-9 shrink-0 place-items-center rounded-full text-ink-3 outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-heat/70"
            aria-label={`Delete ${defaultLabel(moment)}`}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </>
      )}
    </li>
  )
}

/** The detail sheet's "Moments" section: this video's bookmarks plus export/import for all of them. */
export default function MomentsPanel({ item }: { item: MediaItem }) {
  const moments = useItemMoments(item.id)
  const total = useMoments().length

  return (
    <section className="mt-6 border-t border-white/[0.06] pt-5" aria-label="Moments" data-testid="moments-panel">
      <div className="flex items-center justify-between gap-2">
        <h3 className="eyebrow inline-flex items-center gap-1.5">
          <BookmarkCheck size={12} strokeWidth={1.75} aria-hidden="true" /> Moments
          {moments.length > 0 && <span className="font-mono text-[10px] text-ink-3">· {moments.length}</span>}
        </h3>
        <MomentsTools count={total} className="flex items-center gap-1.5" />
      </div>
      {moments.length === 0 ? (
        <p className="mt-3 text-[13px] leading-5 text-ink-3">
          Press <kbd className="rounded border border-line-strong px-1 font-mono text-[11px] text-ink-2">B</kbd> or tap the bookmark while watching to save a moment. Set an A–B loop first to save it as a clip that loops when you open it.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {moments.map((moment) => (
            <MomentRow key={moment.id} moment={moment} itemId={item.id} />
          ))}
        </ul>
      )}
    </section>
  )
}
