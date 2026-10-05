import { lazy, Suspense, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import './boot'
import '../../styles/privacy.css'
import { getPrefs, subscribePrefs } from './prefs.ts'
import { getMode, subscribeMode } from './vault.ts'

// Everything below the gate is lazy: with no vault feature enabled this file is
// all the visitor ever pays for.
const loadScreens = () => import('./VaultScreens')
const loadTriggers = () => import('./Triggers')
const VaultScreens = lazy(loadScreens)
const Triggers = lazy(loadTriggers)

// Start fetching the shortcut/auto-lock chunk at startup (in parallel with the app),
// but only for visitors who actually use a vault feature.
{
  const early = getPrefs()
  if (early.pin || early.panicEscape || early.panicTouch || early.panicButton) void loadTriggers()
}

/**
 * Wraps the whole app. While locked or panicked the app tree is NOT mounted at
 * all (no render, no media, no network), so nothing sensitive can flash.
 */
export default function PrivacyGate({ children }: { children: ReactNode }) {
  const mode = useSyncExternalStore(subscribeMode, getMode, getMode)
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs, getPrefs)
  const wantsScreens = !!prefs.pin || prefs.panicEscape || prefs.panicTouch || prefs.panicButton

  // Warm the lock/decoy chunk while idle so the swap is instant when needed.
  useEffect(() => {
    if (!wantsScreens) return
    const id = window.setTimeout(() => { void loadScreens() }, 1200)
    return () => window.clearTimeout(id)
  }, [wantsScreens])

  return (
    <>
      {mode === 'open' ? (
        children
      ) : (
        <Suspense fallback={<div className="pv-blank" data-pv-screen="" />}>
          <VaultScreens mode={mode} />
        </Suspense>
      )}
      {(wantsScreens || mode === 'decoy') && (
        <Suspense fallback={null}>
          <Triggers mode={mode} prefs={prefs} />
        </Suspense>
      )}
    </>
  )
}
