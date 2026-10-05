/**
 * Pure vitals maths (unit tested): CLS session windows and the INP estimator,
 * following the web.dev definitions.
 */

export interface ShiftEntry {
  startTime: number
  value: number
}

/**
 * Cumulative Layout Shift = the worst "session window": shifts less than 1 s
 * apart are grouped, and a window never spans more than 5 s.
 */
export function cumulativeShift(entries: readonly ShiftEntry[]): number {
  let worst = 0
  let windowValue = 0
  let windowStart = 0
  let last = 0
  for (const entry of entries) {
    const gap = entry.startTime - last
    if (windowValue > 0 && (gap > 1000 || entry.startTime - windowStart > 5000)) {
      windowValue = 0
    }
    if (windowValue === 0) windowStart = entry.startTime
    windowValue += entry.value
    last = entry.startTime
    if (windowValue > worst) worst = windowValue
  }
  return worst
}

/**
 * Interaction to Next Paint: the slowest interaction, ignoring one outlier per
 * 50 interactions (so a 100-interaction session reports its second-slowest).
 * `longest` holds the slowest interactions seen (each interaction's slowest
 * event; any superset of the top 10 works) and `interactionCount` is how many
 * distinct interactions happened in total.
 */
export function estimateInp(longest: readonly number[], interactionCount = longest.length): number {
  if (!longest.length) return 0
  const sorted = [...longest].sort((a, b) => b - a)
  const index = Math.min(sorted.length - 1, Math.floor(interactionCount / 50))
  return Math.round(sorted[index])
}
