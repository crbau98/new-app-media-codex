import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { bufferedSegments, clamp, formatTime, spriteTile } from '@/lib/player/controls'
import type { SpriteGrid } from '@/lib/player/intel'
import type { VideoState } from './hooks'
import './player.css'

interface ScrubberProps {
  video: HTMLVideoElement | null
  state: VideoState
  spriteUrl?: string
  spriteGrid?: SpriteGrid
  /** A–B loop markers in seconds. */
  loopA: number | null
  loopB: number | null
  onScrubStart?: () => void
  onScrubEnd?: () => void
}

/** Imperative element write, kept out of render-analysed scope. */
function seekTo(video: HTMLVideoElement, time: number) {
  video.currentTime = time
}

const PREVIEW_W = 160
const PREVIEW_H = 90

/**
 * Seek bar with ARIA slider semantics, buffered ranges, pointer-drag scrubbing
 * and a hover/drag preview (storyboard sprite tile when supplied, else a time
 * tooltip). The visual track is thin but the hit area is 44px tall.
 */
export default function Scrubber({ video, state, spriteUrl, spriteGrid, loopA, loopB, onScrubStart, onScrubEnd }: ScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  const [trackWidth, setTrackWidth] = useState(0)
  const draggingRef = useRef(false)

  const { duration, currentTime } = state
  const ratioFromEvent = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    setTrackWidth((width) => (width === rect.width ? width : rect.width))
    return clamp((clientX - rect.left) / rect.width, 0, 1)
  }, [])

  const commit = useCallback(
    (ratio: number) => {
      if (video && duration > 0) seekTo(video, ratio * duration)
    },
    [video, duration],
  )

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!duration) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = true
    onScrubStart?.()
    setDragRatio(ratioFromEvent(event.clientX))
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const ratio = ratioFromEvent(event.clientX)
    if (draggingRef.current) setDragRatio(ratio)
    else if (event.pointerType !== 'touch') setHoverRatio(ratio)
  }
  const endDrag = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancelled) commit(ratioFromEvent(event.clientX))
    setDragRatio(null)
    onScrubEnd?.()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!video || !duration) return
    let next: number | null = null
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = currentTime - 5
        break
      case 'ArrowRight':
      case 'ArrowUp':
        next = currentTime + 5
        break
      case 'PageDown':
        next = currentTime - duration * 0.1
        break
      case 'PageUp':
        next = currentTime + duration * 0.1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = duration
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
    seekTo(video, clamp(next, 0, duration))
  }

  const shownRatio = dragRatio ?? (duration > 0 ? currentTime / duration : 0)
  const previewRatio = dragRatio ?? hoverRatio
  const previewTime = previewRatio !== null ? previewRatio * duration : 0
  const tile = previewRatio !== null && spriteUrl && spriteGrid ? spriteTile(previewTime, duration, spriteGrid.cols, spriteGrid.rows) : null
  const segments = bufferedSegments(state.buffered, duration)

  // Keep the preview bubble inside the track without measuring on every move.
  const bubbleW = tile ? PREVIEW_W : 56
  const bubbleLeft =
    previewRatio !== null && trackWidth > 0 ? clamp(previewRatio * trackWidth - bubbleW / 2, 0, Math.max(0, trackWidth - bubbleW)) : 0

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, Math.round(duration))}
      aria-valuenow={Math.round(dragRatio !== null ? dragRatio * duration : currentTime)}
      aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
      className="mc-scrub group/scrub relative flex h-11 w-full cursor-pointer touch-none select-none items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-heat/80"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endDrag(event, false)}
      onPointerCancel={(event) => endDrag(event, true)}
      onPointerLeave={() => setHoverRatio(null)}
      onKeyDown={onKeyDown}
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] duration-150 group-hover/scrub:h-1.5 group-focus-visible/scrub:h-1.5 group-active/scrub:h-1.5">
        {segments.map((segment, index) => (
          <div key={index} className="absolute inset-y-0 bg-white/30" style={{ left: `${segment.left * 100}%`, width: `${segment.width * 100}%` }} />
        ))}
        {loopA !== null && duration > 0 && (
          <div
            className="absolute inset-y-0 bg-heat/30"
            style={{ left: `${(loopA / duration) * 100}%`, width: `${(((loopB ?? currentTime) - loopA) / duration) * 100}%` }}
          />
        )}
        <div className="absolute inset-y-0 left-0 rounded-full bg-heat" style={{ width: `${shownRatio * 100}%` }} />
      </div>
      <div
        className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow-[0_0_0_4px_rgb(var(--heat)/0.35)] transition-opacity group-hover/scrub:opacity-100 group-focus-visible/scrub:opacity-100 group-active/scrub:opacity-100"
        style={{ left: `${shownRatio * 100}%` }}
        aria-hidden="true"
      />
      {previewRatio !== null && duration > 0 && (
        <div
          className="pointer-events-none absolute bottom-full mb-1 flex flex-col items-center gap-1"
          style={{ left: bubbleLeft, width: bubbleW }}
          aria-hidden="true"
        >
          {tile && spriteUrl && (
            <div
              className="overflow-hidden rounded-md border border-white/15 bg-black shadow-lg"
              style={{
                width: PREVIEW_W,
                height: PREVIEW_H,
                backgroundImage: `url("${spriteUrl.replace(/"/g, '%22')}")`,
                backgroundSize: `${(spriteGrid?.cols ?? 1) * 100}% ${(spriteGrid?.rows ?? 1) * 100}%`,
                backgroundPosition: `${tile.x}% ${tile.y}%`,
              }}
            />
          )}
          <span className="rounded-md bg-black/80 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-white">{formatTime(previewTime)}</span>
        </div>
      )}
    </div>
  )
}
