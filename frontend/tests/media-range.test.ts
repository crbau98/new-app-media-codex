import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_MEDIA_RANGE_BYTES, normalizeMediaRange, partialContentLength } from '../api/_lib/range.ts'

test('media range leaves small explicit requests intact', () => {
  assert.equal(normalizeMediaRange('bytes=0-1023'), 'bytes=0-1023')
})

test('media range bounds open and oversized explicit requests', () => {
  assert.equal(normalizeMediaRange('bytes=0-'), `bytes=0-${MAX_MEDIA_RANGE_BYTES - 1}`)
  assert.equal(normalizeMediaRange('bytes=100-999999999'), `bytes=100-${100 + MAX_MEDIA_RANGE_BYTES - 1}`)
})

test('media range bounds large suffix requests instead of rejecting playback', () => {
  assert.equal(normalizeMediaRange('bytes=-999999999'), `bytes=-${MAX_MEDIA_RANGE_BYTES}`)
})

test('media range rejects malformed or multiple ranges', () => {
  assert.equal(normalizeMediaRange('bytes=10-1'), false)
  assert.equal(normalizeMediaRange('bytes=0-1,4-5'), false)
})

test('partial content length is derived exactly from Content-Range', () => {
  assert.equal(partialContentLength('bytes 0-5444107/5444108'), 5444108)
  assert.equal(partialContentLength('bytes 100-199/*'), 100)
})

test('partial content length rejects malformed or backwards ranges', () => {
  assert.equal(partialContentLength('bytes 20-10/100'), null)
  assert.equal(partialContentLength('not-a-range'), null)
  assert.equal(partialContentLength(null), null)
})
