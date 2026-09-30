import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { isLiteGraphics } from '@/lib/lite'

/**
 * True when rich motion (3D, parallax, WebGL) is allowed: the user has not
 * requested reduced motion (OS or in-app) and the device is not in data-saver.
 */
export function useMotionOk(): boolean {
  const appReduce = useAppStore((s) => s.reduceMotion)
  const [osReduce, setOsReduce] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setOsReduce(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const saveData = typeof navigator !== 'undefined'
    && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
  // Lite devices (phones, low memory) skip WebGL/3D/parallax entirely — see lib/lite.ts.
  return !appReduce && !osReduce && !saveData && !isLiteGraphics()
}
