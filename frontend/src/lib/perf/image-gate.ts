/**
 * Concurrent-image gate for slow links.
 *
 * On a 3g-class connection or with Data Saver on, a screenful of thumbnails
 * all downloading at once shares one thin pipe, so the images the user is
 * actually looking at arrive last. Below-the-fold (lazy) images therefore take
 * a slot here before they are given a `src`: 3 at a time with Data Saver / 2g,
 * 6 on 3g. Eager images (the LCP image, first cards) never wait, and fast links
 * (including every browser that does not expose the Network Information API)
 * skip the gate entirely, so nothing changes for them.
 */

import { currentConnection, currentNetworkTier, imageConcurrency } from './connection.ts'
import { createLimiter, type Limiter } from './limiter.ts'

let limiter: Limiter | null = null
let listening = false

export function imageGateActive(): boolean {
  const tier = currentNetworkTier()
  return tier === 'slow' || tier === 'cellular'
}

export function imageGate(): Limiter {
  if (!limiter) limiter = createLimiter(imageConcurrency(currentNetworkTier()))
  if (!listening) {
    listening = true
    const connection = currentConnection() as (EventTarget & { addEventListener?: EventTarget['addEventListener'] }) | null
    // Follow network changes (wifi <-> cellular) for the rest of the session.
    connection?.addEventListener?.('change', () => limiter?.setLimit(imageConcurrency(currentNetworkTier())))
  }
  return limiter
}

/** A slot is released after this long even if the image never reports back (hung CDN, detached node). */
export const SLOT_WATCHDOG_MS = 12_000
