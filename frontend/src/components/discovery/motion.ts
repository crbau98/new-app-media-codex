import { useCallback, useSyncExternalStore } from 'react'

/** Subscribes to a CSS media query without a setState-in-effect. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mq = window.matchMedia(query)
      mq.addEventListener('change', notify)
      return () => mq.removeEventListener('change', notify)
    },
    [query]
  )
  const getSnapshot = useCallback(
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    [query]
  )
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

export { useMotionOk } from '@/hooks/useMotionOk'

/** Desktop-class pointer: hover available and precise. */
export function useFinePointer(): boolean {
  return useMediaQuery('(hover: hover) and (pointer: fine)')
}

/** Respects the Data Saver hint where the browser exposes it. */
export function isSaveData(): boolean {
  if (typeof navigator === 'undefined') return false
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return Boolean(connection?.saveData)
}
