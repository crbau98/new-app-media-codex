/**
 * Minimal browser-ish globals for testing the framework-free stores in Node:
 * an in-memory localStorage, a window/document that are real EventTargets.
 */
export interface FakeStorage {
  data: Map<string, string>
  failWrites: boolean
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function installBrowserEnv(): FakeStorage {
  const data = new Map<string, string>()
  const storage: FakeStorage = {
    data,
    failWrites: false,
    getItem: (key) => (data.has(key) ? (data.get(key) as string) : null),
    setItem(key, value) {
      if (storage.failWrites) throw new DOMException('quota', 'QuotaExceededError')
      data.set(key, String(value))
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
  const target = globalThis as unknown as Record<string, unknown>
  target.localStorage = storage
  target.window = new EventTarget()
  target.document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  return storage
}
