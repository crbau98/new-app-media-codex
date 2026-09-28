/**
 * Cross-component event contract for the AI surfaces. Plain DOM CustomEvents so
 * the integrator can wire them anywhere (App.tsx, Layout, pages) without a
 * shared store.
 *
 *  'codex:open-media'      detail: { id: string }
 *      Dispatched when the command bar or concierge wants the media detail sheet
 *      for `id`. The host MUST call `event.preventDefault()` once it handled the
 *      request (i.e. opened the sheet). If nobody does, the AI surface falls back
 *      to navigating to /search?q=<title> so the action is never a dead end.
 *
 *  'codex:open-concierge'  detail: { prompt?: string }
 *      Opens the concierge drawer (and optionally sends `prompt`). Dispatched by
 *      the command bar's "Ask the concierge"; hosts may dispatch it too.
 *
 *  'codex:current-media'   detail: { id: string | null }   (optional, host -> AI)
 *      Hosts can announce the item currently open in the detail sheet so
 *      "more like this" / "explain this" anchor to it. Falls back to the most
 *      recently viewed item from the store.
 */

export const OPEN_MEDIA_EVENT = 'codex:open-media'
export const OPEN_CONCIERGE_EVENT = 'codex:open-concierge'
export const CURRENT_MEDIA_EVENT = 'codex:current-media'

/** Returns true when a host handled the request. */
export function requestOpenMedia(id: string): boolean {
  if (typeof window === 'undefined') return false
  const event = new CustomEvent(OPEN_MEDIA_EVENT, { detail: { id }, cancelable: true })
  // dispatchEvent returns false when a listener called preventDefault().
  return !window.dispatchEvent(event)
}

export function requestOpenConcierge(prompt?: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_CONCIERGE_EVENT, { detail: { prompt } }))
}

let currentMediaId: string | null = null
if (typeof window !== 'undefined') {
  window.addEventListener(CURRENT_MEDIA_EVENT, (event) => {
    const detail = (event as CustomEvent<{ id?: string | null }>).detail
    currentMediaId = typeof detail?.id === 'string' ? detail.id : null
  })
}
export function getAnnouncedCurrentMedia(): string | null {
  return currentMediaId
}
