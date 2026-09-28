import { hoverPreviewEnabled } from './prefs'
import { isSaveData } from './motion'

/**
 * App-wide hover-preview controller: at most ONE inline preview plays at a
 * time. Claiming a slot stops the previous owner; scroll, window blur and tab
 * hiding cancel whatever is playing so nothing keeps decoding off-screen.
 */
interface Claim {
  id: string
  stop: () => void
}

let current: Claim | null = null
let listening = false

function stopCurrent() {
  const claim = current
  current = null
  claim?.stop()
}

function ensureListeners() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('scroll', stopCurrent, { passive: true, capture: true })
  window.addEventListener('blur', stopCurrent)
  window.addEventListener('pagehide', stopCurrent)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCurrent()
  })
}

export const previewController = {
  claim(id: string, stop: () => void) {
    ensureListeners()
    if (current && current.id !== id) stopCurrent()
    current = { id, stop }
  },
  release(id: string) {
    if (current?.id === id) current = null
  },
  stopAll: stopCurrent,
}

/** Dwell time before an inline preview may begin. */
export const PREVIEW_DWELL_MS = 350

export function previewAllowed(): boolean {
  return hoverPreviewEnabled() && !isSaveData()
}
