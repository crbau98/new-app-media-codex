import { useEffect, useRef } from 'react'
import { Check, Repeat, Sparkles } from 'lucide-react'
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
  abLoop: { a: number | null; b: number | null; onMark: () => void; onClear: () => void }
  onClose: () => void
}

function SectionTitle({ children }: { children: string }) {
  return <h4 className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">{children}</h4>
}

const itemClass =
  'flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-white/90 outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-heat/70'

/** Glass settings popover: speed, quality, loop, A–B loop, ambient glow. */
export default function SettingsMenu({
  rate, onRate, qualityOptions, activeQuality, playingLabel, onQuality, loop, onLoop, ambient, abLoop, onClose,
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
      className="mc-menu pointer-events-auto max-h-full w-64 max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[rgb(14_12_20/0.86)] p-1.5 shadow-2xl backdrop-blur-xl"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          event.preventDefault()
          onClose()
        }
      }}
    >
      <SectionTitle>Speed</SectionTitle>
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
      <button type="button" role="menuitemcheckbox" aria-checked={loop} className={itemClass} onClick={onLoop}>
        <Repeat size={14} aria-hidden="true" className={loop ? 'text-heat' : 'text-white/60'} />
        <span className="flex-1">Loop video</span>
        <span className="font-mono text-[10px] uppercase text-white/50">{loop ? 'On' : 'Off'}</span>
      </button>
      <button type="button" role="menuitem" className={itemClass} onClick={abLoop.onMark}>
        <span className="grid h-4 w-4 place-items-center font-mono text-[10px] text-heat">AB</span>
        <span className="flex-1">{abLabel}</span>
      </button>
      {abLoop.a !== null && (
        <button type="button" role="menuitem" className={itemClass} onClick={abLoop.onClear}>
          <span className="w-4" />
          Clear A–B loop
        </button>
      )}
      {ambient.available && (
        <button type="button" role="menuitemcheckbox" aria-checked={ambient.enabled} className={itemClass} onClick={ambient.onToggle}>
          <Sparkles size={14} aria-hidden="true" className={ambient.enabled ? 'text-heat' : 'text-white/60'} />
          <span className="flex-1">Ambient glow</span>
          <span className="font-mono text-[10px] uppercase text-white/50">{ambient.enabled ? 'On' : 'Off'}</span>
        </button>
      )}
    </div>
  )
}
