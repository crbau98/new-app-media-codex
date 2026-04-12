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
      <div className="mb-5 flex h-16 w-16 select-none items-center justify-center rounded-2xl border border-border bg-bg-elevated text-4xl text-text-secondary shadow-sm">
        {icon}
      </div>
      <p className="eyebrow mb-2">{eyebrow}</p>
      <h3 className="text-balance text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">{title}</h3>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-text-muted sm:text-[15px]">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-7 rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
