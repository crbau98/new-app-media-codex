import { ButtonHTMLAttributes, forwardRef, useRef } from 'react'
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
      onClick,
      ...props
    },
    ref
  ) => {
    const busy = loading || isLoading
    const buttonRef = useRef<HTMLButtonElement | null>(null)

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      // Ripple effect
      const btn = buttonRef.current
      if (btn) {
        const rect = btn.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const maxDim = Math.max(rect.width, rect.height)

        const ripple = document.createElement('span')
        ripple.style.cssText = [
          'position:absolute',
          `left:${x - maxDim / 2}px`,
          `top:${y - maxDim / 2}px`,
          `width:${maxDim}px`,
          `height:${maxDim}px`,
          'border-radius:50%',
          'background:rgba(255,255,255,0.18)',
          'pointer-events:none',
          'transform:scale(0)',
          'animation:btn-ripple 600ms ease-out forwards',
        ].join(';')

        btn.appendChild(ripple)
        setTimeout(() => ripple.remove(), 620)
      }

      onClick?.(e)
    }

    return (
      <>
        <style>{`
          @keyframes btn-ripple {
            to { transform: scale(2.2); opacity: 0; }
          }
        `}</style>
        <button
          ref={(node) => {
            buttonRef.current = node
            if (typeof ref === 'function') ref(node)
            else if (ref) ref.current = node
          }}
          disabled={disabled || busy}
          aria-busy={busy || undefined}
          onClick={handleClick}
          className={cn(
            'relative inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 overflow-hidden',
            'cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
            variants[variant],
            sizes[size],
            className
          )}
          {...props}
        >
          {busy ? <Spinner size="sm" label="Loading" /> : children}
        </button>
      </>
    )
  }
)
Button.displayName = 'Button'
