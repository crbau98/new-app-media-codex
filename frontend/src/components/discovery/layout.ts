import type { GridDensity } from '@/store'

/**
 * Pure layout maths for the discovery grids. Both engines return explicit
 * pixel sizes per cell, so every tile reserves its final box before any image
 * decodes (no layout shift) and rows have an exact height for
 * `content-visibility` intrinsic sizing.
 */
export interface LayoutCell {
  index: number
  width: number
  height: number
}

export interface LayoutRow {
  cells: LayoutCell[]
  height: number
}

export interface DensityParams {
  minCell: number
  target: number
  gap: number
}

const DESKTOP: Record<GridDensity, DensityParams> = {
  compact: { minCell: 150, target: 170, gap: 10 },
  normal: { minCell: 200, target: 225, gap: 14 },
  spacious: { minCell: 300, target: 340, gap: 18 },
}

const PHONE: Record<GridDensity, DensityParams> = {
  compact: { minCell: 104, target: 128, gap: 8 },
  normal: { minCell: 160, target: 176, gap: 12 },
  spacious: { minCell: 300, target: 250, gap: 14 },
}

export function densityParams(density: GridDensity, width: number): DensityParams {
  return (width < 640 ? PHONE : DESKTOP)[density]
}

export const UNIFORM_ASPECT = 3 / 4

/** Equal-width columns; every cell shares one aspect. */
export function layoutUniform(count: number, width: number, params: DensityParams, aspect = UNIFORM_ASPECT): LayoutRow[] {
  if (width <= 0 || count <= 0) return []
  const columns = Math.max(1, Math.floor((width + params.gap) / (params.minCell + params.gap)))
  const cellWidth = Math.floor((width - params.gap * (columns - 1)) / columns)
  const cellHeight = Math.round(cellWidth / aspect)
  const rows: LayoutRow[] = []
  for (let start = 0; start < count; start += columns) {
    const cells: LayoutCell[] = []
    for (let index = start; index < Math.min(count, start + columns); index += 1) {
      cells.push({ index, width: cellWidth, height: cellHeight })
    }
    rows.push({ cells, height: cellHeight })
  }
  return rows
}

/** Justified rows ("Cinema"): each row fills the width, honouring every aspect. */
export function layoutJustified(aspects: number[], width: number, params: DensityParams): LayoutRow[] {
  if (width <= 0 || aspects.length === 0) return []
  const { gap, target } = params
  const rows: LayoutRow[] = []
  let pending: number[] = []
  let sum = 0

  const heightFor = (aspectSum: number, n: number) => (width - gap * (n - 1)) / aspectSum

  const commit = (indices: number[], stretch: boolean) => {
    const total = indices.reduce((acc, i) => acc + aspects[i], 0)
    const rowHeight = Math.round(stretch ? heightFor(total, indices.length) : target)
    const cells: LayoutCell[] = []
    let used = 0
    indices.forEach((i, position) => {
      const isLast = position === indices.length - 1
      const cellWidth = stretch && isLast ? width - used - gap * position : Math.min(width, Math.floor(aspects[i] * rowHeight))
      cells.push({ index: i, width: Math.max(40, cellWidth), height: rowHeight })
      used += cellWidth
    })
    rows.push({ cells, height: rowHeight })
  }

  for (let i = 0; i < aspects.length; i += 1) {
    const nextSum = sum + aspects[i]
    const nextCount = pending.length + 1
    const hNext = heightFor(nextSum, nextCount)
    if (hNext >= target) {
      pending.push(i)
      sum = nextSum
      continue
    }
    if (pending.length === 0) {
      commit([i], true)
      continue
    }
    const hPrev = heightFor(sum, pending.length)
    if (Math.abs(hNext - target) < Math.abs(hPrev - target)) {
      commit([...pending, i], true)
      pending = []
      sum = 0
    } else {
      commit(pending, true)
      pending = [i]
      sum = aspects[i]
    }
  }
  if (pending.length) {
    const hLast = heightFor(sum, pending.length)
    commit(pending, hLast <= target * 1.18)
  }
  return rows
}

/** Row/column position lookup for arrow-key navigation. */
export function locate(rows: LayoutRow[], index: number): { row: number; col: number } | null {
  for (let row = 0; row < rows.length; row += 1) {
    const col = rows[row].cells.findIndex((cell) => cell.index === index)
    if (col >= 0) return { row, col }
  }
  return null
}

/** Cell in `rowIndex` whose horizontal centre is closest to `centerX`. */
export function nearestInRow(rows: LayoutRow[], rowIndex: number, centerX: number, gap: number): number | null {
  const row = rows[rowIndex]
  if (!row) return null
  let x = 0
  let best = row.cells[0].index
  let bestDistance = Infinity
  for (const cell of row.cells) {
    const distance = Math.abs(x + cell.width / 2 - centerX)
    if (distance < bestDistance) {
      bestDistance = distance
      best = cell.index
    }
    x += cell.width + gap
  }
  return best
}

export function cellCenter(row: LayoutRow, col: number, gap: number): number {
  let x = 0
  for (let c = 0; c < col; c += 1) x += row.cells[c].width + gap
  return x + row.cells[col].width / 2
}
