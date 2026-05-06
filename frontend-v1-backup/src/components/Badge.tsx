import { cn } from '@/lib/cn'

type BadgeVariant =
  | 'default'
  | 'accent'
  | 'teal'
  | 'amber'
  | 'green'
  | 'red'
  | 'purple'
  | 'muted'

const colors: Record<BadgeVariant, string> = {
  default: 'bg-bg-elevated border-border text-text-secondary',
  accent:  'bg-accent/10 border-accent/30 text-accent',
  teal:    'bg-teal/10 border-teal/30 text-teal',
  amber:   'bg-amber/10 border-amber/30 text-amber',
  green:   'bg-green/10 border-green/30 text-green',
  red:     'bg-red/10 border-red/30 text-red',
  purple:  'bg-purple/10 border-purple/30 text-purple',
  muted:   'bg-bg-subtle border-border-muted text-text-muted',
}

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  mono?: boolean
  className?: string
}

export function Badge({
  children,
  variant = 'default',
  mono = false,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 text-xs border rounded-md',
        mono && 'font-mono',
        colors[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
