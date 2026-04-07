import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** @deprecated use isLoading */
  loading?: boolean
  isLoading?: boolean
}

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-hover shadow-[0_0_12px_var(--color-accent-glow)]',
  secondary:
    'bg-bg-elevated border border-border text-text-primary hover:border-accent hover:text-accent',
  ghost:
    'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
  danger:
    'bg-red/10 border border-red/30 text-red hover:bg-red/20',
}

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1 text-xs rounded-md',
  md: 'px-4 py-2 text-sm rounded-lg',
  lg: 'px-5 py-2.5 text-sm rounded-lg',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      isLoading = false,
      className,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const busy = loading || isLoading

    return (
      <button
        ref={ref}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        className={cn(
          'relative inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 overflow-hidden',
          'cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
          'active:scale-[0.97]',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {busy ? <Spinner size="sm" label="Loading" /> : children}
      </button>
    )
  }
)
Button.displayName = 'Button'
