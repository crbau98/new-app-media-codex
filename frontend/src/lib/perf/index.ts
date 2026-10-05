/**
 * Performance utilities (public surface).
 *
 * Settings: call `clearQueryCache()` from "clear local data" style actions to
 * wipe the persisted feed metadata and the service worker's API cache. It never
 * touches likes, follows, history or other preferences.
 */
export { clearQueryCache } from './persist.ts'
export { DISCOVERY_STALE_MS, DISCOVERY_POLL_MS, discoveryKey } from './discovery-keys.ts'
