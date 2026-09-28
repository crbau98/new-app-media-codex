import type { ReactNode } from 'react'
import { Grid2X2, Grid3X3, Image as ImageIcon, LayoutGrid, List, Play, Rows3, Square } from 'lucide-react'
import type { GridDensity } from '@/store'
import { cn } from '@/lib/utils'
import type { LayoutMode } from './prefs'
import '@/styles/discovery.css'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  count?: number
  /** Visually hide the label (icon-only segment) while keeping it accessible. */
  iconOnly?: boolean
}

interface SegmentedProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: SegmentOption<T>[]
  ariaLabel: string
  className?: string
}

/** Equal-width segmented control with a sliding pill (pure CSS transform). */
export function Segmented<T extends string>({ value, onChange, options, ariaLabel, className }: SegmentedProps<T>) {
  const index = Math.max(0, options.findIndex((option) => option.value === value))
  return (
    <div
      className={cn('d-seg', className)}
      role="group"
      aria-label={ariaLabel}
      style={{ ['--n' as string]: options.length, ['--i' as string]: index }}
    >
      <span className="d-seg-thumb" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="d-seg-btn"
          aria-pressed={value === option.value}
          aria-label={option.iconOnly ? option.label : undefined}
          title={option.iconOnly ? option.label : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {!option.iconOnly && <span>{option.label}</span>}
          {typeof option.count === 'number' && <span className="d-seg-count">{option.count}</span>}
        </button>
      ))}
    </div>
  )
}

export type MediaFacet = 'all' | 'video' | 'photo'

/** All / Videos / Photos with live counts. Photos are first-class. */
export function FacetToggle({
  value,
  onChange,
  counts,
}: {
  value: MediaFacet
  onChange: (value: MediaFacet) => void
  counts?: { all: number; video: number; photo: number }
}) {
  return (
    <Segmented<MediaFacet>
      ariaLabel="Media type"
      className="d-seg-facet"
      value={value}
      onChange={onChange}
      options={[
        { value: 'all', label: 'All', count: counts?.all },
        { value: 'video', label: 'Videos', icon: <Play size={12} strokeWidth={2} fill="currentColor" aria-hidden="true" />, count: counts?.video },
        { value: 'photo', label: 'Photos', icon: <ImageIcon size={12} strokeWidth={2} aria-hidden="true" />, count: counts?.photo },
      ]}
    />
  )
}

export function LayoutToggle({ value, onChange }: { value: LayoutMode; onChange: (value: LayoutMode) => void }) {
  return (
    <Segmented<LayoutMode>
      ariaLabel="Layout"
      value={value}
      onChange={onChange}
      options={[
        { value: 'cinema', label: 'Cinema layout', iconOnly: true, icon: <Rows3 size={16} strokeWidth={1.75} aria-hidden="true" /> },
        { value: 'grid', label: 'Grid layout', iconOnly: true, icon: <LayoutGrid size={16} strokeWidth={1.75} aria-hidden="true" /> },
        { value: 'list', label: 'List layout', iconOnly: true, icon: <List size={16} strokeWidth={1.75} aria-hidden="true" /> },
      ]}
    />
  )
}

export function DensityToggle({ value, onChange }: { value: GridDensity; onChange: (value: GridDensity) => void }) {
  return (
    <Segmented<GridDensity>
      ariaLabel="Density"
      value={value}
      onChange={onChange}
      options={[
        { value: 'compact', label: 'Compact density', iconOnly: true, icon: <Grid3X3 size={16} strokeWidth={1.75} aria-hidden="true" /> },
        { value: 'normal', label: 'Comfortable density', iconOnly: true, icon: <Grid2X2 size={16} strokeWidth={1.75} aria-hidden="true" /> },
        { value: 'spacious', label: 'Large density', iconOnly: true, icon: <Square size={16} strokeWidth={1.75} aria-hidden="true" /> },
      ]}
    />
  )
}
