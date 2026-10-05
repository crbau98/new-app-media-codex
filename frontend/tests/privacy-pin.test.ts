import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_ITERATIONS, constantTimeEqual, fromBase64, hashPin, isValidPin, toBase64, verifyPin, weakPinReason } from '../src/features/privacy/pin.ts'
import { DEFAULT_PREFS, parsePrefs, sanitizeSafeUrl } from '../src/features/privacy/prefs.ts'

test('PIN format: 4-8 digits only', () => {
  for (const ok of ['1234', '00000000', '918273']) assert.equal(isValidPin(ok), true, ok)
  for (const bad of ['', '123', '123456789', '12a4', ' 1234', '12 34', '１２３４']) assert.equal(isValidPin(bad), false, JSON.stringify(bad))
})

test('weak PIN hints flag repeats and runs but never block', () => {
  assert.match(weakPinReason('0000') ?? '', /same digit/)
  assert.match(weakPinReason('1234') ?? '', /run/)
  assert.match(weakPinReason('9876') ?? '', /run/)
  assert.equal(weakPinReason('4821'), null)
  assert.equal(weakPinReason('12'), null)
})

test('hashPin stores salt/iterations/hash, never the PIN, and verifyPin round-trips', async () => {
  const record = await hashPin('4827', { iterations: 2000 })
  assert.equal(record.alg, 'PBKDF2-SHA256')
  assert.equal(record.iter, 2000)
  assert.equal(record.len, 4)
  assert.equal(fromBase64(record.salt).length, 16)
  assert.equal(fromBase64(record.hash).length, 32)
  assert.equal(JSON.stringify(record).includes('4827'), false)
  assert.equal(await verifyPin('4827', record), true)
  assert.equal(await verifyPin('4828', record), false)
  assert.equal(await verifyPin('', record), false)
  assert.equal(await verifyPin('48270', record), false)
})

test('each hash gets a fresh random salt', async () => {
  const a = await hashPin('1357', { iterations: 1000 })
  const b = await hashPin('1357', { iterations: 1000 })
  assert.notEqual(a.salt, b.salt)
  assert.notEqual(a.hash, b.hash)
  assert.equal(await verifyPin('1357', a), true)
  assert.equal(await verifyPin('1357', b), true)
})

test('a tampered record never verifies and never throws', async () => {
  const record = await hashPin('2468', { iterations: 1000 })
  assert.equal(await verifyPin('2468', { ...record, hash: toBase64(new Uint8Array(32)) }), false)
  assert.equal(await verifyPin('2468', { ...record, iter: record.iter + 1 }), false)
  assert.equal(await verifyPin('2468', { ...record, salt: '!!not-base64!!' }), false)
})

test('hashPin rejects invalid PINs', async () => {
  await assert.rejects(() => hashPin('12'), /4-8 digits/)
  await assert.rejects(() => hashPin('abcd'), /4-8 digits/)
})

test('default work factor is high (>= 300k PBKDF2 iterations)', async () => {
  assert.ok(DEFAULT_ITERATIONS >= 300_000)
  const record = await hashPin('7391')
  assert.equal(record.iter, DEFAULT_ITERATIONS)
  assert.equal(await verifyPin('7391', record), true)
})

test('constantTimeEqual compares content and length', () => {
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true)
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false)
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2])), false)
  assert.equal(constantTimeEqual(new Uint8Array(), new Uint8Array()), true)
})

test('parsePrefs: defaults, validation and PIN-gated biometrics', async () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS)
  assert.deepEqual(parsePrefs('not json'), DEFAULT_PREFS)
  assert.deepEqual(parsePrefs('[]'), DEFAULT_PREFS)

  const pin = await hashPin('3141', { iterations: 1000 })
  const stored = JSON.stringify({
    pin, biometric: { id: 'abcd1234', alg: -7, key: 'AAAA' }, idleMinutes: 15, hiddenSeconds: 0, disguise: 'calc',
    panicEscape: true, panicButtonSide: 'left', safeUrl: 'example.com/home', blurThumbs: true,
  })
  const prefs = parsePrefs(stored)
  assert.equal(prefs.pin?.len, 4)
  assert.equal(prefs.biometric?.alg, -7)
  assert.equal(prefs.idleMinutes, 15)
  assert.equal(prefs.hiddenSeconds, 0)
  assert.equal(prefs.disguise, 'calc')
  assert.equal(prefs.panicEscape, true)
  assert.equal(prefs.panicButtonSide, 'left')
  assert.equal(prefs.safeUrl, 'https://example.com/home')
  assert.equal(prefs.blurThumbs, true)

  // Biometrics without a PIN are meaningless and dropped; garbage values fall back to defaults.
  const noPin = parsePrefs(JSON.stringify({ biometric: { id: 'abcd1234', alg: -7, key: null }, idleMinutes: 7, hiddenSeconds: 3, disguise: 'banking', safeUrl: 'javascript:alert(1)' }))
  assert.equal(noPin.biometric, null)
  assert.equal(noPin.idleMinutes, DEFAULT_PREFS.idleMinutes)
  assert.equal(noPin.hiddenSeconds, DEFAULT_PREFS.hiddenSeconds)
  assert.equal(noPin.disguise, 'off')
  assert.equal(noPin.safeUrl, '')

  // A forged PIN record with an absurd iteration count is ignored (no DoS via tampered storage).
  assert.equal(parsePrefs(JSON.stringify({ pin: { ...pin, iter: 4_000_000_000 } })).pin, null)
  assert.equal(parsePrefs(JSON.stringify({ pin: { ...pin, iter: 10 } })).pin, null)
})

test('sanitizeSafeUrl accepts http(s) only', () => {
  assert.equal(sanitizeSafeUrl('https://example.com'), 'https://example.com/')
  assert.equal(sanitizeSafeUrl('  example.org/path?q=1 '), 'https://example.org/path?q=1')
  assert.equal(sanitizeSafeUrl('http://localhost:3000'), 'http://localhost:3000/')
  assert.equal(sanitizeSafeUrl('localhost:3000'), 'https://localhost:3000/')
  for (const bad of ['', '   ', 'javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'mailto:a@b.co', 'ftp://example.com', 'nodots', 42, null]) {
    assert.equal(sanitizeSafeUrl(bad), '', String(bad))
  }
})
