/** Persisted per-device player preferences (volume, rate, ambient). All access is guarded and goes through the persistence gate. */
import { readJson, STORAGE_KEYS, writeJson } from '../../features/queue/persist.ts'

export interface PlayerPrefs {
  volume: number
  muted?: boolean
  rate: number
  loop: boolean
  /** Offer "skip to where you usually start" for creators the viewer repeatedly skips ahead on. */
  smartStart: boolean
}

const DEFAULTS: PlayerPrefs = { volume: 1, rate: 1, loop: false, smartStart: true }

export function loadPlayerPrefs(): PlayerPrefs {
  const parsed = readJson<Partial<PlayerPrefs> | null>(STORAGE_KEYS.player, null)
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS }
  const volume = typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1 ? parsed.volume : DEFAULTS.volume
  const rate = typeof parsed.rate === 'number' && parsed.rate >= 0.25 && parsed.rate <= 4 ? parsed.rate : DEFAULTS.rate
  return {
    volume,
    rate,
    loop: parsed.loop === true,
    muted: typeof parsed.muted === 'boolean' ? parsed.muted : undefined,
    smartStart: parsed.smartStart !== false,
  }
}

export function savePlayerPrefs(patch: Partial<PlayerPrefs>): void {
  // storage unavailable / incognito / quota — preferences are best-effort
  writeJson(STORAGE_KEYS.player, { ...loadPlayerPrefs(), ...patch })
}
