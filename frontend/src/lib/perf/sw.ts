/**
 * Service worker registration (public/sw.js).
 *
 * - production builds only (never in `vite dev`)
 * - after the page has loaded AND the main thread is idle, so installing the
 *   worker never competes with the first paint or the hero image
 * - never under browser automation (`navigator.webdriver`): Playwright route
 *   mocks must stay authoritative, a worker would answer instead
 * - `?nosw=1` is the kill switch: it unregisters the worker and clears its caches
 */

function whenIdleAfterLoad(task: () => void, delayMs: number) {
  const run = () => {
    window.setTimeout(() => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(task, { timeout: 8000 })
      else task()
    }, delayMs)
  }
  if (document.readyState === 'complete') run()
  else window.addEventListener('load', run, { once: true })
}

async function removeServiceWorkers() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key.startsWith('media-codex-')).map((key) => caches.delete(key)))
    }
  } catch {
    // nothing to clean up
  }
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    if (new URLSearchParams(window.location.search).get('nosw') === '1') {
      void removeServiceWorkers()
      return
    }
  } catch {
    // malformed URL: fall through
  }
  if (navigator.webdriver) return
  whenIdleAfterLoad(() => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)
  }, 2500)
}
