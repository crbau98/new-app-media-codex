import { cn } from '@/lib/cn'

interface TagChipProps {
  label: string
  variant: 'compound' | 'mechanism'
  onClick?: (e: React.MouseEvent) => void
  size?: 'sm' | 'md'
  showCount?: number
}

export function TagChip({ label, variant, onClick, size = 'sm', showCount }: TagChipProps) {
  const isTeal = variant === 'compound'
  const base = cn(
    'inline-flex items-center gap-1 font-mono rounded border transition-colors',
    size === 'sm' ? 'text-[11px] px-1.5 py-0.5' : 'text-xs px-2 py-1',
    isTeal
      ? 'bg-bg-elevated border-teal/30 text-teal hover:border-teal/60 hover:bg-teal/10'
      : 'bg-bg-elevated border-purple/30 text-purple hover:border-purple/60 hover:bg-purple/10',
    onClick ? 'cursor-pointer' : 'cursor-default',
  )

  if (onClick) {
    return (
      <button onClick={onClick} className={base}>
        {label}
        {showCount != null && (
          <span className={cn('text-[10px]', isTeal ? 'text-teal/60' : 'text-purple/60')}>
            {showCount}
          </span>
        )}
      </button>
    )
  }

  return (
    <span className={base}>
      {label}
      {showCount != null && (
        <span className={cn('text-[10px]', isTeal ? 'text-teal/60' : 'text-purple/60')}>
          {showCount}
        </span>
      )}
    </span>
  )
}
