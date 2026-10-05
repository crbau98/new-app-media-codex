/**
 * Shared IntersectionObservers.
 *
 * A media grid mounts dozens of images and each used to create its own
 * observer (two more once loaded): every scroll frame the browser then walks
 * all of them (`IntersectionObserverController::computeIntersections` was one
 * of the larger main-thread costs on a phone). One observer per `rootMargin`
 * serves every element; callbacks are routed per element.
 */

type Listener = (entry: IntersectionObserverEntry) => void

interface Pool {
  observer: IntersectionObserver
  listeners: Map<Element, Listener>
}

const pools = new Map<string, Pool>()

export function observeIntersection(element: Element, rootMargin: string, listener: Listener): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => undefined
  let pool = pools.get(rootMargin)
  if (!pool) {
    const listeners = new Map<Element, Listener>()
    const observer = new IntersectionObserver(
      (entries) => {
        // Only the newest entry per element matters (an element can report twice in one batch).
        const latest = new Map<Element, IntersectionObserverEntry>()
        for (const entry of entries) latest.set(entry.target, entry)
        for (const [target, entry] of latest) listeners.get(target)?.(entry)
      },
      { rootMargin },
    )
    pool = { observer, listeners }
    pools.set(rootMargin, pool)
  }
  const current = pool
  current.listeners.set(element, listener)
  current.observer.observe(element)
  return () => {
    if (current.listeners.get(element) === listener) {
      current.listeners.delete(element)
      current.observer.unobserve(element)
    }
    if (current.listeners.size === 0) {
      current.observer.disconnect()
      if (pools.get(rootMargin) === current) pools.delete(rootMargin)
    }
  }
}
