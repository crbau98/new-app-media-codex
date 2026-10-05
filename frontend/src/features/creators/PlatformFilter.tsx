import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { PlatformMark } from './PlatformLinks'
import type { PlatformFilterOption } from './platformLinks'
import { OTHER_PLATFORM } from './platformLinks'
import './platforms.css'

interface PlatformFilterProps {
  options: PlatformFilterOption[]
  /** Entries covered by "All platforms". */
  total: number
  value: string | null
  onChange: (value: string | null) => void
}

/** Platform chips with counts; one selection filters the directory/feed AND the saved profiles. */
export default function PlatformFilter({ options, total, value, onChange }: PlatformFilterProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  // On phones the row scrolls sideways: keep the selected chip in view.
  useEffect(() => {
    const root = rootRef.current
    const active = root?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!root || !active || root.scrollWidth <= root.clientWidth + 1) return
    const left = active.getBoundingClientRect().left - root.getBoundingClientRect().left + root.scrollLeft
    root.scrollTo({ left: Math.max(0, left - (root.clientWidth - active.clientWidth) / 2) })
  }, [value])
  const shown = value && !options.some((option) => option.id === value)
    ? [{ id: value, label: value === OTHER_PLATFORM ? 'Other' : value, count: 0, kind: 'external' as const }, ...options]
    : options
  if (shown.length === 0) return null
  return (
    <div ref={rootRef} className="d-chips pf-filter" style={{ flexBasis: '100%' }} role="group" aria-label="Filter by platform" data-testid="platform-filter">
      <button type="button" onClick={() => onChange(null)} className={cn('chip', !value && 'chip-active')} aria-pressed={!value}>
        All platforms <span className="pf-count">{total}</span>
      </button>
      {shown.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(value === option.id ? null : option.id)}
          className={cn('chip', value === option.id && 'chip-active')}
          aria-pressed={value === option.id}
          data-platform={option.id}
        >
          <PlatformMark platform={option.id} className="pf-mark-xs" />
          {option.label}
          <span className="pf-count">{option.count}<span className="sr-only"> creators</span></span>
        </button>
      ))}
    </div>
  )
}
