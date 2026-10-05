import { FastForward, X } from 'lucide-react'
import { formatTime } from '@/lib/player/controls'

interface SkipStartChipProps {
  seconds: number
  creator: string
  samples: number
  onSkip: () => void
  /** "Don't suggest again for this creator". */
  onForget: () => void
}

/**
 * Transparent smart-start offer: it says exactly why it appears (you have
 * skipped to about this point in N of this creator's videos) and can be turned
 * off per creator here or globally in the player settings.
 */
export default function SkipStartChip({ seconds, creator, samples, onSkip, onForget }: SkipStartChipProps) {
  return (
    <div
      className="mc-hud-in pointer-events-auto relative flex max-w-full items-center rounded-full border border-white/10 bg-[rgb(12_9_18/0.88)] text-white shadow-xl"
      data-testid="skip-start"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={onSkip}
        className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-full pl-3.5 pr-2 text-left text-xs font-medium outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70"
        title={`You usually start @${creator}'s videos around ${formatTime(seconds)} (${samples} of your recent views). Tap to skip there.`}
      >
        <FastForward size={14} className="shrink-0 text-gold-ink" aria-hidden="true" />
        <span className="min-w-0 truncate">
          Skip to <span className="font-mono tabular-nums">{formatTime(seconds)}</span>
          <span className="hidden text-white/60 sm:inline"> · your usual start for @{creator}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onForget}
        className="mr-1 inline-grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/60 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70"
        aria-label={`Don't suggest skipping for @${creator} again`}
        title="Don't suggest this again"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
