/**
 * Side-effect boot for the vault. Imported FIRST by App.tsx so it runs before
 * any other module can write to storage or render:
 *   1. storage write-guard (incognito)        2. first screen decided (lock/decoy/app)
 *   3. neutral tab title + blur attributes (everything heavier loads lazily)
 */
import { installStorageGuard, isIncognito } from './incognito.ts'
import { setWriteGate } from '../queue/persist.ts'
import { startVault } from './vault.ts'
import { getPrefs, subscribePrefs } from './prefs.ts'

installStorageGuard()
// Queue / moments / progress writes honour incognito mode too (in-memory state keeps working).
setWriteGate(() => !isIncognito())
startVault()

// Blur guard: the attribute is set synchronously (no unblurred first paint); the
// event handling (hover/tap reveal, switch-away) loads only when a blur option is on.
const syncBlur = () => {
  const { blurThumbs, blurAway } = getPrefs()
  document.documentElement.toggleAttribute('data-pv-blur', blurThumbs)
  if (blurThumbs || blurAway) void import('./blur.ts').then((m) => m.startBlurGuard())
}
syncBlur()
subscribePrefs(syncBlur)
