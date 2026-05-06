import { cn } from "@/lib/cn"

interface HashtagPillProps {
  tag: string
  onClick?: () => void
  className?: string
}

export function HashtagPill({ tag, onClick, className }: HashtagPillProps) {
  const normalized = tag.startsWith("#") ? tag.slice(1) : tag

  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-accent/25 bg-accent/8 px-2 py-0.5 text-[11px] font-medium text-accent transition-colors hover:border-accent/50 hover:bg-accent/15",
        className,
      )}
    >
      <span className="text-accent/70">#</span>
      <span>{normalized}</span>
    </button>
  )
}
