/**
 * Small priority concurrency limiter (no deps).
 *
 *   const gate = createLimiter(6)
 *   const release = await gate.acquire({ priority: 1, signal })
 *   try { await work() } finally { release() }
 *
 * - lower `priority` numbers run first, FIFO within the same priority
 * - `release` is idempotent
 * - aborting a pending acquire removes it from the queue and rejects with an
 *   AbortError, so route changes never leave queued work behind
 * - `setLimit` can be raised/lowered at runtime (network tier changes)
 */

export interface AcquireOptions {
  priority?: number
  signal?: AbortSignal
}

export interface Limiter {
  acquire(options?: AcquireOptions): Promise<() => void>
  setLimit(limit: number): void
  readonly limit: number
  readonly active: number
  readonly pending: number
}

interface Waiter {
  priority: number
  order: number
  resolve: (release: () => void) => void
  reject: (reason: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

function abortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

export function createLimiter(initialLimit: number): Limiter {
  let limit = Math.max(1, Math.floor(initialLimit))
  let active = 0
  let counter = 0
  const queue: Waiter[] = []

  function makeRelease(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      active -= 1
      pump()
    }
  }

  function pump() {
    while (active < limit && queue.length) {
      let best = 0
      for (let index = 1; index < queue.length; index += 1) {
        const a = queue[index]
        const b = queue[best]
        if (a.priority < b.priority || (a.priority === b.priority && a.order < b.order)) best = index
      }
      const [waiter] = queue.splice(best, 1)
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort)
      active += 1
      waiter.resolve(makeRelease())
    }
  }

  return {
    acquire(options: AcquireOptions = {}) {
      const { priority = 5, signal } = options
      if (signal?.aborted) return Promise.reject(abortError())
      return new Promise<() => void>((resolve, reject) => {
        const waiter: Waiter = { priority, order: counter += 1, resolve, reject, signal }
        if (signal) {
          waiter.onAbort = () => {
            const index = queue.indexOf(waiter)
            if (index >= 0) queue.splice(index, 1)
            reject(abortError())
          }
          signal.addEventListener('abort', waiter.onAbort, { once: true })
        }
        queue.push(waiter)
        pump()
      })
    },
    setLimit(next: number) {
      limit = Math.max(1, Math.floor(next))
      pump()
    },
    get limit() {
      return limit
    },
    get active() {
      return active
    },
    get pending() {
      return queue.length
    },
  }
}
