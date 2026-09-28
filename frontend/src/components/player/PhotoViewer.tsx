import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Download, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import MediaImage from '@/components/MediaImage'
import { resolveMediaAssetUrl } from '@/lib/backendOrigin'
import { readMediaIntel, safeColor } from '@/lib/player/intel'
import type { MediaItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useMotionOk } from './hooks'
import ZoomImage, { type ZoomHandle } from './ZoomImage'

interface Frame {
  url: string
  lqip?: string
  dominantColor?: string
  aspect?: number
}

export function photoFrames(item: MediaItem): Frame[] {
  const intel = readMediaIntel(item)
  if (intel.gallery.length) {
    return intel.gallery
      .map((frame) => ({
        url: resolveMediaAssetUrl(frame.url),
        lqip: frame.lqip,
        dominantColor: frame.dominantColor ?? intel.dominantColor,
        aspect: frame.width && frame.height ? frame.width / frame.height : undefined,
      }))
      .filter((frame) => Boolean(frame.url))
  }
  const url = resolveMediaAssetUrl(item.mediaUrl || item.thumbnail)
  return url ? [{ url, lqip: intel.lqip, dominantColor: intel.dominantColor, aspect: intel.aspect }] : []
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin
  } catch {
    return false
  }
}

function extensionFor(type: string, url: string): string {
  const fromType = /^image\/(jpeg|png|webp|avif|gif)/.exec(type)?.[1]
  if (fromType) return fromType === 'jpeg' ? 'jpg' : fromType
  const fromUrl = /\.(jpe?g|png|webp|avif|gif)(?:$|[?&])/i.exec(decodeURIComponent(url))?.[1]?.toLowerCase()
  return fromUrl ? (fromUrl === 'jpeg' ? 'jpg' : fromUrl) : 'jpg'
}

interface PhotoViewerProps {
  item: MediaItem
  index: number
  direction: 1 | -1
  onIndexChange: (next: number, direction: 1 | -1) => void
  /** Whether swiping/arrowing past the gallery edge can move to a sibling item. */
  canLeave: (direction: -1 | 1) => boolean
  onLeave: (direction: -1 | 1) => void
  className?: string
}

const toolbarButton =
  'grid h-11 w-11 place-items-center rounded-full bg-black/45 text-white/90 outline-none backdrop-blur-md transition-[background-color,transform] hover:bg-black/65 active:scale-95 focus-visible:ring-2 focus-visible:ring-heat/80 disabled:opacity-40'

/**
 * Full-quality photo lightbox: pinch/double-tap/wheel zoom with pan + inertia,
 * swipe or arrow between gallery frames (and hand off to sibling items at the
 * ends), neighbour preloading, blur-up from lqip/thumbnail, decode-before-reveal.
 */
