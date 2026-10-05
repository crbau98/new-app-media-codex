/**
 * Work that must happen in every session but not before the first paint. It
 * is its own chunk (loaded from main.tsx once the first render is committed)
 * so none of it counts against the entry bundle:
 *
 *  - web-vitals observers (all `buffered`, so nothing before this point is lost)
 *  - feed persistence (write side of the query cache)
 *  - hover/focus/touch route prefetch and the idle prefetch queue
 *  - service worker registration
 */

import type { QueryClient } from '@tanstack/react-query'
import { installVitals } from '@/lib/vitals'
import { startQueryPersistence } from './persist.ts'
import { installIntentPrefetch, startIdlePrefetch } from './prefetch.ts'
import { registerServiceWorker } from './sw.ts'

function afterLoadIdle(task: () => void, delayMs: number) {
  const run = () => window.setTimeout(() => (typeof requestIdleCallback === 'function' ? requestIdleCallback(task, { timeout: 5000 }) : task()), delayMs)
  if (document.readyState === 'complete') run()
  else window.addEventListener('load', run, { once: true })
}

export function startPostRenderWork(queryClient: QueryClient): void {
  installVitals()
  startQueryPersistence(queryClient)
  installIntentPrefetch()
  registerServiceWorker()
  afterLoadIdle(() => startIdlePrefetch(), 1200)
}
