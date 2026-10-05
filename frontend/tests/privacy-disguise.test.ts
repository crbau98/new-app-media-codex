import assert from 'node:assert/strict'
import test from 'node:test'
import { webcrypto } from 'node:crypto'

import { DISGUISES, buildManifest, iconDataUri, iconSvg, isActiveDisguise, manifestBlobText, type ActiveDisguise } from '../src/features/privacy/disguise.ts'
import { derToRawEcdsa, fromBase64Url, toBase64Url, verifyAssertion } from '../src/features/privacy/webauthn.ts'
import { toBase64 } from '../src/features/privacy/pin.ts'

const IDS = Object.keys(DISGUISES) as ActiveDisguise[]
const ICONS = [{ src: 'data:image/png;base64,AAAA', sizes: '192x192', type: 'image/png', purpose: 'any' }]

test('three neutral disguises with plain names and no brand strings', () => {
  assert.deepEqual(IDS.sort(), ['calc', 'notes', 'weather'])
  for (const id of IDS) {
    const spec = DISGUISES[id]
    const blob = JSON.stringify(spec).toLowerCase()
    for (const word of ['codex', 'media', 'adult', 'porn', 'xxx', '18+', 'gay', 'nsfw']) assert.equal(blob.includes(word), false, `${id} mentions ${word}`)
    assert.match(spec.themeColor, /^#[0-9a-f]{6}$/)
    assert.ok(spec.title.length > 0 && spec.shortName.length <= 12)
  }
  assert.equal(isActiveDisguise('off'), false)
  assert.equal(isActiveDisguise('notes'), true)
})

test('generated SVG icons are valid, self-contained and unbranded', () => {
  for (const id of IDS) {
    for (const rounded of [true, false]) {
      const svg = iconSvg(id, rounded)
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 512 512"/)
      assert.ok(svg.endsWith('</svg>'))
      assert.equal((svg.match(/<svg/g) ?? []).length, 1)
      assert.equal(/<script|href=|<image|<text|codex/i.test(svg), false, `${id} icon must be self-contained`)
      assert.equal(svg.includes('rx="112"'), rounded, 'rounded variant is for favicons, square variant for install icons')
    }
    const uri = iconDataUri(id)
    assert.ok(uri.startsWith('data:image/svg+xml;charset=utf-8,'))
    assert.equal(decodeURIComponent(uri.slice('data:image/svg+xml;charset=utf-8,'.length)), iconSvg(id))
  }
  assert.notEqual(iconSvg('notes'), iconSvg('weather'))
  assert.notEqual(iconSvg('weather'), iconSvg('calc'))
})

test('manifest builder: neutral identity, absolute URLs, nothing that reveals the app', () => {
  for (const id of IDS) {
    const manifest = buildManifest(id, 'https://app.example.com/', ICONS)
    assert.equal(manifest.name, DISGUISES[id].title)
    assert.equal(manifest.short_name, DISGUISES[id].shortName)
    assert.equal(manifest.theme_color, DISGUISES[id].themeColor)
    assert.equal(manifest.display, 'standalone')
    assert.equal(manifest.start_url, 'https://app.example.com/', 'absolute: a blob: manifest cannot resolve relative URLs')
    assert.equal(manifest.scope, 'https://app.example.com/')
    assert.equal(manifest.id, 'https://app.example.com/')
    assert.deepEqual(manifest.icons, ICONS)
    const text = manifestBlobText(manifest)
    assert.deepEqual(JSON.parse(text), manifest)
    assert.equal(/codex|media|adult|shortcuts|share_target|\/media|\/search|\/creators/i.test(text), false, 'no brand, shortcuts, share target or app routes')
  }
  assert.equal(buildManifest('calc', 'http://localhost:5173', []).start_url, 'http://localhost:5173/')
  assert.equal(buildManifest('calc', 'http://localhost:5173///', []).scope, 'http://localhost:5173/')
})

/* ---- WebAuthn assertion verification (local, no server) ---- */

const subtle = webcrypto.subtle as unknown as SubtleCrypto

function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (bytes: Uint8Array) => {
    let b = bytes
    while (b.length > 1 && b[0] === 0) b = b.slice(1)
    if (b[0] & 0x80) b = Uint8Array.from([0, ...b])
    return Uint8Array.from([0x02, b.length, ...b])
  }
  const r = int(raw.slice(0, 32))
  const s = int(raw.slice(32))
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s])
}

