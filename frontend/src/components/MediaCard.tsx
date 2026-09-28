import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Images, Play, RefreshCw } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { relativeTime, formatMetric } from '@/lib/discovery'
import { playbackIntent } from '@/lib/intent'
import { resolveMediaAssetUrl } from '@/lib/backendOrigin'
import MediaImage from '@/components/MediaImage'
import HoverPreviewVideo from '@/components/discovery/HoverPreviewVideo'
import { useFinePointer, useMotionOk } from '@/components/discovery/motion'
import { useDepthTilt } from '@/components/discovery/useDepthTilt'
import { hueFor, isFresh, previewSource, readMediaMeta } from '@/components/discovery/mediaMeta'
import { PREVIEW_DWELL_MS, previewAllowed, previewController } from '@/components/discovery/hoverPreview'
import { cn } from '@/lib/utils'
import '@/styles/discovery.css'

interface MediaCardProps {
  item: MediaItem
  /** CSS aspect-ratio override ("2/3"). Defaults to the item's own aspect. */
  aspectRatio?: string
  className?: string
  /** Extra wrapper style (grid engines pass explicit width/height here). */
  style?: CSSProperties
  onSelect?: (id: string) => void
  /** When true, loads the image eagerly with high fetch priority (use for first ~4 above-fold cards). */
  priority?: boolean
  /** Roving-focus support for grids. */
  tabIndex?: number
  dataIndex?: number
  /** Hide the creator chip (e.g. on a creator's own page). */
  hideCreator?: boolean
  /** Accessible name override (defaults to "Play/View <title> by <creator>"). */
  label?: string
  /** Resume progress (0-100) drawn as a bar along the bottom edge. */
  progress?: number
  /** Disable the pointer tilt + inline preview (e.g. inside a transformed 3D shelf). */
  flat?: boolean
}

/**
 * Cinematic media card. Poster fills the tile (dominant-colour / LQIP
 * placeholder, exact aspect => zero layout shift); title, creator and meta sit
 * on a scrim and lift on the Z axis under a desktop pointer tilt. Videos start
 * a muted inline preview after a short dwell (one at a time app-wide).
 */
