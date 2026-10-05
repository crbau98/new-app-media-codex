/**
 * Session-only UI state shared between the detail sheet(s), the player, the
 * queue drawer, the shortcut help and the mini-player dock. Nothing here is
 * persisted. Framework-free; React reads it through `useSurface()`.
 */
import { createStore } from './storeKit.ts'

export interface SurfaceState {
  /** Number of detail sheets currently open (page-owned or host-owned). */
  sheets: number
  panelOpen: boolean
  helpOpen: boolean
  /** The viewer closed the dock; it returns when the queue's current item changes. */
  dockDismissed: boolean
}

const store = createStore<SurfaceState>(() => ({ sheets: 0, panelOpen: false, helpOpen: false, dockDismissed: false }))

function patch(partial: Partial<SurfaceState>) {
  const current = store.get()
  const keys = Object.keys(partial) as Array<keyof SurfaceState>
  if (keys.every((key) => current[key] === partial[key])) return
  store.set({ ...current, ...partial })
}

export const surface = {
  get: store.get,
  subscribe: store.subscribe,

  /** Called by each open detail sheet; returns the unregister function. */
  registerSheet(): () => void {
    patch({ sheets: store.get().sheets + 1 })
    let done = false
    return () => {
      if (done) return
      done = true
      patch({ sheets: Math.max(0, store.get().sheets - 1) })
    }
  },

  openPanel() {
    patch({ panelOpen: true, helpOpen: false })
  },
  closePanel() {
    patch({ panelOpen: false })
  },
  togglePanel() {
    patch({ panelOpen: !store.get().panelOpen, helpOpen: false })
  },
  openHelp() {
    patch({ helpOpen: true, panelOpen: false })
  },
  closeHelp() {
    patch({ helpOpen: false })
  },
  toggleHelp() {
    patch({ helpOpen: !store.get().helpOpen, panelOpen: false })
  },
  dismissDock() {
    patch({ dockDismissed: true })
  },
  reviveDock() {
    patch({ dockDismissed: false })
  },
}

/** True while the queue drawer or the shortcut help is open: the player and sheet ignore keys then. */
export function overlayOpen(): boolean {
  const state = store.get()
  return state.panelOpen || state.helpOpen
}
