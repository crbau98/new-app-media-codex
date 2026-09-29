import { Fragment, useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ExternalLink, Play, RefreshCw } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { formatMetric, relativeTime } from '@/lib/discovery'
import MediaImage from './MediaImage'
import GrainOverlay from './GrainOverlay'
import Coverflow3D from './three/Coverflow3D'
import { useMotionOk } from '@/hooks/useMotionOk'
import { cn } from '@/lib/utils'

const ROTATION_MS = 6000
const SLIDE_COUNT = 8

/**
 * Display headline with a per-character entrance cascade. The heading remounts
 * per slide (keyed by slide id) so the cascade replays on rotation. Words stay
 * unbroken; the accessible name is the plain title string.
 */
function CascadeTitle({ text, slideKey }: { text: string; slideKey: string }) {
  const words = text.split(/\s+/).filter(Boolean)
  let charIndex = 0
  return (
    <h2
      key={slideKey}
      aria-label={text}
      className="display-title mt-4 max-w-2xl text-[34px] text-ink [overflow-wrap:anywhere] [perspective:600px] sm:text-5xl lg:text-[3.5rem]"
    >
      {words.map((word, wordIndex) => (
        // max-w-full + overflow-wrap keeps words whole when they fit, but lets
        // a pathological unbroken token wrap instead of clipping off-screen.
        <Fragment key={wordIndex}>
          <span aria-hidden="true" className="inline-block max-w-full [overflow-wrap:anywhere]">
            {[...word].map((char) => {
              // Cap the stagger so long titles don't delay the tail excessively.
              const index = Math.min(charIndex, 36)
              charIndex += 1
              return (
                <span key={charIndex} className="hero-char" style={{ '--char-index': index } as CSSProperties}>
                  {char}
                </span>
              )
            })}
          </span>
          {wordIndex < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </h2>
  )
}

interface HeroProps {
  items: MediaItem[]
  loading?: boolean
  error?: Error | null
  onRetry?: () => void
  onSelect: (item: MediaItem) => void
  /** Optional: override the mono eyebrow prefix (default "Live now"). */
  eyebrow?: string
  /** Optional: render the 3D coverflow stage (default true). */
  coverflow?: boolean
  /** Optional: rotate slides automatically (default true). */
  autoplay?: boolean
}

/**
 * Cinematic hero: blurred artwork backdrop with pointer parallax, a
 * cursor-follow champagne spotlight, a display-serif headline that cascades in,
 * a spectrum hairline, and a 3D coverflow that drives the featured slide.
 * Depth effects are pointer-driven CSS variables (no re-render) and disabled
 * with reduced motion.
 */
export default function Hero({
  items,
  loading,
  error,
  onRetry,
  onSelect,
  eyebrow = 'Live now',
  coverflow = true,
  autoplay = true,
}: HeroProps) {
  const slides = useMemo(() => items.slice(0, SLIDE_COUNT), [items])
  const [index, setIndex] = useState(0)
  const motionOk = useMotionOk()
  const rootRef = useRef<HTMLElement>(null)
  const frame = useRef(0)

  // Derive a valid index even if the slide list shrank between renders.
  const safeIndex = slides.length ? index % slides.length : 0
  const current = slides[safeIndex]

  const handleSelectId = useCallback(
    (id: string) => {
      const item = slides.find((slide) => slide.id === id)
      if (item) onSelect(item)
    },
    [slides, onSelect],
  )

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!motionOk || event.pointerType === 'touch') return
    const { clientX, clientY } = event
    if (frame.current) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const node = rootRef.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      const x = (clientX - rect.left) / rect.width
      const y = (clientY - rect.top) / rect.height
      node.style.setProperty('--spot-x', `${clientX - rect.left}px`)
      node.style.setProperty('--spot-y', `${clientY - rect.top}px`)
      node.style.setProperty('--spot-o', '1')
      node.style.setProperty('--px', ((x - 0.5) * 2).toFixed(3))
      node.style.setProperty('--py', ((y - 0.5) * 2).toFixed(3))
    })
  }
  const onPointerLeave = () => {
    if (frame.current) cancelAnimationFrame(frame.current)
    const node = rootRef.current
    if (!node) return
    node.style.setProperty('--spot-o', '0')
    node.style.setProperty('--px', '0')
    node.style.setProperty('--py', '0')
  }

  const showStage = coverflow && !loading && !error && slides.length > 0

  return (
    <section
      ref={rootRef}
      aria-roledescription="carousel"
      aria-label="Featured live media"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className="spotlight spectrum-border relative isolate overflow-hidden rounded-[22px] bg-sunken shadow-soft"
      style={{ '--spot-r': '460px' } as CSSProperties}
    >
      <div className="relative min-h-[560px] lg:min-h-[500px]">
        {/* Backdrop — blurred artwork, parallax-shifted, cross-faded per slide */}
        <div
          className="absolute -inset-10"
          style={{
            transform: 'translate3d(calc(var(--px, 0) * -14px), calc(var(--py, 0) * -10px), 0) scale(1.06)',
            transition: 'transform 0.6s cubic-bezier(0.16,1,0.3,1)',
          }}
          aria-hidden="true"
        >
          {slides.map((slide, slideIndex) => (
            <div
              key={slide.id}
              className={cn('absolute inset-0 transition-opacity duration-1000', slideIndex === safeIndex ? 'opacity-60' : 'opacity-0')}
            >
              <MediaImage
                sources={[slide.thumbnail]}
                alt=""
                loading={slideIndex === 0 ? 'eager' : 'lazy'}
                className="h-full w-full scale-110 object-cover blur-2xl saturate-125"
                skeletonClassName="absolute inset-0"
              />
            </div>
          ))}
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(105deg,rgb(var(--canvas)/0.94)_0%,rgb(var(--canvas)/0.62)_46%,rgb(var(--canvas)/0.2)_100%)]" aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/30 to-transparent" aria-hidden="true" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_80%_at_85%_10%,rgb(var(--aurora-5)/0.22),transparent_70%)]" aria-hidden="true" />
        <GrainOverlay />
        <span className="edge-label absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 xl:block" aria-hidden="true">
          Public archive · live feed
        </span>

        {/* Content */}
        <div
          className={cn(
            'relative z-[2] grid min-h-[560px] items-center gap-6 p-6 md:p-10 lg:min-h-[500px] lg:gap-10',
            showStage ? 'lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]' : 'lg:grid-cols-1',
          )}
        >
          <div
            className="min-w-0"
            style={{ transform: 'translate3d(calc(var(--px, 0) * 6px), calc(var(--py, 0) * 4px), 0)', transition: 'transform 0.5s cubic-bezier(0.16,1,0.3,1)' }}
          >
            {loading ? (
              <div className="space-y-3" aria-hidden="true">
                <div className="skeleton-tile !aspect-auto h-3 w-40 rounded-sm" />
                <div className="skeleton-tile !aspect-auto h-12 w-3/4 rounded-sm" />
                <div className="skeleton-tile !aspect-auto h-3 w-56 rounded-sm" />
              </div>
            ) : error ? (
              <div className="max-w-md">
                <p className="eyebrow text-heat">Feed unavailable</p>
                <p className="mt-2 text-sm leading-6 text-ink-2">
                  The live archive could not be reached. Check your connection and try again.
                </p>
                {onRetry && (
                  <button onClick={onRetry} className="btn-secondary mt-4">
                    <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" /> Retry
                  </button>
                )}
              </div>
            ) : current ? (
              <>
                <p className="eyebrow flex items-center gap-2.5 !text-ink-2">
                  <span className="live-dot" aria-hidden="true" />
                  {eyebrow} · {current.source}
                </p>
                <div className="mt-3 h-px w-24 bg-[linear-gradient(90deg,rgb(var(--aurora-1)),rgb(var(--aurora-2)),rgb(var(--aurora-3)),rgb(var(--aurora-4)),rgb(var(--aurora-5)))]" aria-hidden="true" />
                <CascadeTitle text={current.title} slideKey={current.id} />
                <p className="mono-meta mt-4 uppercase">
                  @{current.creator}
                  {'  ·  '}
                  {current.isVideo ? `${current.duration} video` : 'photo'}
                  {'  ·  '}
                  {formatMetric(current.views)} views
                  {'  ·  '}
                  {relativeTime(current.createdAt)}
                </p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <button onClick={() => onSelect(current)} className="btn-primary min-h-11 px-6">
                    <Play size={14} strokeWidth={1.75} fill="currentColor" aria-hidden="true" /> Play
                  </button>
                  {current.pageUrl && (
                    <a href={current.pageUrl} target="_blank" rel="noreferrer" className="btn-secondary min-h-11 px-5">
                      Open on source <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
                    </a>
                  )}
                </div>
                {slides.length > 1 && (
                  <p className="mt-6 font-mono text-[11px] tracking-[0.14em] text-ink-3" aria-hidden="true">
                    {String(safeIndex + 1).padStart(2, '0')} <span className="text-gold/70">/</span> {String(slides.length).padStart(2, '0')}
                  </p>
                )}
              </>
            ) : (
              <div className="max-w-md">
                <p className="eyebrow">Archive idle</p>
                <p className="mt-2 text-sm leading-6 text-ink-2">
                  No featured media yet — the feed will populate as sources connect.
                </p>
              </div>
            )}
          </div>

          {showStage && (
            <div
              className="-mx-6 min-w-0 md:-mx-10 lg:mx-0"
              style={{
                transform: 'perspective(1400px) rotateY(calc(var(--px, 0) * -3deg)) rotateX(calc(var(--py, 0) * 2deg))',
                transition: 'transform 0.6s cubic-bezier(0.16,1,0.3,1)',
              }}
            >
              <Coverflow3D
                items={slides}
                onSelect={handleSelectId}
                onActiveChange={setIndex}
                autoplay={autoplay}
                autoplayMs={ROTATION_MS}
                showCaption={false}
                aria-label="Featured media — coverflow"
              />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
