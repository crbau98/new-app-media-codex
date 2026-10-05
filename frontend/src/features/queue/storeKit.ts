/** Tiny framework-free store primitives shared by the queue and moments stores. */

export interface Store<T> {
  get(): T
  set(next: T): void
  subscribe(listener: () => void): () => void
  /** Re-read from the source of truth (cross-tab sync, tests). */
  reload(): void
  /** Forget the cached value so the next `get()` loads again (tests). */
  reset(): void
}

export function createStore<T>(load: () => T): Store<T> {
  let value: T | undefined
  let loaded = false
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((listener) => listener())
  return {
    get() {
      if (!loaded) {
        value = load()
        loaded = true
      }
      return value as T
    },
    set(next) {
      if (loaded && next === value) return
      value = next
      loaded = true
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reload() {
      value = load()
      loaded = true
      emit()
    },
    reset() {
      loaded = false
      value = undefined
    },
  }
}

const writers = new Set<{ flush: () => void }>()
let flushHooked = false

function hookFlush() {
  if (flushHooked || typeof window === 'undefined') return
  flushHooked = true
  const flushAll = () => writers.forEach((writer) => writer.flush())
  window.addEventListener('pagehide', flushAll)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll()
  })
}

/** Coalesces bursts of mutations (drag-reorder, rapid queueing) into one write; flushes when the page hides. */
export function createWriter(write: () => void, delayMs = 250) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const writer = {
    schedule() {
      hookFlush()
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        write()
      }, delayMs)
    },
    flush() {
      if (timer === null) return
      clearTimeout(timer)
      timer = null
      write()
    },
  }
  writers.add(writer)
  return writer
}
