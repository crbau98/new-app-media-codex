/**
 * Optional device unlock via a WebAuthn *platform* authenticator (Face ID /
 * Touch ID / Windows Hello / Android biometrics).
 *
 * Nothing leaves the device: there is no server and no relying-party backend.
 * The credential id and public key are stored locally and every assertion is
 * verified locally (challenge, origin, rpId hash, user-verified flag and, when
 * the browser exposes the public key, the signature). The PIN stays the
 * fallback and the source of truth for "forgot".
 */

import type { BiometricRecord } from './prefs.ts'
import { fromBase64, toBase64 } from './pin.ts'

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  return fromBase64(padded + '='.repeat((4 - (padded.length % 4)) % 4))
}

/** WebAuthn ES256 signatures are ASN.1 DER; WebCrypto ECDSA wants raw r||s. */
export function derToRawEcdsa(der: Uint8Array, size = 32): Uint8Array {
  if (der[0] !== 0x30) throw new Error('Not a DER sequence')
  let offset = 2
  if (der[1] & 0x80) offset = 2 + (der[1] & 0x7f)
  const readInt = (): Uint8Array => {
    if (der[offset] !== 0x02) throw new Error('Expected DER integer')
    const length = der[offset + 1]
    let value = der.slice(offset + 2, offset + 2 + length)
    offset += 2 + length
    while (value.length > size && value[0] === 0) value = value.slice(1)
    if (value.length > size) throw new Error('Integer too large')
    const padded = new Uint8Array(size)
    padded.set(value, size - value.length)
    return padded
  }
  const r = readInt()
  const s = readInt()
  const raw = new Uint8Array(size * 2)
  raw.set(r, 0)
  raw.set(s, size)
  return raw
}

export interface AssertionInput {
  record: BiometricRecord
  /** The challenge we issued, base64url. */
  challenge: string
  origin: string
  rpId: string
  clientDataJSON: Uint8Array
  authenticatorData: Uint8Array
  signature: Uint8Array
}

const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, i) => value === b[i])

/** Verify a WebAuthn assertion entirely on-device. */
export async function verifyAssertion(input: AssertionInput, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<boolean> {
  try {
    const client = JSON.parse(new TextDecoder().decode(input.clientDataJSON)) as { type?: string; challenge?: string; origin?: string }
    if (client.type !== 'webauthn.get' || client.challenge !== input.challenge || client.origin !== input.origin) return false

    const authData = input.authenticatorData
    if (authData.length < 37) return false
    const rpIdHash = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(input.rpId)))
    if (!equalBytes(rpIdHash, authData.slice(0, 32))) return false
    const flags = authData[32]
    if (!(flags & 0x01) || !(flags & 0x04)) return false // user present AND user verified

    if (!input.record.key) return true // browser could not export the key: flags/challenge/origin checks only

    const clientHash = new Uint8Array(await subtle.digest('SHA-256', input.clientDataJSON as BufferSource))
    const signed = concat(authData, clientHash)
    const spki = fromBase64(input.record.key)
    if (input.record.alg === -7) {
      const key = await subtle.importKey('spki', spki as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRawEcdsa(input.signature) as BufferSource, signed as BufferSource)
    }
    const key = await subtle.importKey('spki', spki as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    return await subtle.verify('RSASSA-PKCS1-v1_5', key, input.signature as BufferSource, signed as BufferSource)
  } catch {
    return false
  }
}

// ── browser glue ────────────────────────────────────────────────────────────

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length))

export async function platformAuthAvailable(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !window.isSecureContext || !('PublicKeyCredential' in window)) return false
    const check = (window.PublicKeyCredential as unknown as { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> }).isUserVerifyingPlatformAuthenticatorAvailable
    return typeof check === 'function' ? await check.call(window.PublicKeyCredential) : false
  } catch {
    return false
  }
}

/** Prompt the platform authenticator to create a device-bound credential (must run from a user gesture). */
export async function registerPlatformCredential(): Promise<BiometricRecord> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: 'Device lock', id: window.location.hostname },
      user: { id: random(16), name: 'device-owner', displayName: 'Device owner' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null
  if (!credential) throw new Error('No credential created')
  const response = credential.response as AuthenticatorAttestationResponse
  const alg = response.getPublicKeyAlgorithm?.() ?? -7
  if (alg !== -7 && alg !== -257) throw new Error('Unsupported authenticator algorithm')
  const key = response.getPublicKey?.()
  return { id: toBase64Url(new Uint8Array(credential.rawId)), alg, key: key ? toBase64(new Uint8Array(key)) : null }
}

/** Ask for a fresh user-verifying assertion and verify it locally. */
export async function assertPlatformCredential(record: BiometricRecord): Promise<boolean> {
  try {
    const challenge = random(32)
    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [{ type: 'public-key', id: fromBase64Url(record.id) as BufferSource, transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null
    if (!credential) return false
    const response = credential.response as AuthenticatorAssertionResponse
    return await verifyAssertion({
      record,
      challenge: toBase64Url(challenge),
      origin: window.location.origin,
      rpId: window.location.hostname,
      clientDataJSON: new Uint8Array(response.clientDataJSON),
      authenticatorData: new Uint8Array(response.authenticatorData),
      signature: new Uint8Array(response.signature),
    })
  } catch {
    return false
  }
}
