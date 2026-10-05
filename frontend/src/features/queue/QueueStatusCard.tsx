import { ListVideo, Play } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useQueue } from './hooks'
import { effectiveAutoplay, isUpcoming, peekNext, queuePosition } from './queueModel'
import { queueActions } from './queueStore'
import { surface } from './surface'

/**
 * Compact queue summary for the detail sheet: where this item sits, what plays
 * next, the autoplay-next switch and a way to open the drawer. Renders nothing
 * when the queue is empty.
 */
export default function QueueStatusCard({ item }: { item: MediaItem }) {
  const queue = useQueue()
  if (!queue.nowPlaying) return null
  const playingHere = queue.nowPlaying.id === item.id
  const queuedHere = isUpcoming(queue, item.id)
  const next = peekNext(queue)?.item ?? null
  const { index, total } = queuePosition(queue)
  const autoplay = effectiveAutoplay(queue, queue.nowPlaying.id)

  return (
    <section className="mb-5 rounded-2xl border border-gold-line bg-gold-dim p-3.5" aria-label="Queue status" data-testid="queue-status">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/25 text-gold-ink">
          <ListVideo size={15} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{playingHere ? `Queue · ${index} of ${total}` : 'Your queue'}</p>
          <p className="mt-1 text-[13px] leading-5 text-ink-2">
            {playingHere ? (
              next ? (
                <>
                  Up next: <span className="font-medium text-ink">{next.title}</span>
                </>
              ) : (
                'This is the last item in your queue.'
              )
            ) : (
              <>
                {queue.upcoming.length} up next · now playing <span className="font-medium text-ink">{queue.nowPlaying.title}</span>
              </>
            )}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => surface.openPanel()} className="btn-secondary min-h-11 px-3 text-xs" data-testid="queue-open">
          <ListVideo size={14} strokeWidth={1.75} aria-hidden="true" /> Open queue
        </button>
        {queuedHere && (
          <button type="button" onClick={() => queueActions.jumpTo(item.id)} className="btn-secondary min-h-11 px-3 text-xs">
            <Play size={13} fill="currentColor" strokeWidth={0} aria-hidden="true" /> Play from queue
          </button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={autoplay}
          onClick={() => queueActions.toggleAutoplay(queue.nowPlaying?.id)}
          className={cn('chip ml-auto', autoplay && 'chip-active')}
        >
          Autoplay next <span className="font-mono text-[10px] opacity-70">{autoplay ? 'On' : 'Off'}</span>
        </button>
      </div>
    </section>
  )
}
