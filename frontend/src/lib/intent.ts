type WarmTask = {
  key: string
  url: string
  controller: AbortController
  priority: 'metadata' | 'stream'
}

const MAX_CONCURRENT = 2
const queue: WarmTask[] = []
const active = new Map<string, WarmTask>()

function pump() {
  while (active.size < MAX_CONCURRENT && queue.length) {
    const task = queue.shift()!
    active.set(task.key, task)
    fetch(task.url, {
      signal: task.controller.signal,
      cache: task.priority === 'metadata' ? 'force-cache' : 'default',
      credentials: 'omit',
    })
      .catch(() => {})
      .finally(() => {
        active.delete(task.key)
        pump()
      })
  }
}

function enqueue(url: string, priority: WarmTask['priority']) {
  const key = `${priority}:${url}`
  if (active.has(key) || queue.some((task) => task.key === key)) return key
  queue.push({ key, url, controller: new AbortController(), priority })
  pump()
  return key
}

/**
 * Hover/focus warms cheap metadata only. Opening detail is the only action that
 * may promote toward a stream request; navigation/idle cancellation is explicit.
 */
export const playbackIntent = {
  warmMetadata(posterUrl?: string | null) {
    if (!posterUrl) return null
    return enqueue(posterUrl, 'metadata')
  },
  promoteToStream(streamUrl?: string | null) {
    if (!streamUrl) return null
    return enqueue(streamUrl, 'stream')
  },
  cancel(key?: string | null) {
    if (!key) return
    const queuedIndex = queue.findIndex((task) => task.key === key)
    if (queuedIndex >= 0) queue.splice(queuedIndex, 1)
    const running = active.get(key)
    running?.controller.abort()
    active.delete(key)
  },
  cancelAll() {
    queue.splice(0, queue.length)
    for (const task of active.values()) task.controller.abort()
    active.clear()
  },
}
