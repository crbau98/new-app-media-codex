interface EmptyStateProps {
  icon: string
  title: string
  description: string
  eyebrow?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({ icon, title, description, eyebrow = "Nothing here yet", action }: EmptyStateProps) {
  return (
    <div className="empty-state-panel animate-fade-in flex flex-col items-center justify-center px-8 py-16 text-center sm:px-10 sm:py-20">
      <div className="mb-5 flex h-16 w-16 select-none items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-4xl text-white/80 shadow-[0_8px_22px_rgba(0,0,0,0.14)]">
        {icon}
      </div>
      <p className="eyebrow mb-2">{eyebrow}</p>
      <h3 className="text-balance text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">{title}</h3>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-text-muted sm:text-[15px]">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-7 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-[background-color,box-shadow,transform] hover:bg-accent-hover hover:shadow-[0_0_0_1px_var(--color-accent-glow)]"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
