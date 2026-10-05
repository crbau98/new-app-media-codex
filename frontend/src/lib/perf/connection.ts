/**
 * Network-aware knobs. Pure functions take an injectable connection so they
 * can be unit tested; the `current*` helpers read `navigator.connection`
 * (Chromium / Android; absent on iOS Safari, where we assume a fast link and
 * rely on the lite-graphics path for the rest).
 */

export interface ConnectionLike {
  saveData?: boolean
  effectiveType?: string
  type?: string
  downlink?: number
  rtt?: number
}

/** slow = 2g / saveData, cellular = 3g/4g on a mobile radio, fast = wifi/ethernet/unknown. */
export type NetworkTier = 'offline' | 'slow' | 'cellular' | 'fast'

export function networkTier(connection?: ConnectionLike | null, online = true): NetworkTier {
  if (!online) return 'offline'
  if (!connection) return 'fast'
  if (connection.saveData === true) return 'slow'
  const effective = connection.effectiveType
  if (effective === 'slow-2g' || effective === '2g') return 'slow'
  if (effective === '3g') return 'cellular'
  if (connection.type === 'cellular') return 'cellular'
  return 'fast'
}

export function currentConnection(): ConnectionLike | null {
  if (typeof navigator === 'undefined') return null
  return (navigator as Navigator & { connection?: ConnectionLike }).connection ?? null
}

export function currentNetworkTier(): NetworkTier {
  return networkTier(currentConnection(), typeof navigator === 'undefined' ? true : navigator.onLine !== false)
}

export function isSaveData(connection: ConnectionLike | null = currentConnection()): boolean {
  return connection?.saveData === true
}

/** How many non-priority images may be in flight at once. */
export function imageConcurrency(tier: NetworkTier): number {
  switch (tier) {
    case 'offline':
    case 'slow':
      return 3
    case 'cellular':
      return 6
    default:
      return 12
  }
}

/** Speculative work (route chunks, detail sheet) is skipped on slow links and Data Saver. */
export function allowSpeculativeWork(tier: NetworkTier): boolean {
  return tier === 'cellular' || tier === 'fast'
}

/** Idle prefetch budget per tier: cellular gets only the cheapest, most likely next routes. */
export function prefetchBudget(tier: NetworkTier): number {
  switch (tier) {
    case 'fast':
      return 6
    case 'cellular':
      return 3
    default:
      return 0
  }
}
