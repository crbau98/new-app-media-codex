/** Persisted per-device player preferences (volume, rate, ambient). All access is guarded. */

const KEY = 'media-codex-player-v1'

export interface PlayerPrefs {
  volume: number
  muted?: boolean
  rate: number
  loop: boolean
}

const DEFAULTS: PlayerPrefs = { volume: 1, rate: 1, loop: false }

export function loadPlayerPrefs(): PlayerPrefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<PlayerPrefs>
    const volume = typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1 ? parsed.volume : DEFAULTS.volume
    const rate = typeof parsed.rate === 'number' && parsed.rate >= 0.25 && parsed.rate <= 4 ? parsed.rate : DEFAULTS.rate
    return {
      volume,
      rate,
      loop: parsed.loop === true,
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : undefined,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function savePlayerPrefs(patch: Partial<PlayerPrefs>): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(KEY, JSON.stringify({ ...loadPlayerPrefs(), ...patch }))
  } catch {
    // storage unavailable (private mode / quota) — preferences are best-effort
  }
}
