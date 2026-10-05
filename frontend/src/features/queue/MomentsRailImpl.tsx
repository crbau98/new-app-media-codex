import { useMemo } from 'react'
import { BookmarkCheck, Repeat, X } from 'lucide-react'
import MediaImage from '@/components/MediaImage'
import Rail from '@/components/discovery/Rail'
import SectionHeader from '@/components/discovery/SectionHeader'
import { requestOpenMedia } from '@/features/ai/events'
import { formatTime } from '@/lib/player/controls'
import { useAppStore } from '@/store'
import { useMoments } from './hooks'
import { defaultLabel, isClip, type Moment } from './momentsModel'
import { momentsActions } from './momentsStore'
import MomentsTools from './MomentsTools'
import { requestSeek, setStartIntent } from './startIntent'
import '@/styles/discovery.css'

import type { MomentsRailProps } from './MomentsRail'

/**
 * Implementation of the Moments rail (loaded on demand by ./MomentsRail).
 * Your saved moments — timestamps and A–B clips bookmarked while watching.
 * Only the item id, title, creator, thumbnail URL and timestamps are stored
 * (never media). Opening one jumps the player to that time; clips loop.
 */
export default function MomentsRail({ items, onSelect }: MomentsRailProps) {
  const moments = useMoments()
  const addToast = useAppStore((state) => state.addToast)
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  if (moments.length === 0) return null

  const open = (moment: Moment) => {
    const item = byId.get(moment.itemId)
    const loop = moment.end !== undefined ? { a: moment.t, b: moment.end } : undefined
    setStartIntent({ id: moment.itemId, at: moment.t, play: true, loop })
    if (item) {
      onSelect(item)
      // If that item's player is already on screen, nudge it directly.
      requestSeek({ id: moment.itemId, t: moment.t, end: moment.end, play: true })
      return
    }
    if (!requestOpenMedia(moment.itemId)) {
      addToast({ type: 'info', title: 'That video has left the live feed', message: 'Your moment stays saved. Search for the title to watch it again.' })
    }
  }

  return (
    <section aria-label="Your moments">
      <SectionHeader
        title="Moments"
        eyebrow="Saved timestamps"
        icon={<BookmarkCheck size={12} strokeWidth={1.75} aria-hidden="true" />}
        note={`${moments.length} saved on this device · tap to jump straight there`}
      >
        <MomentsTools count={moments.length} className="flex items-center gap-2" size="md" />
      </SectionHeader>
      <Rail ariaLabel="Your moments">
        {moments.slice(0, 30).map((moment) => {
          const clip = isClip(moment)
          const when = clip ? `${formatTime(moment.t)}–${formatTime(moment.end ?? moment.t)}` : formatTime(moment.t)
          return (
            <div key={moment.id} className="d-rail-item group relative" data-variant="wide" data-testid="moment-card">
              <button
                type="button"
                onClick={() => open(moment)}
                className="group/moment relative block aspect-video w-full overflow-hidden rounded-2xl bg-sunken text-left outline-none ring-1 ring-white/10 transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-heat/80"
                aria-label={`${clip ? 'Play clip' : 'Jump to moment'}: ${defaultLabel(moment)} in ${moment.title} at ${when}`}
              >
                {moment.thumbnail ? (
                  <MediaImage sources={[moment.thumbnail]} alt="" className="absolute inset-0 h-full w-full object-cover" skeletonClassName="absolute inset-0" />
                ) : (
                  <span className="absolute inset-0 bg-gradient-to-br from-sunken to-canvas" />
                )}
                <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" aria-hidden="true" />
                <span className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 font-mono text-[11px] font-semibold tabular-nums text-gold-ink">
                    <BookmarkCheck size={11} aria-hidden="true" /> {when}
                  </span>
                  {clip && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white/85">
                      <Repeat size={10} aria-hidden="true" /> Loop
                    </span>
                  )}
                </span>
                <span className="absolute inset-x-3 bottom-2.5 block">
                  <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-white">{defaultLabel(moment)}</span>
                </span>
              </button>
              <button type="button" onClick={() => momentsActions.remove(moment.id)} className="d-remove" aria-label={`Remove moment ${defaultLabel(moment)}`}>
                <X size={14} strokeWidth={2} />
              </button>
              <div className="d-rail-caption">
                {moment.title} · @{moment.creator}
              </div>
            </div>
          )
        })}
      </Rail>
    </section>
  )
}
