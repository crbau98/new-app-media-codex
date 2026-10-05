import { useEffect, useRef, type ReactNode } from 'react'
import { BookmarkPlus, Check, FastForward, Keyboard, ListPlus, ListVideo, PictureInPicture2, Repeat, Sparkles } from 'lucide-react'
import { PLAYBACK_RATES, formatRate, formatTime } from '@/lib/player/controls'
import type { QualityOption } from './engine'
import { cn } from '@/lib/utils'

interface SettingsMenuProps {
  rate: number
  onRate: (rate: number) => void
  qualityOptions: QualityOption[]
  activeQuality: string
  playingLabel: string
  onQuality: (id: string) => void
  loop: boolean
  onLoop: () => void
  ambient: { available: boolean; enabled: boolean; onToggle: () => void }
  abLoop: { a: number | null; b: number | null; onMark: () => void; onClear: () => void; onSaveClip: () => void }
  onClose: () => void
  /** True when the current speed is remembered for this video. */
  rateRemembered?: boolean
  /** Autoplay-next toggle; hidden when there is no queue or list to advance through. */
  autoplayNext?: { enabled: boolean; mode: 'queue' | 'list'; onToggle: () => void }
  /** Picture-in-picture lives here on phones, where the control bar is tight. */
  pip?: { supported: boolean; active: boolean; toggle: () => void }
  smartStart: { enabled: boolean; onToggle: () => void }
  onShortcuts: () => void
  onMoment: () => void
  /** Add the current video to the queue (also Shift+Q); handy in fullscreen where the sheet's buttons are hidden. */
  onEnqueue: () => void
}

function SectionTitle({ children }: { children: string }) {
  return <h4 className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">{children}</h4>
}

const itemClass =
  'flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-white/90 outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-heat/70'

/** A compact on/off tile; four of them fit two short rows so the menu stays small inside a small player. */
function Toggle({ icon, label, title, on, onClick }: { icon: ReactNode; label: string; title: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={on}
      aria-label={title}
      title={title}
      onClick={onClick}
      className={cn(
        'flex min-h-11 min-w-0 items-center gap-1.5 rounded-lg px-2 text-left text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-heat/70',
        on ? 'bg-heat/15 text-white ring-1 ring-heat/40' : 'bg-white/5 text-white/75 hover:bg-white/10',
      )}
    >
      <span className={cn('shrink-0', on ? 'text-heat' : 'text-white/55')}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-[9px] uppercase text-white/50">{on ? 'On' : 'Off'}</span>
    </button>
  )
}

