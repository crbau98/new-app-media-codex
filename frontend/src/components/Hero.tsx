import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ExternalLink, Play, RefreshCw } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { formatMetric, relativeTime } from '@/lib/discovery'
import GrainOverlay from './GrainOverlay'
import { cn } from '@/lib/utils'

const ROTATION_MS = 6000
const SLIDE_COUNT = 5

/**
 * Display headline with a per-character entrance cascade. The heading remounts
 * per slide (keyed by slide id) so the cascade replays on rotation. Words stay
 * unbroken; the accessible name is the plain title string.
 */
function CascadeTitle({ text, slideKey }: { text: string; slideKey: string }) {
  const words = text.split(/\s+/).filter(Boolean)
  let charIndex = 0
  return (
    <h2 key={slideKey} aria-label={text} className="display-title mt-3 max-w-3xl text-3xl text-ink [overflow-wrap:anywhere] sm:text-4xl md:text-6xl">
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
}

/**
 * Cinematic rotating hero (brief §8): backdrop artwork + scrim + grain,
 * mono eyebrow, display headline, mono meta row, Play / Open-on-source,
 * mono slide index, 6s rotation. CSS-only fade transition.
 */
export default function Hero({ items, loading, error, onRetry, onSelect }: HeroProps) {
  const slides = useMemo(() => items.slice(0, SLIDE_COUNT), [items])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (slides.length < 2) return
    const timer = window.setInterval(() => {
      setIndex((value) => (value + 1) % slides.length)
    }, ROTATION_MS)
    return () => window.clearInterval(timer)
  }, [slides.length])

  // Derive a valid index even if the slide list shrank between renders.
  const safeIndex = slides.length ? index % slides.length : 0
  const current = slides[safeIndex]

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured live media"
      className="relative overflow-hidden rounded-lg border border-line bg-sunken"
    >
      <div className="relative min-h-[340px] md:min-h-[440px] lg:min-h-[480px]">
        {/* Backdrop — keyed img with CSS fade */}
        {slides.map((slide, slideIndex) => (
          <img
            key={slide.id}
            src={slide.thumbnail}
            alt=""
            loading={slideIndex === 0 ? 'eager' : 'lazy'}
            className={cn(
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-700',
              slideIndex === safeIndex ? 'opacity-50' : 'opacity-0'
            )}
          />
        ))}
        <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/40 to-canvas/10" aria-hidden="true" />
        <GrainOverlay />
        <span className="edge-label absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 lg:block" aria-hidden="true">
          Public archive · live feed
        </span>

        {/* Content */}
        <div className="relative z-10 flex min-h-[340px] flex-col justify-end p-5 md:min-h-[440px] md:p-8 lg:min-h-[480px]">
          {loading ? (
            <div className="space-y-3" aria-hidden="true">
              <div className="h-3 w-40 rounded-sm bg-sunken skeleton-tile !aspect-auto" />
              <div className="h-10 w-3/4 rounded-sm bg-sunken skeleton-tile !aspect-auto" />
              <div className="h-3 w-56 rounded-sm bg-sunken skeleton-tile !aspect-auto" />
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
              <p className="eyebrow flex items-center gap-2">
                <span className="live-dot" aria-hidden="true" />
                Live now · {current.source}
              </p>
              <CascadeTitle text={current.title} slideKey={current.id} />
              <p className="mono-meta mt-3 uppercase">
                @{current.creator}
                {'  ·  '}
                {current.isVideo ? `${current.duration} video` : 'photo'}
                {'  ·  '}
                {formatMetric(current.views)} views
                {'  ·  '}
                {relativeTime(current.createdAt)}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button onClick={() => onSelect(current)} className="btn-primary">
                  <Play size={14} strokeWidth={1.75} fill="currentColor" aria-hidden="true" /> Play
                </button>
                {current.pageUrl && (
                  <a href={current.pageUrl} target="_blank" rel="noreferrer" className="btn-secondary">
                    Open on source <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
                  </a>
                )}
              </div>
            </>
          ) : (
            <div className="max-w-md">
              <p className="eyebrow">Archive idle</p>
              <p className="mt-2 text-sm leading-6 text-ink-2">
                No featured media yet — the feed will populate as sources connect.
              </p>
            </div>
          )}

          {/* Index + dots */}
          {slides.length > 1 && (
            <div className="absolute right-5 top-5 z-10 flex items-center gap-1 md:bottom-8 md:right-8 md:top-auto">
              <span className="mr-2 font-mono text-[11px] tracking-[0.1em] text-ink-2" aria-hidden="true">
                {String(safeIndex + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
              </span>
              {slides.map((slide, slideIndex) => (
                <button
                  key={slide.id}
                  onClick={() => setIndex(slideIndex)}
                  className="grid h-10 w-10 place-items-center"
                  aria-label={`Go to slide ${slideIndex + 1}: ${slide.title}`}
                  aria-current={slideIndex === safeIndex}
                >
                  <span
                    className={cn(
                      'h-1 w-5 rounded-full transition-colors',
                      slideIndex === safeIndex ? 'bg-heat' : 'bg-line-strong hover:bg-ink-3'
                    )}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
