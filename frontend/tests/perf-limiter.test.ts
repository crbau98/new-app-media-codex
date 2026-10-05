import assert from 'node:assert/strict'
import test from 'node:test'

import { createLimiter } from '../src/lib/perf/limiter.ts'

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

test('never exceeds the concurrency limit and drains the queue in order', async () => {
  const limiter = createLimiter(2)
  const order: number[] = []
  let running = 0
  let peak = 0
  const jobs = Array.from({ length: 6 }, (_, index) =>
    limiter.acquire().then(async (release) => {
      running += 1
      peak = Math.max(peak, running)
      order.push(index)
      await tick()
      running -= 1
      release()
    }),
  )
  await Promise.all(jobs)
  assert.equal(peak, 2)
  assert.deepEqual(order, [0, 1, 2, 3, 4, 5])
  assert.equal(limiter.active, 0)
  assert.equal(limiter.pending, 0)
})

test('lower priority numbers run first; ties are FIFO', async () => {
  const limiter = createLimiter(1)
  const first = await limiter.acquire()
  const order: string[] = []
  const queued = [
    limiter.acquire({ priority: 5 }).then((release) => { order.push('late-1'); release() }),
    limiter.acquire({ priority: 1 }).then((release) => { order.push('urgent'); release() }),
    limiter.acquire({ priority: 5 }).then((release) => { order.push('late-2'); release() }),
  ]
  assert.equal(limiter.pending, 3)
  first()
  await Promise.all(queued)
  assert.deepEqual(order, ['urgent', 'late-1', 'late-2'])
})

test('release is idempotent', async () => {
  const limiter = createLimiter(1)
  const release = await limiter.acquire()
  release()
  release()
  assert.equal(limiter.active, 0)
  const next = await limiter.acquire()
  assert.equal(limiter.active, 1)
  next()
})

test('aborting a pending acquire removes it from the queue and rejects', async () => {
  const limiter = createLimiter(1)
  const hold = await limiter.acquire()
  const controller = new AbortController()
  const pending = limiter.acquire({ signal: controller.signal })
  assert.equal(limiter.pending, 1)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(limiter.pending, 0)
  hold()
  assert.equal(limiter.active, 0)
})

test('an already-aborted signal rejects immediately without taking a slot', async () => {
  const limiter = createLimiter(2)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(limiter.acquire({ signal: controller.signal }), { name: 'AbortError' })
  assert.equal(limiter.active, 0)
})

test('setLimit takes effect immediately for queued work', async () => {
  const limiter = createLimiter(1)
  const hold = await limiter.acquire()
  const started: number[] = []
  const waiting = [0, 1, 2].map((index) => limiter.acquire().then((release) => { started.push(index); return release }))
  await tick()
  assert.deepEqual(started, [])
  limiter.setLimit(4)
  const releases = await Promise.all(waiting)
  assert.deepEqual(started, [0, 1, 2])
  assert.equal(limiter.active, 4)
  hold()
  releases.forEach((release) => release())
  assert.equal(limiter.active, 0)
})

test('limits below 1 are clamped to 1', () => {
  assert.equal(createLimiter(0).limit, 1)
  assert.equal(createLimiter(-5).limit, 1)
  assert.equal(createLimiter(2.9).limit, 2)
})