function MediaCard({
  item,
  aspectRatio,
  className,
  style,
  onSelect,
  priority = false,
  tabIndex,
  dataIndex,
  hideCreator = false,
  flat = false,
  progress,
  label,
}: MediaCardProps) {
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [previewReady, setPreviewReady] = useState(false)
  const rootRef = useRef<HTMLButtonElement>(null)
  const dwellTimer = useRef<number | null>(null)

  const motionOk = useMotionOk()
  const finePointer = useFinePointer()
  const tiltOn = motionOk && finePointer && !flat
  useDepthTilt(rootRef, tiltOn, 7)

  const meta = useMemo(() => readMediaMeta(item), [item])
  const hue = useMemo(() => hueFor(item.id), [item.id])
  const previewUrl = useMemo(() => {
    const raw = previewSource(item)
    return raw ? resolveMediaAssetUrl(raw) : null
  }, [item])

  const handleRetry = useCallback(() => {
    setError(false)
    setLoaded(false)
    setRetryKey((value) => value + 1)
  }, [])

  const stopPreview = useCallback(() => {
    if (dwellTimer.current !== null) {
      window.clearTimeout(dwellTimer.current)
      dwellTimer.current = null
    }
    previewController.release(item.id)
    setPreviewing(false)
    setPreviewReady(false)
  }, [item.id])

  useEffect(() => stopPreview, [stopPreview])

  const onPointerEnter = (event: React.PointerEvent) => {
    playbackIntent.warmMetadata(item.thumbnail)
    if (flat || !previewUrl || event.pointerType !== 'mouse' || !motionOk || !finePointer || !previewAllowed()) return
    if (dwellTimer.current !== null) window.clearTimeout(dwellTimer.current)
    dwellTimer.current = window.setTimeout(() => {
      dwellTimer.current = null
      previewController.claim(item.id, stopPreview)
      setPreviewing(true)
    }, PREVIEW_DWELL_MS)
  }

  // Cards stay thumbnail-first for speed. Photos may fall back to the full-size
  // public media URL when a provider thumbnail is missing or temporarily 404s;
  // videos never use a stream URL as an <img> fallback.
  const imageSources = useMemo(
    () => (item.isVideo ? [item.thumbnail] : [item.thumbnail, item.mediaUrl]),
    [item.isVideo, item.thumbnail, item.mediaUrl]
  )

  const wrapperStyle: CSSProperties = { aspectRatio: aspectRatio ?? meta.aspect.toFixed(4), ...style }
  const surface: CSSProperties = {
    background: meta.dominantColor ?? `linear-gradient(155deg, hsl(${hue} 30% 20%), hsl(${(hue + 40) % 360} 34% 9%))`,
    ['--dc' as string]: meta.dominantColor ?? `hsl(${hue} 60% 40%)`,
  }
  const fresh = isFresh(item)
  const views = item.views > 0 ? `${formatMetric(item.views)} views` : ''

  return (
    <div className={cn('d-cardbox', className)} style={wrapperStyle}>
      <button
        ref={rootRef}
        type="button"
        data-testid={item.isVideo ? 'video-tile' : 'media-tile'}
        data-dcard=""
        data-index={dataIndex}
        data-loaded={loaded ? 'true' : 'false'}
        data-previewing={previewReady ? 'true' : 'false'}
        data-kind={item.isVideo ? 'video' : 'photo'}
        tabIndex={tabIndex}
        className="d-card d-tilt tap-highlight-none"
        style={surface}
        onClick={() => (error ? handleRetry() : onSelect?.(item.id))}
        onPointerEnter={onPointerEnter}
        onPointerLeave={stopPreview}
        onFocus={() => playbackIntent.warmMetadata(item.thumbnail)}
        onBlur={stopPreview}
        aria-label={error ? `Retry loading ${item.title}` : (label ?? `${item.isVideo ? 'Play' : 'View'} ${item.title} by ${item.creator}`)}
      >
        <span className="d-media" aria-hidden="true">
          {meta.lqip && !loaded && <span className="d-lqip" style={{ backgroundImage: `url("${meta.lqip}")` }} />}
          {!error ? (
            <MediaImage
              sources={imageSources}
              alt=""
              retryToken={retryKey}
              loading={priority ? 'eager' : 'lazy'}
              fetchPriority={priority ? 'high' : 'auto'}
              className="d-img absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
              skeletonClassName="absolute inset-0 !bg-transparent !animate-none opacity-0"
              onLoad={() => setLoaded(true)}
              onExhausted={() => setError(true)}
            />
          ) : (
            <span className="d-retry">
              <RefreshCw size={18} strokeWidth={1.75} />
              <span>Tap to retry</span>
            </span>
          )}
          {previewing && previewUrl && (
            <HoverPreviewVideo src={previewUrl} ready={previewReady} onReady={() => setPreviewReady(true)} onFail={stopPreview} />
          )}
          <span className="d-scrim" />
          {typeof progress === 'number' && progress > 0 && (
            <span className="d-progress">
              <span style={{ width: `${Math.min(100, progress)}%` }} />
            </span>
          )}
        </span>

        <span className="d-glare" aria-hidden="true" />

        <span className="d-top" aria-hidden="true">
          <span className="d-badges">
            {fresh && (
              <span className="d-pill d-pill-new">
                <span className="d-dot" /> New
              </span>
            )}
            {!item.isVideo && meta.galleryCount > 1 && (
              <span className="d-pill">
                <Images size={11} strokeWidth={2} /> {meta.galleryCount}
              </span>
            )}
          </span>
          <span className="d-badges">
            {meta.quality && <span className="d-pill d-pill-q">{meta.quality}</span>}
            {item.isVideo && (
              <span className="d-pill">
                <Play size={9} strokeWidth={0} fill="currentColor" />
                {item.duration}
              </span>
            )}
          </span>
        </span>

        {item.isVideo && (
          <span className="d-play" aria-hidden="true">
            <Play size={18} strokeWidth={0} fill="currentColor" />
          </span>
        )}

        <span className="d-info">
          {!hideCreator && (
            <span className="d-creator">
              <span className="d-avatar" style={{ background: `hsl(${hueFor(item.creator)} 42% 40%)` }}>
                {item.creator.charAt(0).toUpperCase()}
              </span>
              <span className="d-creator-name">@{item.creator}</span>
            </span>
          )}
          <span className="d-title">{item.title}</span>
          <span className="d-meta">
            <span className="d-source">{item.source}</span>
            <span aria-hidden="true">·</span>
            <span>{relativeTime(item.createdAt)}</span>
            {views && (
              <>
                <span aria-hidden="true" className="d-meta-views">·</span>
                <span className="d-meta-views">{views}</span>
              </>
            )}
          </span>
        </span>
      </button>
    </div>
  )
}

export default memo(MediaCard)
