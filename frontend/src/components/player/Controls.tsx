import type { ReactNode } from 'react'
import {
  BookmarkPlus,
  Camera,
  ListVideo,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RectangleHorizontal,
  Settings2,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { clamp, formatTime } from '@/lib/player/controls'
import type { SpriteGrid } from '@/lib/player/intel'
import { cn } from '@/lib/utils'
import Scrubber, { type ScrubMarker } from './Scrubber'
import type { VideoState } from './hooks'

export interface ControlsProps {
  video: HTMLVideoElement | null
  state: VideoState
  visible: boolean
  spriteUrl?: string
  spriteGrid?: SpriteGrid
  onTogglePlay: () => void
  onVolume: (volume: number) => void
  onMute: () => void
  menuOpen: boolean
  onMenuToggle: () => void
  pip: { supported: boolean; active: boolean; toggle: () => void }
  fullscreen: { supported: boolean; active: boolean; toggle: () => void }
  theatre?: { active: boolean; toggle: () => void }
  capture: { ready: boolean; busy: boolean; onCapture: () => void }
  /** Loop markers painted on the scrubber. */
  abLoop: { a: number | null; b: number | null }
  onScrubChange?: (scrubbing: boolean) => void
  /** Skip-to-next button (queue or sibling list); omitted when there is nothing next. */
  onNext?: () => void
  nextTitle?: string
  /** Bookmark the current time (or the A–B range as a clip). */
  onMoment: () => void
  momentIsClip: boolean
  /** Saved moments painted as ticks on the scrubber. */
  markers: ScrubMarker[]
  queue?: { count: number; onOpen: () => void }
}

const btn =
  'inline-grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/90 outline-none transition-[background-color,color,transform] hover:bg-white/12 hover:text-white active:scale-95 focus-visible:ring-2 focus-visible:ring-heat/80 disabled:opacity-40'

function IconButton({ label, pressed, onClick, disabled, children, className }: { label: string; pressed?: boolean; onClick: () => void; disabled?: boolean; children: ReactNode; className?: string }) {
  return (
    <button type="button" className={cn(btn, pressed && 'text-heat', className)} aria-label={label} aria-pressed={pressed} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

/** Bottom control bar: transport, scrubber, volume, time, settings, PiP, theatre, fullscreen. */
export default function Controls(props: ControlsProps) {
  const { video, state, visible, spriteUrl, spriteGrid } = props
  const VolumeIcon = state.muted || state.volume === 0 ? VolumeX : state.volume < 0.5 ? Volume1 : Volume2

  return (
    <div
      className={cn(
        'mc-controls absolute inset-x-0 bottom-0 z-20 px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-16 transition-opacity duration-200 sm:px-3',
        'bg-gradient-to-t from-black/85 via-black/45 to-transparent',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <Scrubber
        video={video}
        state={state}
        spriteUrl={spriteUrl}
        spriteGrid={spriteGrid}
        loopA={props.abLoop.a}
        loopB={props.abLoop.b}
        markers={props.markers}
        onScrubStart={() => props.onScrubChange?.(true)}
        onScrubEnd={() => props.onScrubChange?.(false)}
      />
      <div className="-mt-1 flex items-center gap-0.5">
        <IconButton label={state.paused ? 'Play' : 'Pause'} onClick={props.onTogglePlay}>
          {state.paused ? <Play size={20} strokeWidth={1.75} fill="currentColor" aria-hidden="true" /> : <Pause size={20} strokeWidth={1.75} fill="currentColor" aria-hidden="true" />}
        </IconButton>

        {props.onNext && (
          <IconButton label={props.nextTitle ? `Next: ${props.nextTitle}` : 'Next'} onClick={props.onNext}>
            <SkipForward size={19} strokeWidth={1.75} fill="currentColor" aria-hidden="true" />
          </IconButton>
        )}

        <div className="group/vol flex items-center">
          <IconButton label={state.muted ? 'Unmute' : 'Mute'} onClick={props.onMute}>
            <VolumeIcon size={19} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={state.muted ? 0 : state.volume}
            aria-label="Volume"
            onChange={(event) => props.onVolume(clamp(Number(event.target.value), 0, 1))}
            className="mc-range hidden h-11 w-0 opacity-0 transition-[width,opacity] duration-200 focus-visible:w-20 focus-visible:opacity-100 group-hover/vol:w-20 group-hover/vol:opacity-100 md:block"
            style={{ ['--fill' as string]: `${(state.muted ? 0 : state.volume) * 100}%` }}
          />
        </div>

        <span className="ml-1.5 select-none font-mono text-[11px] tabular-nums text-white/85 sm:text-xs" aria-hidden="true">
          {formatTime(state.currentTime)} <span className="text-white/45">/ {formatTime(state.duration)}</span>
        </span>

        <span className="flex-1" />

        <IconButton label={props.momentIsClip ? 'Save A–B range as a clip (B)' : 'Save moment (B)'} onClick={props.onMoment}>
          <BookmarkPlus size={19} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>

        {props.queue && (
          <button
            type="button"
            className={cn(btn, 'relative hidden sm:inline-grid')}
            aria-label={props.queue.count > 0 ? `Open queue (${props.queue.count} up next)` : 'Open queue'}
            title="Queue (Q)"
            onClick={props.queue.onOpen}
          >
            <ListVideo size={19} strokeWidth={1.75} aria-hidden="true" />
            {props.queue.count > 0 && (
              <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-heat px-1 font-mono text-[9px] font-semibold leading-4 text-canvas" aria-hidden="true">
                {props.queue.count > 99 ? '99+' : props.queue.count}
              </span>
            )}
          </button>
        )}

        {props.capture.ready && (
          <IconButton label="Capture current frame" onClick={props.capture.onCapture} disabled={props.capture.busy} className="hidden sm:inline-grid">
            <Camera size={18} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        )}

        <IconButton label="Settings" pressed={props.menuOpen} onClick={props.onMenuToggle}>
          <Settings2 size={19} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>

        {props.pip.supported && (
          <IconButton label={props.pip.active ? 'Exit picture-in-picture' : 'Picture-in-picture'} pressed={props.pip.active} onClick={props.pip.toggle} className="hidden sm:inline-grid">
            <PictureInPicture2 size={18} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        )}
        {props.theatre && (
          <IconButton label={props.theatre.active ? 'Exit theatre mode' : 'Theatre mode'} pressed={props.theatre.active} onClick={props.theatre.toggle} className="hidden lg:inline-grid">
            <RectangleHorizontal size={19} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        )}
        {props.fullscreen.supported && (
          <IconButton label={props.fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'} onClick={props.fullscreen.toggle}>
            {props.fullscreen.active ? <Minimize size={19} strokeWidth={1.75} aria-hidden="true" /> : <Maximize size={19} strokeWidth={1.75} aria-hidden="true" />}
          </IconButton>
        )}
      </div>
    </div>
  )
}
