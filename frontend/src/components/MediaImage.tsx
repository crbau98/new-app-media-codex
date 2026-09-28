import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolveMediaAssetUrl } from '@/lib/backendOrigin'
import { safeColor, safeImageSrc } from '@/lib/player/intel'
import { backoffDelay } from '@/lib/player/resilience'
import { cn } from '@/lib/utils'

const CANDIDATE_TIMEOUT_MS = 7000
const DEFAULT_MAX_RETRIES = 2

interface MediaImageProps {
  /** Ordered image candidates. The first reachable URL wins; later URLs are fallbacks. */
  sources: Array<string | null | undefined>
  alt: string
  className?: string
  skeletonClassName?: string
  loading?: 'lazy' | 'eager'
  fetchPriority?: 'auto' | 'high' | 'low'
  decoding?: 'async' | 'auto' | 'sync'
  /** Increment to force the whole candidate waterfall to run again. */
  retryToken?: string | number
  onLoad?: () => void
  onExhausted?: () => void
  /** Tiny blurred preview (data: URI or URL) shown until the real image is decoded. */
  lqip?: string
  /** Average colour shown behind/before the image (hex or rgb()/hsl()). */
  dominantColor?: string
  /** width / height when known; reserves space and prevents layout shift. */
  aspect?: number
  /** Extra full passes over the candidate list (with exponential backoff) before giving up. Default 2. */
  maxRetries?: number
}

interface MediaImageInnerProps extends Omit<MediaImageProps, 'sources' | 'retryToken'> {
  candidates: string[]
}

export function mediaImageCandidates(sources: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const source of sources) {
    const resolved = resolveMediaAssetUrl(source)
    if (!resolved || seen.has(resolved)) continue
    seen.add(resolved)
    output.push(resolved)
  }
  return output
}

function MediaImageInner({
  candidates,
  alt,
  className,
  skeletonClassName,
  loading = 'lazy',
  fetchPriority = 'auto',
  decoding = 'async',
  onLoad,
  onExhausted,
  lqip,
  dominantColor,
  aspect,
  maxRetries = DEFAULT_MAX_RETRIES,
}: MediaImageInnerProps) {
  const [index, setIndex] = useState(0)
  const [cycle, setCycle] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [waiting, setWaiting] = useState(false)
  // Lazy images only start their failure timers once near the viewport, so an
  // off-screen tile the browser has deliberately not fetched never "fails".
  const [visible, setVisible] = useState(() => loading === 'eager' || typeof IntersectionObserver === 'undefined')
  const imgRef = useRef<HTMLImageElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aliveRef = useRef(true)

  const onExhaustedRef = useRef(onExhausted)
  const onLoadRef = useRef(onLoad)
  useEffect(() => {
    onExhaustedRef.current = onExhausted
    onLoadRef.current = onLoad
  }, [onExhausted, onLoad])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
      if (retryRef.current !== null) clearTimeout(retryRef.current)
    }
  }, [])

  useEffect(() => {
    if (visible) return undefined
    const node = imgRef.current
    if (!node) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '320px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible, index, cycle])

  const clearTimers = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  /** Next candidate → next pass (with exponential backoff) → exhausted. */
  const advance = useCallback(() => {
    clearTimers()
    setLoaded(false)
    if (index + 1 < candidates.length) {
      setIndex(index + 1)
      return
    }
    if (cycle < maxRetries) {
      setWaiting(true)
      retryRef.current = setTimeout(() => {
        retryRef.current = null
        if (!aliveRef.current) return
        setWaiting(false)
        setIndex(0)
        setCycle((value) => value + 1)
      }, backoffDelay(cycle, 600, 6000))
      return
    }
    setExhausted(true)
    onExhaustedRef.current?.()
  }, [candidates.length, clearTimers, cycle, index, maxRetries])

  const advanceRef = useRef(advance)
  useEffect(() => {
    advanceRef.current = advance
  }, [advance])

  useEffect(() => {
    if (exhausted || loaded || waiting || !visible) return undefined
    timeoutRef.current = setTimeout(() => advanceRef.current(), CANDIDATE_TIMEOUT_MS)
    return clearTimers
  }, [index, cycle, loaded, exhausted, waiting, visible, clearTimers])

  if (exhausted) return null

  const handleLoad = () => {
    clearTimers()
    const node = imgRef.current
    const reveal = () => {
      if (!aliveRef.current) return
      setLoaded(true)
      onLoadRef.current?.()
    }
    // Decode off-thread before the fade so large photos never jank the reveal.
    if (node && typeof node.decode === 'function') node.decode().then(reveal, reveal)
    else reveal()
  }

  const hasExplicitOpacity = Boolean(className && className.includes('opacity-'))
  const color = safeColor(dominantColor)
  const preview = safeImageSrc(lqip)
  const hasPlaceholderArt = Boolean(color || preview)

  return (
    <>
      <img
        key={`${cycle}:${index}:${candidates[index]}`}
        ref={imgRef}
        src={candidates[index]}
        alt={alt}
        className={cn(className, !hasExplicitOpacity && (loaded ? 'opacity-100' : 'opacity-0'), !hasExplicitOpacity && 'transition-opacity duration-300')}
        style={aspect && aspect > 0 ? { aspectRatio: String(aspect) } : undefined}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding={decoding}
        referrerPolicy="no-referrer"
        draggable={false}
        onLoad={handleLoad}
        onError={advance}
      />
      {!loaded &&
        (hasPlaceholderArt ? (
          <div
            className={cn('relative overflow-hidden', skeletonClassName)}
            style={{ backgroundColor: color, aspectRatio: aspect && aspect > 0 && !skeletonClassName?.includes('absolute') ? String(aspect) : undefined }}
            aria-hidden="true"
          >
            {preview && (
              <div
                className="absolute -inset-3 bg-cover bg-center"
                style={{ backgroundImage: `url("${preview.replace(/"/g, '%22')}")`, filter: 'blur(14px) saturate(1.15)', transform: 'scale(1.08)' }}
              />
            )}
          </div>
        ) : (
          <div className={cn('skeleton-tile rounded-none', skeletonClassName)} aria-hidden="true" />
        ))}
    </>
  )
}

/**
 * Robust image renderer for source media: walks thumbnail/full-size candidates,
 * retries the whole waterfall with capped exponential backoff, and reports
 * exhaustion so callers can show a retry affordance instead of a blank tile.
 * Supports LQIP / dominant-colour blur-up, decode-before-reveal and an
 * optional `aspect` that reserves layout space. Per-candidate timeout (~7 s,
 * started once the image is near the viewport) advances hung CDN connections.
 */
export default function MediaImage(props: MediaImageProps) {
  const candidates = useMemo(() => mediaImageCandidates(props.sources), [props.sources])
  if (!candidates.length) return null
  return <MediaImageInner key={`${candidates.join('|')}:${props.retryToken ?? 0}`} {...props} candidates={candidates} />
}
