/**
 * Idle prefetch scheduler (pure: every environment hook is injected).
 *
 * Likely-next work (route chunks, the detail sheet) is queued with a priority
 * and run ONE AT A TIME, each in its own idle slot, only while the tab is
 * visible and the network tier allows speculative work. Nothing here ever runs
 * during first paint: callers start the scheduler after the first idle period.
 */

export type Tier = 'offline' | 'slow' | 'cellular' | 'fast'

export interface PrefetchTask {
  id: string
  /** Lower runs first. */
  priority: number
  run: () => unknown | Promise<unknown>
}

export interface SchedulerEnv {
  /** Runs `callback` when the main thread is idle; returns a canceller. */
  idle: (callback: () => void, timeoutMs: number) => () => void
  tier: () => Tier
  visible: () => boolean
  /** Total tasks allowed for a tier (0 = none). */
  budget: (tier: Tier) => number
}

export interface PrefetchScheduler {
  add(task: PrefetchTask): void
  /** Begin draining the queue (call after the first idle period). */
  start(): void
  /** Run one specific task now (hover/focus/touch intent), bypassing the idle wait but not dedupe. */
  now(id: string): Promise<void>
  cancel(): void
  readonly completed: ReadonlySet<string>
  readonly pending: number
}

export function createPrefetchScheduler(env: SchedulerEnv, idleTimeoutMs = 3000): PrefetchScheduler {
  const queue: PrefetchTask[] = []
  const known = new Set<string>()
  const completed = new Set<string>()
  const inflight = new Map<string, Promise<void>>()
  let started = false
  let cancelIdle: (() => void) | null = null
  let ran = 0
  let stopped = false

  function exec(task: PrefetchTask): Promise<void> {
    const existing = inflight.get(task.id)
    if (existing) return existing
    const promise = (async () => {
      try {
        await task.run()
        completed.add(task.id)
      } catch {
        // A failed speculative load is simply retried on demand by the router.
      } finally {
        inflight.delete(task.id)
      }
    })()
    inflight.set(task.id, promise)
    return promise
  }

  function sorted() {
    queue.sort((a, b) => a.priority - b.priority)
  }

  function schedule() {
    if (!started || stopped || cancelIdle || !queue.length) return
    cancelIdle = env.idle(() => {
      cancelIdle = null
      if (stopped) return
      const tier = env.tier()
      if (ran >= env.budget(tier)) return
      if (!env.visible()) {
        // Hidden tab: wait for the next opportunity instead of spending its bandwidth.
        cancelIdle = env.idle(() => {
          cancelIdle = null
          schedule()
        }, idleTimeoutMs * 4)
        return
      }
      const task = queue.shift()
      if (!task) return
      ran += 1
      void exec(task).then(schedule)
    }, idleTimeoutMs)
  }

  return {
    add(task) {
      if (known.has(task.id)) return
      known.add(task.id)
      queue.push(task)
      sorted()
      schedule()
    },
    start() {
      started = true
      stopped = false
      schedule()
    },
    now(id) {
      const index = queue.findIndex((task) => task.id === id)
      if (index < 0) return inflight.get(id) ?? Promise.resolve()
      const [task] = queue.splice(index, 1)
      return exec(task)
    },
    cancel() {
      stopped = true
      queue.length = 0
      cancelIdle?.()
      cancelIdle = null
    },
    get completed() {
      return completed
    },
    get pending() {
      return queue.length
    },
  }
}
