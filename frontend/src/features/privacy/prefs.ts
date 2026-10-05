/**
 * Vault preferences — everything is on-device, in localStorage under
 * `media-codex-privacy-v1`. The PIN is stored only as a salted PBKDF2 hash.
 *
 * `parsePrefs` / `sanitizeSafeUrl` are pure (unit-tested); the rest is thin IO
 * with an in-memory fallback so blocked storage never throws.
 */

export const PRIVACY_KEY = 'media-codex-privacy-v1'

export type DisguiseId = 'off' | 'notes' | 'weather' | 'calc'
export type ButtonSide = 'left' | 'right'

export interface PinRecord {
  v: 1
  alg: 'PBKDF2-SHA256'
  iter: number
  salt: string
  hash: string
  /** Digits in the PIN (4-8); lets the lock screen submit automatically. */
  len: number
}

export interface BiometricRecord {
  /** base64url credential id */
  id: string
  /** COSE algorithm: -7 (ES256) or -257 (RS256) */
  alg: number
  /** base64 SPKI public key (null when the browser cannot export it) */
  key: string | null
}

export interface PrivacyPrefs {
  pin: PinRecord | null
  biometric: BiometricRecord | null
  lockOnLoad: boolean
  /** Minutes of inactivity before locking; 0 = never. */
  idleMinutes: number
  /** Seconds the tab may stay hidden before locking; -1 = never, 0 = immediately. */
  hiddenSeconds: number
  panicEscape: boolean
  panicTouch: boolean
  panicButton: boolean
  panicButtonSide: ButtonSide
  /** Optional http(s) URL the tab navigates to on panic. Empty = stay on the decoy. */
  safeUrl: string
  disguise: DisguiseId
  blurThumbs: boolean
  blurAway: boolean
}

export const IDLE_OPTIONS = [0, 1, 5, 15] as const
export const HIDDEN_OPTIONS = [0, 15, 60, 300, -1] as const
export const DISGUISE_IDS: readonly DisguiseId[] = ['off', 'notes', 'weather', 'calc']

export const DEFAULT_PREFS: PrivacyPrefs = {
  pin: null,
  biometric: null,
  lockOnLoad: true,
  idleMinutes: 5,
  hiddenSeconds: 60,
  panicEscape: false,
  panicTouch: false,
  panicButton: false,
  panicButtonSide: 'right',
  safeUrl: '',
  disguise: 'off',
  blurThumbs: false,
  blurAway: false,
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)

/** Only plain http(s) URLs; anything else (javascript:, data:, file:) becomes ''. */
export function sanitizeSafeUrl(input: unknown): string {
  if (typeof input !== 'string') return ''
  const trimmed = input.trim().slice(0, 500)
  if (!trimmed) return ''
  // "example.com" gets https://; "host:8080" is a port, not a scheme; other schemes are refused.
  if (!/^https?:\/\//i.test(trimmed) && /^[a-z][a-z0-9+.-]*:(?!\d+(\/|$))/i.test(trimmed)) return ''
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return ''
    return url.toString()
  } catch {
    return ''
  }
}

function parsePin(value: unknown): PinRecord | null {
  if (!isRecord(value)) return null
  const { iter, salt, hash, len } = value
  if (value.v !== 1 || value.alg !== 'PBKDF2-SHA256') return null
  if (typeof iter !== 'number' || !Number.isInteger(iter) || iter < 1000 || iter > 5_000_000) return null
  if (typeof salt !== 'string' || typeof hash !== 'string' || salt.length < 8 || hash.length < 16 || salt.length > 200 || hash.length > 200) return null
  const length = typeof len === 'number' && len >= 4 && len <= 8 ? Math.floor(len) : 0
  return { v: 1, alg: 'PBKDF2-SHA256', iter, salt, hash, len: length }
}

function parseBiometric(value: unknown): BiometricRecord | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id.length < 4 || value.id.length > 1400) return null
  const alg = value.alg === -7 || value.alg === -257 ? value.alg : null
  if (alg === null) return null
  const key = typeof value.key === 'string' && value.key.length < 2000 ? value.key : null
  return { id: value.id, alg, key }
}

/** Validate untrusted JSON into a complete prefs object (never throws). */
export function parsePrefs(raw: string | null | undefined): PrivacyPrefs {
  if (!raw) return { ...DEFAULT_PREFS }
  let data: unknown
  try { data = JSON.parse(raw) } catch { return { ...DEFAULT_PREFS } }
  if (!isRecord(data)) return { ...DEFAULT_PREFS }
  const pin = parsePin(data.pin)
  const idle = (IDLE_OPTIONS as readonly number[]).includes(data.idleMinutes as number) ? (data.idleMinutes as number) : DEFAULT_PREFS.idleMinutes
  const hidden = (HIDDEN_OPTIONS as readonly number[]).includes(data.hiddenSeconds as number) ? (data.hiddenSeconds as number) : DEFAULT_PREFS.hiddenSeconds
  const disguise = DISGUISE_IDS.includes(data.disguise as DisguiseId) ? (data.disguise as DisguiseId) : 'off'
  return {
    pin,
    // Biometrics are only a shortcut to the PIN screen: meaningless without a PIN.
    biometric: pin ? parseBiometric(data.biometric) : null,
    lockOnLoad: bool(data.lockOnLoad, DEFAULT_PREFS.lockOnLoad),
    idleMinutes: idle,
    hiddenSeconds: hidden,
    panicEscape: bool(data.panicEscape, false),
    panicTouch: bool(data.panicTouch, false),
    panicButton: bool(data.panicButton, false),
    panicButtonSide: data.panicButtonSide === 'left' ? 'left' : 'right',
    safeUrl: sanitizeSafeUrl(data.safeUrl),
    disguise,
    blurThumbs: bool(data.blurThumbs, false),
    blurAway: bool(data.blurAway, false),
  }
}

let cache: PrivacyPrefs | null = null
const listeners = new Set<() => void>()

function readRaw(): string | null {
  try { return typeof window === 'undefined' ? null : window.localStorage.getItem(PRIVACY_KEY) } catch { return null }
}

export function getPrefs(): PrivacyPrefs {
  if (!cache) cache = parsePrefs(readRaw())
  return cache
}

export function updatePrefs(patch: Partial<PrivacyPrefs>): PrivacyPrefs {
  const next = parsePrefs(JSON.stringify({ ...getPrefs(), ...patch }))
  cache = next
  try { window.localStorage.setItem(PRIVACY_KEY, JSON.stringify(next)) } catch { /* in-memory only */ }
  listeners.forEach((listener) => listener())
  return next
}

export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === PRIVACY_KEY || event.key === null) { cache = null; listener() }
  }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage) }
}

/** Test seam: drop the in-memory copy so the next read hits storage. */
export function _resetPrefsCache() { cache = null }
