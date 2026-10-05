/**
 * PIN hashing with WebCrypto PBKDF2-SHA256 and a random per-PIN salt.
 * Only the derived hash (plus salt/iteration count) is ever stored.
 *
 * Honest limits: a 4-8 digit PIN has at most 10^8 possibilities, so anyone who
 * can read this browser's storage can brute-force the hash offline no matter
 * how many iterations are used. The PIN is a screen lock against casual
 * snooping, not encryption of the data at rest.
 */

import type { PinRecord } from './prefs.ts'

export const PIN_MIN = 4
export const PIN_MAX = 8
export const DEFAULT_ITERATIONS = 310_000

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin)
}

/** A short hint for trivially guessable PINs (still allowed, just flagged). */
export function weakPinReason(pin: string): string | null {
  if (!isValidPin(pin)) return null
  if (/^(\d)\1+$/.test(pin)) return 'All the same digit is easy to guess.'
  const digits = [...pin].map(Number)
  const step = digits[1] - digits[0]
  if ((step === 1 || step === -1) && digits.every((d, i) => i === 0 || d - digits[i - 1] === step)) return 'A run of digits is easy to guess.'
  return null
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/** Length-independent-time comparison of two byte strings. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

interface CryptoDeps {
  subtle?: SubtleCrypto
  random?: (length: number) => Uint8Array
}

function deps(options: CryptoDeps): { subtle: SubtleCrypto; random: (length: number) => Uint8Array } {
  const subtle = options.subtle ?? globalThis.crypto?.subtle
  if (!subtle) throw new Error('WebCrypto is unavailable in this context')
  const random = options.random ?? ((length: number) => globalThis.crypto.getRandomValues(new Uint8Array(length)))
  return { subtle, random }
}

async function derive(pin: string, salt: Uint8Array, iterations: number, subtle: SubtleCrypto): Promise<Uint8Array> {
  const key = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256)
  return new Uint8Array(bits)
}

export async function hashPin(pin: string, options: CryptoDeps & { iterations?: number } = {}): Promise<PinRecord> {
  if (!isValidPin(pin)) throw new Error('PIN must be 4-8 digits')
  const { subtle, random } = deps(options)
  const iter = options.iterations ?? DEFAULT_ITERATIONS
  const salt = random(16)
  const hash = await derive(pin, salt, iter, subtle)
  return { v: 1, alg: 'PBKDF2-SHA256', iter, salt: toBase64(salt), hash: toBase64(hash), len: pin.length }
}

export async function verifyPin(pin: string, record: PinRecord, options: CryptoDeps = {}): Promise<boolean> {
  if (!/^\d{1,16}$/.test(pin)) return false
  try {
    const { subtle } = deps(options)
    const expected = fromBase64(record.hash)
    const actual = await derive(pin, fromBase64(record.salt), record.iter, subtle)
    return constantTimeEqual(actual, expected)
  } catch {
    return false
  }
}
