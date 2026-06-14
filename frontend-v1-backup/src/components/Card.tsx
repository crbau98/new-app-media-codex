import { cn } from '@/lib/cn'

export function Card({ children, className, onClick }: {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div' as React.ElementType
  return (
    <Tag
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      aria-pressed={undefined}
      className={cn(
        'bg-bg-surface border border-border rounded-[20px] p-4 text-left w-full glass content-card',
        'transition-[background-color,border-color,box-shadow,transform] duration-200',
        onClick ? 'cursor-pointer hover:bg-bg-elevated content-card-interactive card-lift' : '',
        className
      )}
    >
      {children}
    </Tag>
  )
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex items-start justify-between gap-3 mb-3', className)}>{children}</div>
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('text-sm text-text-secondary', className)}>{children}</div>
}
