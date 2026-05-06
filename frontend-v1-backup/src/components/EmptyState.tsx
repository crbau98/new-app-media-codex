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
    <div className="empty-state-panel animate-fade-in relative flex flex-col items-center justify-center overflow-hidden px-8 py-16 text-center sm:px-10 sm:py-20">
      <div
        aria-hidden="true"
        className="orb-float pointer-events-none absolute -top-24 -left-20 h-64 w-64 rounded-full opacity-70"
        style={{
          background: "radial-gradient(circle, rgba(168,85,247,0.22), transparent 70%)",
          filter: "blur(18px)",
        }}
      />
      <div
        aria-hidden="true"
        className="orb-float pointer-events-none absolute -bottom-20 -right-16 h-72 w-72 rounded-full opacity-60"
        style={{
          background: "radial-gradient(circle, rgba(236,72,153,0.18), transparent 70%)",
          filter: "blur(22px)",
          animationDelay: "-7s",
        }}
      />
      <div className="relative mb-6 flex h-20 w-20 select-none items-center justify-center rounded-3xl border border-border bg-bg-elevated text-4xl text-text-secondary shadow-[0_10px_32px_-10px_rgba(0,0,0,0.5),0_0_0_1px_rgba(168,85,247,0.06)]">
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-3xl"
          style={{
            background:
              "linear-gradient(135deg, rgba(168,85,247,0.12), transparent 55%)",
          }}
        />
        <span className="relative">{icon}</span>
      </div>
      <p className="eyebrow relative mb-2">{eyebrow}</p>
      <h3 className="relative text-balance text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">
        {title}
      </h3>
      <p className="relative mt-3 max-w-md text-sm leading-relaxed text-text-muted sm:text-[15px]">
        {description}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="btn-primary relative mt-7 inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold"
        >
          {action.label}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  )
}
