import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MediaItem } from '@/lib/types'
import type { GridDensity } from '@/store'
import MediaCard from '@/components/MediaCard'
import { readMediaMeta } from './mediaMeta'
import {
  cellCenter,
  densityParams,
  layoutJustified,
  layoutUniform,
  locate,
  nearestInRow,
  type LayoutRow,
} from './layout'
import '@/styles/discovery.css'

export type GridLayout = 'cinema' | 'grid'

interface MediaGridProps {
  items: MediaItem[]
  layout: GridLayout
  density: GridDensity
  onSelect: (id: string) => void
  /** How many items each incremental render adds. */
  pageSize?: number
  /** First N cards load eagerly with high fetch priority. */
  priorityCount?: number
  /** Changing this resets incremental rendering (filters, query, sort). */
  resetKey?: string
  loading?: boolean
  ariaLabel?: string
  hideCreator?: boolean
}

const SKELETON_ASPECTS = [16 / 9, 2 / 3, 1, 4 / 5, 16 / 9, 9 / 16, 4 / 5, 1, 16 / 9, 2 / 3, 1, 16 / 9]

/** Measures an element's content width; updates through rAF so resize is cheap. */
function useContainerWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0].contentRect.width)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setWidth((prev) => (Math.abs(prev - next) >= 1 ? next : prev)))
    })
    observer.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [ref])
  return width
}

function MediaGridImpl({
  items,
  layout,
  density,
  onSelect,
  pageSize = 30,
  priorityCount = 4,
  resetKey = '',
  loading = false,
  ariaLabel = 'Media',
  hideCreator = false,
}: MediaGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const width = useContainerWidth(containerRef)
  const [visible, setVisible] = useState(pageSize)
  const [active, setActive] = useState(0)
  const pendingFocus = useRef<number | null>(null)

  // Reset incremental rendering whenever the filter context changes.
  const [lastKey, setLastKey] = useState(resetKey)
  if (lastKey !== resetKey) {
    setLastKey(resetKey)
    setVisible(pageSize)
    setActive(0)
  }

  const params = useMemo(() => densityParams(density, width), [density, width])
  const count = loading ? SKELETON_ASPECTS.length : items.length

  const rows: LayoutRow[] = useMemo(() => {
    if (width <= 0 || count === 0) return []
    if (layout === 'grid') return layoutUniform(count, width, params)
    const aspects = loading ? SKELETON_ASPECTS : items.map((item) => readMediaMeta(item).aspect)
    return layoutJustified(aspects, width, params)
  }, [count, items, layout, loading, params, width])

  // Render whole rows only, until `visible` items are covered.
  const renderedRows = useMemo(() => {
    if (loading) return rows
    let covered = 0
    const out: LayoutRow[] = []
    for (const row of rows) {
      if (covered >= visible) break
      out.push(row)
      covered += row.cells.length
    }
    return out
  }, [loading, rows, visible])
  const renderedCount = renderedRows.reduce((total, row) => total + row.cells.length, 0)
  const hasMore = !loading && renderedCount < items.length

  const loadMore = useCallback(() => setVisible((value) => value + pageSize), [pageSize])

  // Infinite scroll: a sentinel below the last row asks for the next page.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { rootMargin: '900px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loadMore, renderedCount])

  // Move DOM focus after keyboard navigation once the target is rendered.
  useEffect(() => {
    const index = pendingFocus.current
    if (index === null) return
    const target = containerRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)
    if (target) {
      pendingFocus.current = null
      target.focus()
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  })

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const from = (event.target as HTMLElement).closest<HTMLElement>('[data-dcard]')
    if (!from || loading || items.length === 0) return
    const current = Number(from.dataset.index)
    const pos = locate(rows, current)
    if (!pos) return
    let next: number | null = null
    switch (event.key) {
      case 'ArrowRight':
        next = current + 1
        break
      case 'ArrowLeft':
        next = current - 1
        break
      case 'ArrowDown':
      case 'ArrowUp': {
        const targetRow = pos.row + (event.key === 'ArrowDown' ? 1 : -1)
        next = nearestInRow(rows, targetRow, cellCenter(rows[pos.row], pos.col, params.gap), params.gap)
        break
      }
      case 'Home':
        next = event.ctrlKey ? 0 : rows[pos.row].cells[0].index
        break
      case 'End':
        next = event.ctrlKey ? items.length - 1 : rows[pos.row].cells[rows[pos.row].cells.length - 1].index
        break
      default:
        return
    }
    if (next === null || next < 0 || next >= items.length) return
    event.preventDefault()
    if (next >= renderedCount) setVisible(next + pageSize)
    pendingFocus.current = next
    setActive(next)
  }

  const activeIndex = Math.min(active, Math.max(0, items.length - 1))
  const gap = params.gap

  if (width <= 0) {
    return <div ref={containerRef} className="d-grid" style={{ minHeight: 320 }} aria-busy="true" />
  }

  return (
    <div
      ref={containerRef}
      className="d-grid"
      role={loading ? undefined : 'list'}
      aria-label={loading ? undefined : ariaLabel}
      aria-busy={loading || undefined}
      onKeyDown={onKeyDown}
      onFocusCapture={(event) => {
        const card = (event.target as HTMLElement).closest<HTMLElement>('[data-dcard]')
        if (card) setActive(Number(card.dataset.index))
      }}
      style={{ ['--d-gap' as string]: `${gap}px` }}
    >
      {renderedRows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className="d-row"
          role={loading ? undefined : 'presentation'}
          style={{ height: row.height, containIntrinsicSize: `auto ${row.height}px` }}
        >
          {row.cells.map((cell) =>
            loading ? (
              <div
                key={cell.index}
                className="d-skel"
                aria-hidden="true"
                style={{ width: cell.width, height: cell.height, animationDelay: `${(cell.index % 6) * 90}ms` }}
              />
            ) : (
              <div key={items[cell.index].id} role="listitem" className="d-cell" style={{ width: cell.width, height: cell.height }}>
                <MediaCard
                  item={items[cell.index]}
                  aspectRatio={`${cell.width} / ${cell.height}`}
                  style={{ width: '100%', height: '100%' }}
                  onSelect={onSelect}
                  priority={cell.index < priorityCount}
                  tabIndex={cell.index === activeIndex ? 0 : -1}
                  dataIndex={cell.index}
                  hideCreator={hideCreator}
                />
              </div>
            )
          )}
        </div>
      ))}
      {hasMore && (
        <div ref={sentinelRef} className="d-more">
          <button type="button" className="btn-secondary" onClick={loadMore}>
            Show more · {items.length - renderedCount} remaining
          </button>
        </div>
      )}
    </div>
  )
}

const MediaGrid = memo(MediaGridImpl)
export default MediaGrid
