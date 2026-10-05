import { useEffect, useRef, useState } from 'react'
import { Play, X } from 'lucide-react'
import MediaImage from '@/components/MediaImage'
import type { MediaItem } from '@/lib/types'
import { readMediaIntel } from '@/lib/player/intel'

export const UP_NEXT_SECONDS = 5

interface UpNextCardProps {
  item: MediaItem
  /** True: count down and advance by itself. False: just offer "Play next". */
  countdown: boolean
  /** Why this is next — "From your queue" or "Next in the list". */
  source: 'queue' | 'list'
  onPlay: () => void
  onCancel: () => void
}

const RING_R = 15
const RING_C = 2 * Math.PI * RING_R

/**
 * End-of-video "Up next" card. With autoplay-next on it counts down from 5 and
 * advances; Cancel (or Esc, handled by the player) stops it and leaves the
 * finished video in place.
 */
export default function UpNextCard({ item, countdown, source, onPlay, onCancel }: UpNextCardProps) {
  const intel = readMediaIntel(item)
  const [remaining, setRemaining] = useState(UP_NEXT_SECONDS)
  const playRef = useRef(onPlay)
  useEffect(() => {
    playRef.current = onPlay
  }, [onPlay])

  useEffect(() => {
    if (!countdown) return undefined
    const started = Date.now()
    const timer = window.setInterval(() => {
      const left = UP_NEXT_SECONDS - (Date.now() - started) / 1000
      if (left <= 0) {
        window.clearInterval(timer)
        setRemaining(0)
        playRef.current()
        return
      }
      setRemaining(left)
    }, 100)
    return () => window.clearInterval(timer)
  }, [countdown])

  const seconds = Math.max(1, Math.ceil(remaining))

  return (
    <div
      className="mc-upnext absolute inset-x-2 bottom-[4.25rem] z-30 flex items-stretch gap-3 rounded-2xl border border-white/12 bg-[rgb(12_9_18/0.9)] p-2.5 shadow-2xl sm:inset-x-auto sm:bottom-[4.75rem] sm:right-4 sm:w-[360px]"
      data-testid="up-next"
      role="group"
      aria-label={`Up next: ${item.title}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="sr-only" role="status">
        {countdown ? `Up next: ${item.title}. Playing in ${UP_NEXT_SECONDS} seconds. Press Escape to cancel.` : `Up next: ${item.title}.`}
      </span>
      <button
        type="button"
        onClick={onPlay}
        className="group/up relative block aspect-video w-[7.5rem] shrink-0 overflow-hidden rounded-xl bg-sunken outline-none ring-1 ring-white/10 focus-visible:ring-2 focus-visible:ring-heat/80 sm:w-[8.5rem]"
        aria-label={`Play ${item.title} now`}
      >
        <MediaImage
          sources={[intel.posterUrl, item.thumbnail]}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          skeletonClassName="absolute inset-0"
          loading="eager"
          dominantColor={intel.dominantColor}
          lqip={intel.lqip}
        />
        <span className="absolute inset-0 grid place-items-center bg-black/35">
          {countdown ? (
            <span className="relative grid h-10 w-10 place-items-center" aria-hidden="true">
              <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
                <circle cx="18" cy="18" r={RING_R} fill="rgb(0 0 0 / 0.45)" stroke="rgb(255 255 255 / 0.28)" strokeWidth="2.5" />
                <circle
                  cx="18"
                  cy="18"
                  r={RING_R}
                  fill="none"
                  stroke="rgb(var(--heat))"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={RING_C}
                  strokeDashoffset={RING_C * (1 - Math.max(0, Math.min(1, remaining / UP_NEXT_SECONDS)))}
                />
              </svg>
              <span className="relative font-mono text-sm font-semibold tabular-nums text-white">{seconds}</span>
            </span>
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/25" aria-hidden="true">
              <Play size={16} fill="currentColor" strokeWidth={0} className="ml-0.5" />
            </span>
          )}
        </span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
            Up next · {source === 'queue' ? 'From your queue' : 'Next in list'}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-snug text-white">{item.title}</p>
          <p className="mt-0.5 truncate text-[11px] text-white/60">@{item.creator}</p>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={onPlay}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-heat px-3.5 text-xs font-semibold text-canvas outline-none transition-colors hover:bg-heat-hover focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <Play size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" /> Play now
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-xs font-medium text-white/80 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <X size={12} aria-hidden="true" /> {countdown ? 'Cancel' : 'Dismiss'}
          </button>
        </div>
      </div>
    </div>
  )
}
