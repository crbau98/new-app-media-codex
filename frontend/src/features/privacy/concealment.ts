/**
 * DOM-level "hide it now" helpers. Everything here is synchronous so a panic
 * is instant: leave fullscreen / picture-in-picture, stop every media element
 * and cancel in-flight image loads before React even re-renders.
 */

type WebkitDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void }
type WebkitVideo = HTMLVideoElement & { webkitDisplayingFullscreen?: boolean; webkitExitFullscreen?: () => void }

export function exitFullscreenAndPip() {
  try {
    const doc = document as WebkitDocument
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else if (doc.webkitFullscreenElement) doc.webkitExitFullscreen?.()
  } catch { /* ignore */ }
  try {
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined)
  } catch { /* ignore */ }
}

/** Pause + detach every <video>/<audio> (cancels buffering) and drop pending <img> loads. */
export function haltMedia() {
  for (const media of document.querySelectorAll<HTMLMediaElement>('video, audio')) {
    try {
      const video = media as WebkitVideo
      if (video.webkitDisplayingFullscreen) video.webkitExitFullscreen?.()
      media.pause()
      media.removeAttribute('src')
      for (const source of media.querySelectorAll('source')) source.removeAttribute('src')
      media.load()
    } catch { /* element already gone */ }
  }
  for (const image of document.querySelectorAll<HTMLImageElement>('img')) {
    if (image.complete) continue
    try {
      image.removeAttribute('srcset')
      image.removeAttribute('src')
    } catch { /* ignore */ }
  }
}

/** Everything a panic/lock does to the live page before the screen swap renders. */
export function concealNow() {
  exitFullscreenAndPip()
  haltMedia()
  try {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  } catch { /* ignore */ }
}
