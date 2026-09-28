import { useId } from 'react'
import { cn } from '@/lib/utils'

interface BrandMarkProps {
  size?: number
  className?: string
  /** Wordmark next to the mark. */
  wordmark?: boolean
  /** Hover spin + gleam (CSS, honors reduced motion). Default true. */
  animated?: boolean
}

/**
 * Codex mark: a faceted gold prism with a spectrum core. Pure SVG; on hover the
 * prism turns in 3D and a gleam crosses it. Wordmark is set in the display serif.
 */
export default function BrandMark({ size = 30, className, wordmark = false, animated = true }: BrandMarkProps) {
  const uid = useId().replace(/:/g, '')
  return (
    <span className={cn('brand-mark inline-flex items-center gap-2.5', animated && 'brand-mark-animated', className)}>
      <span className="brand-mark-stage relative inline-block" style={{ width: size, height: size }}>
        <svg viewBox="0 0 32 32" width={size} height={size} role="img" aria-label="Media Codex" className="brand-mark-svg overflow-visible">
          <defs>
            <linearGradient id={`${uid}-gold`} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="rgb(var(--gold-ink))" />
              <stop offset="0.5" stopColor="rgb(var(--gold))" />
              <stop offset="1" stopColor="rgb(var(--gold-ink))" />
            </linearGradient>
            <linearGradient id={`${uid}-spec`} x1="8" y1="8" x2="24" y2="24" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="rgb(var(--aurora-1))" />
              <stop offset="0.3" stopColor="rgb(var(--aurora-2))" />
              <stop offset="0.55" stopColor="rgb(var(--aurora-3))" />
              <stop offset="0.8" stopColor="rgb(var(--aurora-4))" />
              <stop offset="1" stopColor="rgb(var(--aurora-5))" />
            </linearGradient>
            <clipPath id={`${uid}-clip`}>
              <path d="M16 1.5 30.5 16 16 30.5 1.5 16Z" />
            </clipPath>
          </defs>
          <path d="M16 1.5 30.5 16 16 30.5 1.5 16Z" fill="rgb(var(--elevated))" stroke={`url(#${uid}-gold)`} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M16 1.5V30.5M1.5 16h29" stroke={`url(#${uid}-gold)`} strokeWidth="0.5" opacity="0.35" />
          <path d="M16 7.4 24.6 16 16 24.6 7.4 16Z" fill="none" stroke={`url(#${uid}-spec)`} strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="16" cy="16" r="2.3" fill="rgb(var(--heat))" />
          <g clipPath={`url(#${uid}-clip)`}>
            <rect className="brand-gleam" x="-14" y="-2" width="9" height="36" fill="#fff" opacity="0.4" transform="skewX(-22)" />
          </g>
        </svg>
      </span>
      {wordmark && (
        <span className="font-display text-[19px] font-medium leading-none tracking-[-0.02em] text-ink">
          Codex
        </span>
      )}
    </span>
  )
}
