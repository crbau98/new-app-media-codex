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

const RADIUS = 9

export function Spinner({ size = 'md', className, label }: SpinnerProps) {
  const px = typeof size === 'number' ? size : SIZE_MAP[size]

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('spinner-root shrink-0', className)}
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
      <circle
        cx="12"
        cy="12"
        r={RADIUS}
        stroke="var(--color-accent)"
        strokeWidth="2.5"
        opacity="0.15"
        fill="none"
      />
      <circle
        cx="12"
        cy="12"
        r={RADIUS}
        stroke="var(--color-accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        strokeDasharray="32 24"
        className="spinner-ring"
      />
    </svg>
  )
}