async function makeAssertion(opts: { flags?: number; challenge?: string; origin?: string; rpId?: string; tamper?: boolean } = {}) {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey))
  const rpId = 'app.example.com'
  const challenge = toBase64Url(webcrypto.getRandomValues(new Uint8Array(32)))
  const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge: opts.challenge ?? challenge, origin: opts.origin ?? 'https://app.example.com' }))
  const rpHash = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(opts.rpId ?? rpId)))
  const authenticatorData = Uint8Array.from([...rpHash, opts.flags ?? 0x05, 0, 0, 0, 1])
  const clientHash = new Uint8Array(await subtle.digest('SHA-256', clientDataJSON))
  const signed = Uint8Array.from([...authenticatorData, ...clientHash])
  const rawSig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, signed))
  if (opts.tamper) rawSig[10] ^= 0xff
  return {
    record: { id: 'abcd1234', alg: -7, key: toBase64(spki) },
    challenge, origin: 'https://app.example.com', rpId, clientDataJSON, authenticatorData, signature: rawToDer(rawSig),
  }
}

test('base64url helpers round-trip arbitrary bytes', () => {
  const bytes = webcrypto.getRandomValues(new Uint8Array(37))
  const text = toBase64Url(bytes)
  assert.equal(/[+/=]/.test(text), false)
  assert.deepEqual(fromBase64Url(text), bytes)
})

test('DER -> raw ECDSA conversion pads and trims integers', () => {
  const raw = new Uint8Array(64).map((_, i) => (i === 0 || i === 32 ? 0x80 : i))
  assert.deepEqual(derToRawEcdsa(rawToDer(raw)), raw)
  const small = new Uint8Array(64)
  small[31] = 5
  small[63] = 7
  assert.deepEqual(derToRawEcdsa(rawToDer(small)), small)
  assert.throws(() => derToRawEcdsa(Uint8Array.from([1, 2, 3])))
})

test('verifyAssertion accepts a genuine user-verified ES256 assertion', async () => {
  assert.equal(await verifyAssertion(await makeAssertion(), subtle), true)
})

test('verifyAssertion rejects wrong challenge/origin/rp, missing UV, bad signature, wrong key', async () => {
  assert.equal(await verifyAssertion(await makeAssertion({ tamper: true }), subtle), false, 'bad signature')
  assert.equal(await verifyAssertion(await makeAssertion({ flags: 0x01 }), subtle), false, 'user present but NOT verified')
  assert.equal(await verifyAssertion(await makeAssertion({ flags: 0x04 }), subtle), false, 'verified flag without presence')
  assert.equal(await verifyAssertion(await makeAssertion({ origin: 'https://evil.example' }), subtle), false, 'wrong origin')
  assert.equal(await verifyAssertion(await makeAssertion({ rpId: 'evil.example' }), subtle), false, 'wrong rp id hash')
  const wrongChallenge = await makeAssertion({ challenge: 'AAAA' })
  assert.equal(await verifyAssertion(wrongChallenge, subtle), false, 'challenge we did not issue')
  const a = await makeAssertion()
  const b = await makeAssertion()
  assert.equal(await verifyAssertion({ ...a, record: b.record }, subtle), false, 'signature from another key')
  assert.equal(await verifyAssertion({ ...a, authenticatorData: a.authenticatorData.slice(0, 20) }, subtle), false, 'short authenticator data')
})

test('verifyAssertion falls back to flag/challenge checks when the browser cannot export the key', async () => {
  const a = await makeAssertion({ tamper: true })
  assert.equal(await verifyAssertion({ ...a, record: { ...a.record, key: null } }, subtle), true)
  const noUv = await makeAssertion({ flags: 0x01 })
  assert.equal(await verifyAssertion({ ...noUv, record: { ...noUv.record, key: null } }, subtle), false)
})

test('verifyAssertion supports RS256 platform authenticators (Windows Hello)', async () => {
  const pair = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey))
  const challenge = 'Q2hhbGxlbmdl'
  const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge, origin: 'https://app.example.com' }))
  const rpHash = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode('app.example.com')))
  const authenticatorData = Uint8Array.from([...rpHash, 0x05, 0, 0, 0, 2])
  const clientHash = new Uint8Array(await subtle.digest('SHA-256', clientDataJSON))
  const signature = new Uint8Array(await subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, Uint8Array.from([...authenticatorData, ...clientHash])))
  const input = { record: { id: 'abcd1234', alg: -257, key: toBase64(spki) }, challenge, origin: 'https://app.example.com', rpId: 'app.example.com', clientDataJSON, authenticatorData, signature }
  assert.equal(await verifyAssertion(input, subtle), true)
  assert.equal(await verifyAssertion({ ...input, signature: signature.map((b, i) => (i === 5 ? b ^ 1 : b)) }, subtle), false)
})
