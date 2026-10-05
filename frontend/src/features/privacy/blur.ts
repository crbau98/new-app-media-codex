/**
 * Screenshot / over-the-shoulder guard. Pure CSS does the work (see
 * styles/privacy.css); this module only toggles attributes on <html>:
 *
 *   data-pv-blur   -> blur every thumbnail until hovered (mouse) or tapped (touch)
 *   data-pv-away   -> veil + blur everything while the window is unfocused /
 *                     the tab is in the background (app switcher, alt-tab)
 *
 * Nothing is added to the page unless the matching setting is on, so the
 * default experience pays no rendering cost (lite-graphics safe).
 */

import { getPrefs, subscribePrefs } from './prefs.ts'

const REVEAL_ATTR = 'data-pv-show'

function setAttr(name: string, on: boolean) {
  const root = document.documentElement
  if (on) root.setAttribute(name, '')
  else root.removeAttribute(name)
}

function clearRevealed() {
  for (const el of document.querySelectorAll(`[${REVEAL_ATTR}]`)) el.removeAttribute(REVEAL_ATTR)
}

function isAway(): boolean {
  return document.visibilityState === 'hidden' || !document.hasFocus()
}

let started = false

export function startBlurGuard() {
  if (started || typeof document === 'undefined') return
  started = true

  const sync = () => {
    const { blurThumbs, blurAway } = getPrefs()
    setAttr('data-pv-blur', blurThumbs)
    if (!blurThumbs) clearRevealed()
    setAttr('data-pv-away', blurAway && isAway())
  }
  sync()
  subscribePrefs(sync)

  const onAway = () => {
    const { blurAway } = getPrefs()
    setAttr('data-pv-away', blurAway && isAway())
    if (document.visibilityState === 'hidden') clearRevealed()
  }
  document.addEventListener('visibilitychange', onAway)
  window.addEventListener('blur', onAway)
  window.addEventListener('focus', onAway)
  window.addEventListener('pageshow', onAway)
  window.addEventListener('popstate', clearRevealed)

  // Touch: the first tap on a blurred thumbnail reveals it instead of opening it.
  document.addEventListener(
    'click',
    (event) => {
      if (!document.documentElement.hasAttribute('data-pv-blur')) return
      if (window.matchMedia('(hover: hover)').matches) return
      const hit = document.elementsFromPoint(event.clientX, event.clientY).find(
        (el): el is HTMLImageElement | HTMLVideoElement => (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) && !el.closest('[data-pv-keep]')
      )
      if (hit && !hit.hasAttribute(REVEAL_ATTR)) {
        hit.setAttribute(REVEAL_ATTR, '')
        event.preventDefault()
        event.stopPropagation()
      }
    },
    true
  )
}
