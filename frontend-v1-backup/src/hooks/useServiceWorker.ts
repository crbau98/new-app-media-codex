import { useState, useEffect, useCallback } from 'react'

interface SWState {
  isInstalled: boolean
  updateAvailable: boolean
  isOffline: boolean
}

export function useServiceWorker(): SWState & { update: () => void } {
  const [isInstalled, setIsInstalled] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [waitingSW, setWaitingSW] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        setIsInstalled(true)

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          if (!newWorker) return

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateAvailable(true)
              setWaitingSW(newWorker)
            }
          })
        })
      })
      .catch(() => {
        // Silent fail for unsupported browsers
      })

    const onOnline = () => setIsOffline(false)
    const onOffline = () => setIsOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const update = useCallback(() => {
    if (waitingSW) {
      waitingSW.postMessage({ type: 'SKIP_WAITING' })
      window.location.reload()
    }
  }, [waitingSW])

  return { isInstalled, updateAvailable, isOffline, update }
}
