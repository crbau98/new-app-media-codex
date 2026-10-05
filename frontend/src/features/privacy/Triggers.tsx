import { useEffect } from 'react'
import { lockNow, panic, revealFromDecoy } from './vault.ts'
import { createDoublePress, isEscapePress, isThreeFingerTap, type TouchGesture } from './panicGesture.ts'
import { idleConfigFrom, initialIdle, nextDeadline, stepIdle, type IdleEvent, type IdleState } from './idle.ts'
import type { PrivacyPrefs } from './prefs.ts'
import type { VaultMode } from './vaultMachine.ts'

/**
 * Global triggers (lazy: loaded only once a PIN, panic option or decoy is in
 * play): double-Escape panic/reveal, three-finger tap, idle/hidden auto-lock,
 * and the always-visible hide button.
 */
export default function Triggers({ mode, prefs }: { mode: VaultMode; prefs: PrivacyPrefs }) {
  const { pin, panicEscape, panicTouch, panicButton, panicButtonSide, idleMinutes, hiddenSeconds } = prefs
  const pinSet = !!pin

  // Marker so tests (and curious users) can tell the shortcuts are live.
  useEffect(() => {
    document.documentElement.setAttribute('data-pv-armed', '')
    return () => document.documentElement.removeAttribute('data-pv-armed')
  }, [])

  // Double-Escape: panic from the app / lock screen, reveal from the decoy.
  useEffect(() => {
    if (mode !== 'decoy' && !panicEscape) return
    const double = createDoublePress()
    let lastKeyAt = 0
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') lastKeyAt = Date.now()
      if (!isEscapePress(event) || !double.press(Date.now())) return
      event.preventDefault()
      if (mode === 'decoy') revealFromDecoy()
      else panic()
    }
    // Browsers consume the Escape that leaves fullscreen; count it as the first press.
    const onFullscreen = () => {
      if (!document.fullscreenElement && Date.now() - lastKeyAt > 150 && mode !== 'decoy') double.press(Date.now())
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('fullscreenchange', onFullscreen)
    }
  }, [mode, panicEscape])

  // Three-finger tap (touch devices).
  useEffect(() => {
    if (!panicTouch || mode === 'decoy') return
    let gesture: TouchGesture | null = null
    let origin = { x: 0, y: 0 }
    const onStart = (event: TouchEvent) => {
      if (!gesture) {
        gesture = { startedAt: Date.now(), maxTouches: event.touches.length, moved: 0 }
        origin = { x: event.touches[0].clientX, y: event.touches[0].clientY }
      } else {
        gesture.maxTouches = Math.max(gesture.maxTouches, event.touches.length)
      }
    }
    const onMove = (event: TouchEvent) => {
      if (!gesture || !event.touches[0]) return
      gesture.moved = Math.max(gesture.moved, Math.hypot(event.touches[0].clientX - origin.x, event.touches[0].clientY - origin.y))
    }
    const onEnd = (event: TouchEvent) => {
      if (!gesture || event.touches.length > 0) return
      const hit = isThreeFingerTap(gesture, Date.now())
      gesture = null
      if (hit) panic()
    }
    const onCancel = () => { gesture = null }
    const opts = { passive: true, capture: true } as const
    window.addEventListener('touchstart', onStart, opts)
    window.addEventListener('touchmove', onMove, opts)
    window.addEventListener('touchend', onEnd, opts)
    window.addEventListener('touchcancel', onCancel, opts)
    return () => {
      window.removeEventListener('touchstart', onStart, opts)
      window.removeEventListener('touchmove', onMove, opts)
      window.removeEventListener('touchend', onEnd, opts)
      window.removeEventListener('touchcancel', onCancel, opts)
    }
  }, [mode, panicTouch])

  // Auto-lock: idle timeout, tab hidden, bfcache restore.
  useEffect(() => {
    if (mode !== 'open' || !pinSet) return
    const cfg = idleConfigFrom(idleMinutes, hiddenSeconds)
    let state: IdleState = initialIdle(Date.now())
    let timer = 0
    const schedule = () => {
      window.clearTimeout(timer)
      const wait = nextDeadline(state, cfg, Date.now())
      if (wait !== null) timer = window.setTimeout(() => feed('tick'), wait + 25)
    }
    const feed = (type: IdleEvent['type']) => {
      const result = stepIdle(state, { type, now: Date.now() } as IdleEvent, cfg)
      state = result.state
      if (result.lock) { window.clearTimeout(timer); lockNow(); return }
      if (type !== 'activity') schedule()
    }
    const onActivity = () => feed('activity')
    const onVisibility = () => feed(document.visibilityState === 'hidden' ? 'hidden' : 'visible')
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) feed('visible') }
    const passive = { passive: true, capture: true } as const
    const activity = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const
    for (const name of activity) window.addEventListener(name, onActivity, passive)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    schedule()
    return () => {
      window.clearTimeout(timer)
      for (const name of activity) window.removeEventListener(name, onActivity, passive)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [mode, pinSet, idleMinutes, hiddenSeconds])

  if (mode !== 'open' || !panicButton) return null
  return (
    <button type="button" className="pv-hide" data-side={panicButtonSide} data-pv-keep="" aria-label="Hide screen now" title="Hide screen" onClick={panic}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 3l18 18" />
        <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5.2 0 8.6 4.2 9.6 6a14 14 0 0 1-2.7 3.3M6.5 7.6A14 14 0 0 0 2.4 12c1 1.8 4.4 6 9.6 6a9.7 9.7 0 0 0 4.2-1" />
        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      </svg>
    </button>
  )
}
