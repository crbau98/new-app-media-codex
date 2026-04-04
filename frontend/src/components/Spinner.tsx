import { cn } from '@/lib/cn'

type SpinnerSize = 'sm' | 'md' | 'lg'

const SIZE_MAP: Record<SpinnerSize, number> = {
  sm: 16,
  md: 24,
  lg: 40,
}

interface SpinnerProps {
  size?: SpinnerSize | number
  className?: string
  label?: string
}

// The circumference of the circle with r=9: 2 * Math.PI * 9 â 56.55
const RADIUS = 9
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function Spinner({ size = 'md', className, label }: SpinnerProps) {
  const px = typeof size === 'number' ? size : SIZE_MAP[size]

  // Styles moved to index.css to avoid re-creating <style> tags every render
  return (
    <>
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        role={label ? 'status' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        className={cn('shrink-0', className)}
        style={{ filter: 'drop-shadow(0 0 4px var(--color-accent-glow))' }}
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="var(--color-accent)"
          strokeWidth="1"
          opacity="0.05"
          fill="none"
        />
        {/* Track ring */}
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          stroke="var(--color-accent)"
          strokeWidth="2.5"
          opacity="0.15"
          fill="none"
        />
        {/* Spinning arc */}
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          stroke="var(--color-accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          className="spinner-ring"
        />
      </svg>
    </>
  )
}
import { cn } from '@/lib/cn'

type SpinnerSize = 'sm' | 'md' | 'lg'

const SIZE_MAP: Record<SpinnerSize, number> = {
  sm: 16,
  md: 24,
  lg: 40,
}

interface SpinnerProps {
  size?: SpinnerSize | number
  className?: string
  label?: string
}

// The circumference of the circle with r=9: 2 * Math.PI * 9 ≈ 56.55
const RADIUS = 9
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function Spinner({ size = 'md', className, label }: SpinnerProps) {
  const px = typeof size === 'number' ? size : SIZE_MAP[size]

  return (
    <>
      <style>{`
        @keyframes spinner-dash {
          0%   { stroke-dashoffset: ${CIRCUMFERENCE};  transform: rotate(0deg); }
          50%  { stroke-dashoffset: ${CIRCUMFERENCE * 0.25}; }
          100% { stroke-dashoffset: ${CIRCUMFERENCE};  transform: rotate(360deg); }
        }
        @keyframes spinner-rotate {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .spinner-ring {
          stroke-dasharray: ${CIRCUMFERENCE};
          stroke-dashoffset: ${CIRCUMFERENCE * 0.75};
          animation: spinner-rotate 1s linear infinite;
          transform-origin: center;
        }
      `}</style>
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        role={label ? 'status' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        className={cn('shrink-0', className)}
        style={{ filter: 'drop-shadow(0 0 4px var(--color-accent-glow))' }}
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="var(--color-accent)"
          strokeWidth="1"
          opacity="0.05"
          fill="none"
        />
        {/* Track ring */}
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          stroke="var(--color-accent)"
          strokeWidth="2.5"
          opacity="0.15"
          fill="none"
        />
        {/* Spinning arc */}
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          stroke="var(--color-accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          className="spinner-ring"
        />
      </svg>
    </>
  )
}
