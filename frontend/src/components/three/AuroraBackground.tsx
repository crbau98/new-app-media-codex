import { lazy, Suspense, useState } from 'react'
import { useMotionOk } from '@/hooks/useMotionOk'
import { cn } from '@/lib/utils'

const AuroraCanvas = lazy(() => import('./AuroraCanvas'))

export interface AuroraBackgroundProps {
  className?: string
  /** Pin to the viewport (app shell / gate) instead of filling the parent. */
  fixed?: boolean
  /** Spectrum strength, 0–1.5 (default 1). */
  intensity?: number
  /** Subtle pointer parallax (default true). */
  parallax?: boolean
  /** Internal render scale vs CSS pixels, before the DPR cap (default 0.4). */
  resolution?: number
  /** Frame cap (default 30). */
  fps?: number
  /** Never mount WebGL; render the static gradient only. */
  staticOnly?: boolean
}

/**
 * Decorative aurora. Always paints the static CSS gradient (`.aurora-fallback`),
 * then — when motion is allowed and WebGL works — lazily mounts the shader
 * canvas and cross-fades it in. Decorative: aria-hidden, pointer-events none.
 */
export default function AuroraBackground({
  className,
  fixed = false,
  intensity = 1,
  parallax = true,
  resolution = 0.4,
  fps = 30,
  staticOnly = false,
}: AuroraBackgroundProps) {
  const motionOk = useMotionOk()
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const live = motionOk && !failed && !staticOnly

  return (
    <div
      aria-hidden="true"
      className={cn(
        'aurora-fallback pointer-events-none inset-0 overflow-hidden',
        fixed ? 'fixed' : 'absolute',
        className,
      )}
    >
      {live && (
        <div className={cn('absolute inset-0 transition-opacity duration-1000', ready ? 'opacity-100' : 'opacity-0')}>
          <Suspense fallback={null}>
            <AuroraCanvas
              intensity={intensity}
              parallax={parallax}
              resolution={resolution}
              fps={fps}
              onReady={() => setReady(true)}
              onUnsupported={() => setFailed(true)}
            />
          </Suspense>
        </div>
      )}
    </div>
  )
}
