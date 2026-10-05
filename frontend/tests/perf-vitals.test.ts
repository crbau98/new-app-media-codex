import assert from 'node:assert/strict'
import test from 'node:test'

import { cumulativeShift, estimateInp } from '../src/lib/perf/vitals-math.ts'
import { observeIntersection } from '../src/lib/perf/observe.ts'

test('CLS is the worst session window, not the sum of the whole page life', () => {
  const entries = [
    { startTime: 100, value: 0.05 },
    { startTime: 600, value: 0.05 },
    // > 1 s gap: a new window starts
    { startTime: 3000, value: 0.08 },
  ]
  assert.equal(Number(cumulativeShift(entries).toFixed(4)), 0.1)
})

test('a session window never spans more than 5 seconds', () => {
  const entries = [
    { startTime: 0, value: 0.04 },
    { startTime: 900, value: 0.04 },
    { startTime: 1800, value: 0.04 },
    { startTime: 2700, value: 0.04 },
    { startTime: 3600, value: 0.04 },
    { startTime: 4500, value: 0.04 },
    // still within 1 s of the previous shift but 5.4 s after the window began
    { startTime: 5400, value: 0.04 },
  ]
  // window 1 holds the first six shifts (0.24); the seventh starts window 2
  assert.equal(Number(cumulativeShift(entries).toFixed(4)), 0.24)
})

test('no shifts is zero', () => {
  assert.equal(cumulativeShift([]), 0)
})

test('INP is the slowest interaction until there are 50 of them', () => {
  assert.equal(estimateInp([]), 0)
  assert.equal(estimateInp([120, 80, 480, 60]), 480)
  assert.equal(estimateInp([120.4]), 120)
})

test('INP ignores one outlier per 50 interactions', () => {
  const longest = [900, 400, 300, 200]
  assert.equal(estimateInp(longest, 49), 900)
  assert.equal(estimateInp(longest, 50), 400)
  assert.equal(estimateInp(longest, 100), 300)
  // never indexes past the kept list
  assert.equal(estimateInp(longest, 5000), 200)
})

test('observeIntersection is a no-op where IntersectionObserver is missing', () => {
  const stop = observeIntersection({} as Element, '0px', () => undefined)
  assert.equal(typeof stop, 'function')
  stop()
})
