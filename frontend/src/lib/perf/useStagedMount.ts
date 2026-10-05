import { startTransition, useEffect, useState } from 'react'

/**
 * Progressive mount for long pages. Returns 0 on the first render, then counts
 * up to `stages`, one step per idle slot (inside a transition, so React can
 * yield while rendering). Gate below-the-fold sections on `stage >= n`:
 * the hero paints first, the rest follows within a few hundred milliseconds
 * instead of the whole page (thousands of DOM nodes) landing in one long task.
 *
 * `hold` pauses the progression (Home holds until the hero artwork - the LCP element - has
 * been revealed, so the rails never compete with it for the main thread). Nothing here
 * changes what is rendered once the last stage is reached, and `enabled = false` jumps
 * straight to it (tests, print, reduced-work modes).
 */
export function useStagedMount(stages: number, options: { enabled?: boolean; hold?: boolean } = {}): number {
  const { enabled = true, hold = false } = options
  const [stage, setStage] = useState(enabled ? 0 : stages)

  useEffect(() => {
    if (!enabled || hold || stage >= stages) return undefined
    const advance = () => startTransition(() => setStage((value) => Math.min(stages, value + 1)))
    if (typeof requestIdleCallback === 'function') {
      // First step waits until after the first paint; later steps just need an idle slot.
      const handle = requestIdleCallback(advance, { timeout: stage === 0 ? 300 : 200 })
      return () => cancelIdleCallback(handle)
    }
    const handle = window.setTimeout(advance, stage === 0 ? 120 : 60)
    return () => window.clearTimeout(handle)
  }, [enabled, hold, stage, stages])

  return enabled ? stage : stages
}