export default function PhotoViewer({ item, index, direction, onIndexChange, canLeave, onLeave, className }: PhotoViewerProps) {
  const motionOk = useMotionOk()
  const addToast = useAppStore((state) => state.addToast)
  const frames = useMemo(() => photoFrames(item), [item])
  const zoomRef = useRef<ZoomHandle>(null)
  const [zoomed, setZoomed] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const safeIndex = Math.min(Math.max(index, 0), Math.max(0, frames.length - 1))
  const frame = frames[safeIndex]

  const canSwipe = useCallback(
    (dir: -1 | 1) => {
      const next = safeIndex + dir
      if (next >= 0 && next < frames.length) return true
      return canLeave(dir)
    },
    [canLeave, frames.length, safeIndex],
  )

  const move = useCallback(
    (dir: -1 | 1) => {
      const next = safeIndex + dir
      if (next >= 0 && next < frames.length) onIndexChange(next, dir)
      else if (canLeave(dir)) onLeave(dir)
    },
    [canLeave, frames.length, onIndexChange, onLeave, safeIndex],
  )

  // Preload + decode the neighbouring frames so swipes reveal instantly.
  useEffect(() => {
    if (frames.length < 2) return
    for (const offset of [1, -1]) {
      const neighbour = frames[safeIndex + offset]
      if (!neighbour) continue
      const image = new Image()
      image.decoding = 'async'
      image.referrerPolicy = 'no-referrer'
      image.src = neighbour.url
      void image.decode?.().catch(() => {})
    }
  }, [frames, safeIndex])

  // Frame keys: arrows step frames (the sheet's own handler skips photos with galleries).
  useEffect(() => {
    if (frames.length < 2) return undefined
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (event.key === '+' || event.key === '=') zoomRef.current?.zoomIn()
      else if (event.key === '-') zoomRef.current?.zoomOut()
      else if (event.key === '0') zoomRef.current?.reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [frames.length])

  const download = useCallback(async () => {
    if (!frame || downloading) return
    setDownloading(true)
    try {
      const response = await fetch(frame.url, { referrerPolicy: 'no-referrer' })
      if (!response.ok) throw new Error('download_failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'media-codex'
      anchor.href = url
      anchor.download = `${slug}-${safeIndex + 1}.${extensionFor(blob.type, frame.url)}`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1500)
    } catch {
      addToast({ type: 'error', title: 'Download failed', message: 'Open the image from its source instead.' })
    } finally {
      setDownloading(false)
    }
  }, [addToast, downloading, frame, item.title, safeIndex])

  if (!frame) return null
  const canDownload = isSameOrigin(frame.url)
  const color = safeColor(frame.dominantColor)

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div
        className="group/photo relative h-[min(62dvh,720px)] min-h-[260px] w-full overflow-hidden rounded-2xl bg-black/70 ring-1 ring-white/10 sm:shadow-[0_24px_70px_-24px_rgb(0_0_0/0.85)]"
        style={{ backgroundColor: color }}
      >
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={`${item.id}:${safeIndex}`}
            custom={direction}
            className="absolute inset-0"
            initial={motionOk ? { opacity: 0, x: direction * 48, scale: 0.98 } : { opacity: 0 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={motionOk ? { opacity: 0, x: direction * -48, scale: 0.98 } : { opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}
          >
            <ZoomImage
              ref={zoomRef}
              sources={[frame.url, item.thumbnail ? resolveMediaAssetUrl(item.thumbnail) : ''].filter(Boolean)}
              placeholderSrc={item.thumbnail ? resolveMediaAssetUrl(item.thumbnail) : undefined}
              lqip={frame.lqip}
              dominantColor={frame.dominantColor}
              aspect={frame.aspect}
              alt={frames.length > 1 ? `${item.title} — photo ${safeIndex + 1} of ${frames.length}` : item.title}
              canSwipe={canSwipe}
              onSwipe={move}
              onZoomChange={setZoomed}
            />
          </motion.div>
        </AnimatePresence>

        {frames.length > 1 && (
          <span className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-black/55 px-2.5 py-1 font-mono text-[11px] tabular-nums text-white backdrop-blur-md">
            {safeIndex + 1} / {frames.length}
          </span>
        )}

        <div className="absolute right-3 top-3 z-10 flex gap-1.5" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" className={toolbarButton} aria-label="Zoom in" onClick={() => zoomRef.current?.zoomIn()}>
            <ZoomIn size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button type="button" className={cn(toolbarButton, 'hidden sm:grid')} aria-label="Zoom out" onClick={() => zoomRef.current?.zoomOut()}>
            <ZoomOut size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {zoomed && (
            <button type="button" className={toolbarButton} aria-label="Reset zoom" onClick={() => zoomRef.current?.reset()}>
              <Maximize2 size={17} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
          {canDownload && (
            <button type="button" className={toolbarButton} aria-label="Download original" disabled={downloading} onClick={() => void download()}>
              <Download size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </div>

        {(frames.length > 1 || canLeave(-1) || canLeave(1)) && !zoomed && (
          <>
            <button
              type="button"
              aria-label={safeIndex > 0 || frames.length > 1 ? 'Previous photo' : 'Previous item'}
              disabled={!canSwipe(-1)}
              onClick={() => move(-1)}
              onPointerDown={(event) => event.stopPropagation()}
              className={cn(toolbarButton, 'absolute left-3 top-1/2 z-10 hidden -translate-y-1/2 opacity-0 transition-opacity group-hover/photo:opacity-100 focus-visible:opacity-100 sm:grid')}
            >
              <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={safeIndex < frames.length - 1 || frames.length > 1 ? 'Next photo' : 'Next item'}
              disabled={!canSwipe(1)}
              onClick={() => move(1)}
              onPointerDown={(event) => event.stopPropagation()}
              className={cn(toolbarButton, 'absolute right-3 top-1/2 z-10 hidden -translate-y-1/2 opacity-0 transition-opacity group-hover/photo:opacity-100 focus-visible:opacity-100 sm:grid')}
            >
              <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      {frames.length > 1 && (
        <div className="hide-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Photos in this set">
          {frames.map((entry, position) => (
            <button
              key={`${entry.url}:${position}`}
              type="button"
              role="tab"
              aria-selected={position === safeIndex}
              aria-label={`Photo ${position + 1}`}
              onClick={() => onIndexChange(position, position > safeIndex ? 1 : -1)}
              className={cn(
                'relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-sunken outline-none ring-offset-2 ring-offset-transparent transition-[transform,box-shadow,opacity] focus-visible:ring-2 focus-visible:ring-heat/80',
                position === safeIndex ? 'scale-100 opacity-100 ring-2 ring-heat' : 'opacity-60 hover:opacity-100',
              )}
            >
              <MediaImage sources={[entry.url]} alt="" className="absolute inset-0 h-full w-full object-cover" skeletonClassName="absolute inset-0" dominantColor={entry.dominantColor} lqip={entry.lqip} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
