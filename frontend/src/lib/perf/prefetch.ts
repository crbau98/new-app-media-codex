/**
 * Route + detail-sheet prefetch.
 *
 *  - startIdlePrefetch(): after the first load settles, warm the likely next
 *    route chunks one at a time in idle slots (skipped on Data Saver / 2g,
 *    capped on cellular, paused while the tab is hidden).
 *  - installIntentPrefetch(): hover / focus / touchstart on navigation (an
 *    <a href> or anything with data-prefetch="/route") loads that route's
 *    chunk immediately, a few hundred ms before the click lands.
 *
 * Chunks are the very same modules App.tsx lazy-loads, so a prefetch is just
 * an early `import()` of the same file: nothing is downloaded twice and a
 * failed prefetch falls back to the normal lazy load.
 */

import { currentNetworkTier, prefetchBudget } from './connection.ts'
import { createPrefetchScheduler, type PrefetchScheduler } from './scheduler.ts'

type Loader = () => Promise<unknown>

/** Route chunks, keyed by pathname. Order of PRIORITY is "most likely next stop from Home". */
const ROUTES: Record<string, { load: Loader; priority: number }> = {
  '/explore': { load: () => import('@/pages/Explore'), priority: 1 },
  '/search': { load: () => import('@/pages/Search'), priority: 2 },
  '/creators': { load: () => import('@/pages/Creators'), priority: 3 },
  '/settings': { load: () => import('@/pages/Settings'), priority: 8 },
}
/** The detail sheet is the most common action after browsing; it is the heaviest chunk, so it goes last. */
const DETAIL = { id: 'detail', load: (() => import('@/components/MediaDetail')) as Loader, priority: 6 }

let scheduler: PrefetchScheduler | null = null

function idle(callback: () => void, timeoutMs: number): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(callback, { timeout: timeoutMs })
    return () => cancelIdleCallback(handle)
  }
  const handle = window.setTimeout(callback, 200)
  return () => window.clearTimeout(handle)
}

function getScheduler(): PrefetchScheduler {
  if (!scheduler) {
    scheduler = createPrefetchScheduler({
      idle,
      tier: currentNetworkTier,
      visible: () => document.visibilityState !== 'hidden',
      budget: prefetchBudget,
    })
    for (const [path, route] of Object.entries(ROUTES)) scheduler.add({ id: path, priority: route.priority, run: route.load })
    scheduler.add({ id: DETAIL.id, priority: DETAIL.priority, run: DETAIL.load })
  }
  return scheduler
}

/** Start draining the idle queue (call once, after the first load has settled). */
export function startIdlePrefetch(currentPath = window.location.pathname): void {
  const instance = getScheduler()
  // The current route is already loaded; mark it done so it is never fetched again.
  void instance.now(currentPath)
  instance.start()
}

/** Load a route's chunk now (user intent). Unknown paths are ignored. */
export function prefetchRoute(pathname: string): void {
  const route = ROUTES[pathname]
  if (!route) return
  void getScheduler().now(pathname)
}

function routeFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  const hinted = target.closest<HTMLElement>('[data-prefetch]')
  if (hinted?.dataset.prefetch) return hinted.dataset.prefetch
  const anchor = target.closest<HTMLAnchorElement>('a[href^="/"]')
  if (!anchor) return null
  try {
    return new URL(anchor.href, window.location.href).pathname
  } catch {
    return null
  }
}

/** Delegated, passive listeners: one set for the whole document. */
export function installIntentPrefetch(): () => void {
  const handler = (event: Event) => {
    const path = routeFromTarget(event.target)
    if (path) prefetchRoute(path)
  }
  const options: AddEventListenerOptions = { passive: true, capture: true }
  const events = ['pointerover', 'touchstart', 'focusin'] as const
  for (const name of events) document.addEventListener(name, handler, options)
  return () => {
    for (const name of events) document.removeEventListener(name, handler, options)
  }
}