/** Glass settings popover: speed, quality, playback toggles, A–B loop, moments, shortcuts. */
export default function SettingsMenu({
  rate, onRate, qualityOptions, activeQuality, playingLabel, onQuality, loop, onLoop, ambient, abLoop, onClose,
  rateRemembered, autoplayNext, pip, smartStart, onShortcuts, onMoment, onEnqueue,
}: SettingsMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('button')
    first?.focus({ preventScroll: true })
  }, [])

  const abLabel =
    abLoop.a === null ? 'A–B loop: set point A' : abLoop.b === null ? `A–B loop: set point B (A ${formatTime(abLoop.a)})` : `A–B loop ${formatTime(abLoop.a)} – ${formatTime(abLoop.b)}`

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Player settings"
      className="mc-menu pointer-events-auto max-h-full w-64 max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[rgb(14_12_20/0.9)] p-1.5 shadow-2xl backdrop-blur-xl"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          event.preventDefault()
          onClose()
        }
      }}
    >
      <SectionTitle>{rateRemembered ? 'Speed · remembered for this video' : 'Speed'}</SectionTitle>
      <div className="grid grid-cols-3 gap-1 px-1 pb-1">
        {PLAYBACK_RATES.map((option) => (
          <button
            key={option}
            type="button"
            role="menuitemradio"
            aria-checked={rate === option}
            onClick={() => onRate(option)}
            className={cn(
              'min-h-11 rounded-lg px-2 font-mono text-xs tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-heat/70',
              rate === option ? 'bg-heat text-white' : 'bg-white/5 text-white/80 hover:bg-white/10',
            )}
          >
            {formatRate(option)}
          </button>
        ))}
      </div>

      {qualityOptions.length > 0 && (
        <>
          <SectionTitle>Quality</SectionTitle>
          {[{ id: 'auto', label: playingLabel ? `Auto · ${playingLabel}` : 'Auto' }, ...qualityOptions].map((option) => (
            <button key={option.id} type="button" role="menuitemradio" aria-checked={activeQuality === option.id} className={itemClass} onClick={() => onQuality(option.id)}>
              <span className="grid h-4 w-4 place-items-center">{activeQuality === option.id && <Check size={14} aria-hidden="true" />}</span>
              {option.label}
            </button>
          ))}
        </>
      )}

      <SectionTitle>Playback</SectionTitle>
      <div className="grid grid-cols-2 gap-1 px-1 pb-1">
        <Toggle icon={<Repeat size={13} aria-hidden="true" />} label="Loop" title="Loop video" on={loop} onClick={onLoop} />
        {autoplayNext && (
          <Toggle
            icon={<ListVideo size={13} aria-hidden="true" />}
            label="Autoplay"
            title={autoplayNext.mode === 'queue' ? 'Autoplay next in queue' : 'Autoplay next in list'}
            on={autoplayNext.enabled}
            onClick={autoplayNext.onToggle}
          />
        )}
        {ambient.available && <Toggle icon={<Sparkles size={13} aria-hidden="true" />} label="Ambient" title="Ambient glow" on={ambient.enabled} onClick={ambient.onToggle} />}
        <Toggle icon={<FastForward size={13} aria-hidden="true" />} label="My start" title="Suggest my usual start for creators I skip ahead on" on={smartStart.enabled} onClick={smartStart.onToggle} />
      </div>

      <button type="button" role="menuitem" className={itemClass} onClick={abLoop.onMark}>
        <span className="grid h-4 w-4 place-items-center font-mono text-[10px] text-heat">AB</span>
        <span className="flex-1">{abLabel}</span>
        <kbd className="font-mono text-[10px] text-white/50">A</kbd>
      </button>
      {abLoop.a !== null && abLoop.b !== null && (
        <button type="button" role="menuitem" className={itemClass} onClick={abLoop.onSaveClip}>
          <BookmarkPlus size={14} aria-hidden="true" className="text-gold-ink" />
          Save A–B as a clip
        </button>
      )}
      {abLoop.a !== null && (
        <button type="button" role="menuitem" className={itemClass} onClick={abLoop.onClear}>
          <span className="w-4" />
          Clear A–B loop
        </button>
      )}
      <button type="button" role="menuitem" className={itemClass} onClick={onMoment}>
        <BookmarkPlus size={14} aria-hidden="true" className="text-gold-ink" />
        <span className="flex-1">Save moment here</span>
        <kbd className="font-mono text-[10px] text-white/50">B</kbd>
      </button>
      <button type="button" role="menuitem" className={itemClass} onClick={onEnqueue}>
        <ListPlus size={14} aria-hidden="true" className="text-white/60" />
        <span className="flex-1">Add to queue</span>
        <kbd className="font-mono text-[10px] text-white/50">⇧Q</kbd>
      </button>
      {pip?.supported && (
        <button type="button" role="menuitem" className={cn(itemClass, 'sm:hidden')} onClick={pip.toggle}>
          <PictureInPicture2 size={14} aria-hidden="true" className={pip.active ? 'text-heat' : 'text-white/60'} />
          {pip.active ? 'Exit picture-in-picture' : 'Picture-in-picture'}
        </button>
      )}
      <button type="button" role="menuitem" className={itemClass} onClick={onShortcuts}>
        <Keyboard size={14} aria-hidden="true" className="text-white/60" />
        <span className="flex-1">Keyboard shortcuts</span>
        <kbd className="font-mono text-[10px] text-white/50">?</kbd>
      </button>
    </div>
  )
}
