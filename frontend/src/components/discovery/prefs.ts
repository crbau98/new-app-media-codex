import { useCallback, useSyncExternalStore } from 'react'

/**
 * Tiny localStorage-backed preference store for per-viewer conveniences
 * (layout, hover previews). Every access is wrapped: storage can throw in
 * private windows, so an in-memory map keeps the UI consistent regardless.
 */
const memory = new Map<string, string>()
const listeners = new Set<() => void>()

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function setLocalPref(key: string, value: string) {
  memory.set(key, value)
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage unavailable: the memory copy keeps this session consistent.
  }
  listeners.forEach((listener) => listener())
}

export function useLocalPref<T extends string>(key: string, fallback: T, allowed?: readonly T[]): [T, (value: T) => void] {
  const subscribe = useCallback((notify: () => void) => {
    listeners.add(notify)
    return () => {
      listeners.delete(notify)
    }
  }, [])
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null)
  const value = (raw !== null && (!allowed || (allowed as readonly string[]).includes(raw)) ? raw : fallback) as T
  const set = useCallback((next: T) => setLocalPref(key, next), [key])
  return [value, set]
}

export type LayoutMode = 'cinema' | 'grid' | 'list'
export const LAYOUT_MODES: readonly LayoutMode[] = ['cinema', 'grid', 'list']
export const LAYOUT_KEY = 'mc.discovery.layout'
export const HOVER_PREVIEW_KEY = 'mc.discovery.hoverPreview'

export function useLayoutMode(): [LayoutMode, (value: LayoutMode) => void] {
  return useLocalPref<LayoutMode>(LAYOUT_KEY, 'cinema', LAYOUT_MODES)
}

export function useHoverPreviewPref(): [boolean, (value: boolean) => void] {
  const [raw, setRaw] = useLocalPref<'on' | 'off'>(HOVER_PREVIEW_KEY, 'on', ['on', 'off'])
  const set = useCallback((value: boolean) => setRaw(value ? 'on' : 'off'), [setRaw])
  return [raw === 'on', set]
}

/** Non-hook read for imperative code paths (hover controller). */
export function hoverPreviewEnabled(): boolean {
  return read(HOVER_PREVIEW_KEY) !== 'off'
}
