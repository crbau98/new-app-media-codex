/**
 * The vault's tiny state store: which screen is showing (app / lock / decoy),
 * plus the synchronous side effects of switching (DOM cover, URL stash, media
 * halt, neutral tab identity). Kept framework-free so the panic path never
 * waits on React.
 */

import { getPrefs, subscribePrefs } from './prefs.ts'
import { initialMode, nextMode, type VaultEvent, type VaultMode } from './vaultMachine.ts'
import { concealNow } from './concealment.ts'
import { showIdentity } from './identity.ts'
import { isActiveDisguise } from './disguiseSpec.ts'

/** sessionStorage flag: a panic stays in force across reloads of this tab until revealed. */
export const PANIC_KEY = 'media-codex-panic-v1'

function panicFlag(value?: boolean): boolean {
  try {
    if (value === true) window.sessionStorage.setItem(PANIC_KEY, '1')
    else if (value === false) window.sessionStorage.removeItem(PANIC_KEY)
    return window.sessionStorage.getItem(PANIC_KEY) === '1'
  } catch {
    return false
  }
}

let mode: VaultMode = 'open'
let started = false
let savedUrl: string | null = null
let savedScroll = 0
const listeners = new Set<() => void>()

export function getMode(): VaultMode {
  return mode
}

export function subscribeMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function stashUrl() {
  if (savedUrl !== null || typeof window === 'undefined') return
  const { pathname, search, hash } = window.location
  savedUrl = `${pathname}${search}${hash}`
  savedScroll = window.scrollY
  try { window.history.replaceState(window.history.state, '', '/') } catch { /* ignore */ }
}

function restoreUrl() {
  if (savedUrl === null) return
  try { window.history.replaceState(window.history.state, '', savedUrl) } catch { /* ignore */ }
  savedUrl = null
  // The router's own scroll manager resets to the top on mount; put the reader back afterwards.
  const target = savedScroll
  savedScroll = 0
  if (target > 0) {
    let tries = 0
    const attempt = () => {
      window.scrollTo(0, target)
      tries += 1
      if (tries < 12 && Math.abs(window.scrollY - target) > 4) window.setTimeout(attempt, 80)
    }
    window.setTimeout(attempt, 350)
  }
}

/** Neutral identity while concealed (the configured disguise, else a plain "Notes"); the real one when open. */
export function syncIdentity() {
  const { disguise } = getPrefs()
  if (mode !== 'open') showIdentity(isActiveDisguise(disguise) ? disguise : 'notes', isActiveDisguise(disguise))
  else showIdentity(disguise, true)
}

function setMode(next: VaultMode) {
  if (next === mode) return
  const wasOpen = mode === 'open'
  if (wasOpen) stashUrl() // read the scroll offset before the cover collapses the page
  mode = next
  const root = document.documentElement
  if (next === 'open') {
    panicFlag(false)
    restoreUrl()
    root.removeAttribute('data-privacy')
  } else {
    if (next === 'decoy') panicFlag(true)
    root.setAttribute('data-privacy', next)
    if (wasOpen) concealNow()
  }
  syncIdentity()
  listeners.forEach((listener) => listener())
}

export function dispatchVault(event: VaultEvent) {
  setMode(nextMode(mode, event, { pinSet: !!getPrefs().pin }))
}

/** Replace the whole UI with the decoy right now; optionally leave for the configured safe URL. */
export function panic() {
  dispatchVault('panic')
  const { safeUrl } = getPrefs()
  if (safeUrl) {
    try { window.location.replace(safeUrl) } catch { /* stay on the decoy */ }
  }
}

export const lockNow = () => dispatchVault('lock')
export const revealFromDecoy = () => dispatchVault('reveal')
export const unlock = () => dispatchVault('unlock')

/** Idempotent boot: decide the first screen *before* React renders so nothing sensitive can flash. */
export function startVault() {
  if (started || typeof document === 'undefined') return
  started = true
  const prefs = getPrefs()
  const first = panicFlag() ? 'decoy' : initialMode({ pinSet: !!prefs.pin, lockOnLoad: prefs.lockOnLoad })
  if (first !== 'open') {
    mode = first
    document.documentElement.setAttribute('data-privacy', first)
    stashUrl()
  }
  syncIdentity()
  subscribePrefs(syncIdentity)
}
