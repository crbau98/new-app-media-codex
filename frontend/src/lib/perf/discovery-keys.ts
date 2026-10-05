/** Shared query-key + timing constants for the live feed (pure, importable from tests). */

/** The feed is considered fresh for 5 minutes (also the boot script's "skip early fetch" window). */
export const DISCOVERY_STALE_MS = 5 * 60 * 1000
/** Home is the only surface that polls. */
export const DISCOVERY_POLL_MS = 120_000

/** Home / Explore / Search share this key, so they share one network request and one cache entry. */
export function discoveryKey(watchlist: string[]) {
  return ['live-discovery', watchlist] as const
}
