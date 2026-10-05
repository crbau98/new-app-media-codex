/**
 * Hand-off from the boot script (boot.js) to the app.
 *
 * boot.js may already have started the live-feed request before this bundle was
 * parsed. `takeBootFeed(sig)` returns that in-flight request (already parsed
 * JSON) exactly once, and only when the request signature matches what the app
 * is about to send — a changed radar, a forced scan or a query all miss and go
 * to the network as usual.
 */

interface BootFeed {
  sig: string
  p: Promise<unknown>
  at: number
}

const MAX_AGE_MS = 60_000

export function takeBootFeed(sig: string, now = Date.now()): Promise<unknown> | null {
  if (typeof window === 'undefined') return null
  const holder = window as Window & { __mcBoot?: BootFeed }
  const boot = holder.__mcBoot
  if (!boot) return null
  if (now - boot.at > MAX_AGE_MS) {
    delete holder.__mcBoot
    return null
  }
  if (boot.sig !== sig) return null
  // Single use: a later refetch must hit the network, not replay an old response.
  delete holder.__mcBoot
  return boot.p
}
