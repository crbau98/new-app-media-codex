import { useEffect, useMemo, useRef, useState } from 'react'
import { resolvePublicUrl } from '@/lib/backendOrigin'
import { cn } from '@/lib/utils'

const CANDIDATE_TIMEOUT_MS = 7000

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
}

interface MediaImageInnerProps extends Omit<MediaImageProps, 'sources' | 'retryToken'> {
  candidates: string[]
}

export function mediaImageCandidates(sources: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const source of sources) {
    // The Vercel edge proxy is same-origin for this SPA and must stay root-relative;
    // backend-hosted cache paths still resolve through the API origin helper.
    const resolved = source && source.startsWith('/api/archiver-proxy') ? source : resolvePublicUrl(source)
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
}: MediaImageInnerProps) {
  const [index, setIndex] = useState(0)
  const [cycle, setCycle] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep a stable ref to onExhausted so the timeout callback always calls the
  // latest version without needing it in the effect dependency array.
  const onExhaustedRef = useRef(onExhausted)
  useEffect(() => {
    onExhaustedRef.current = onExhausted
  }, [onExhausted])

  const advanceCandidate = () => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setLoaded(false)
    setIndex((value) => value + 1)
  }

  useEffect(() => {
    if (exhausted || loaded) return
    timeoutRef.current = setTimeout(() => {
      if (index + 1 < candidates.length) {
        advanceCandidate()
      } else if (cycle < 1) {
        if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
        timeoutRef.current = null
        setLoaded(false)
        setIndex(0)
        setCycle(1)
      } else {
        setExhausted(true)
        onExhaustedRef.current?.()
      }
    }, CANDIDATE_TIMEOUT_MS)
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [index, cycle, loaded, exhausted, candidates.length])

  if (exhausted) return null

  const handleError = () => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (index + 1 < candidates.length) {
      setLoaded(false)
      setIndex((value) => value + 1)
      return
    }
    if (cycle < 1) {
      // One clean remount of the full waterfall handles intermittent CDN 403/410s.
      setLoaded(false)
      setIndex(0)
      setCycle(1)
      return
    }
    setExhausted(true)
    onExhausted?.()
  }

  const hasExplicitOpacity = Boolean(className && className.includes('opacity-'))

  return (
    <>
      <img
        key={`${cycle}:${index}:${candidates[index]}`}
        src={candidates[index]}
        alt={alt}
        className={cn(className, !hasExplicitOpacity && (loaded ? 'opacity-100' : 'opacity-0'))}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding={decoding}
        referrerPolicy="no-referrer"
        draggable={false}
        onLoad={() => {
          if (timeoutRef.current !== null) {
            clearTimeout(timeoutRef.current)
            timeoutRef.current = null
          }
          setLoaded(true)
          onLoad?.()
        }}
        onError={handleError}
      />
      {!loaded && <div className={cn('skeleton-tile rounded-none', skeletonClassName)} aria-hidden="true" />}
    </>
  )
}

/**
 * Robust image renderer for source media: walks thumbnail/full-size candidates,
 * remounts transient failures once, and reports exhaustion so callers can show
 * a retry affordance instead of leaving a blank tile. Per-candidate timeout
 * (~7 s) advances to the next URL if a CDN connection hangs.
 */
export default function MediaImage(props: MediaImageProps) {
  const candidates = useMemo(() => mediaImageCandidates(props.sources), [props.sources])
  if (!candidates.length) return null
  return <MediaImageInner key={`${candidates.join('|')}:${props.retryToken ?? 0}`} {...props} candidates={candidates} />
}
