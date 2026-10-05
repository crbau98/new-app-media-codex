/**
 * Eager half of the disguise: the tab title (synchronous, so a neutral title
 * can never flash) plus a hand-off to disguise.ts (lazy) for favicon, theme
 * color and install surfaces.
 *
 * A MutationObserver re-asserts the neutral title whenever any module (route
 * titles, pages) sets `document.title`, and remembers the real one so it can be
 * restored when the disguise is turned off.
 */

import { DISGUISES } from './disguiseSpec.ts'
import type { DisguiseId } from './prefs.ts'

let realTitle: string | null = null
let observer: MutationObserver | null = null
let applied = false

function guardTitle(title: string) {
  if (realTitle === null) realTitle = document.title
  const assert = () => {
    if (document.title !== title) { realTitle = document.title; document.title = title }
  }
  assert()
  observer?.disconnect()
  observer = new MutationObserver(assert)
  observer.observe(document.head, { childList: true, subtree: true, characterData: true })
}

/** Show the neutral identity for `id` (or the real one for 'off'). `full` also swaps install surfaces. */
export function showIdentity(id: DisguiseId, full: boolean) {
  if (typeof document === 'undefined') return
  if (id === 'off') {
    if (!applied) return
    applied = false
    observer?.disconnect()
    observer = null
    if (realTitle !== null) document.title = realTitle
    realTitle = null
    void import('./disguise.ts').then((m) => m.restoreIcons())
    return
  }
  applied = true
  guardTitle(DISGUISES[id].title)
  void import('./disguise.ts').then((m) => m.applyIcons(id, full))
}
