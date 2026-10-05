import assert from 'node:assert/strict'
import test from 'node:test'

import { createPrefetchScheduler, type SchedulerEnv, type Tier } from '../src/lib/perf/scheduler.ts'
import { allowSpeculativeWork, imageConcurrency, networkTier, prefetchBudget } from '../src/lib/perf/connection.ts'

/** Deterministic idle queue: nothing runs until the test calls `flush()`. */
function fakeEnv(initial: { tier?: Tier; visible?: boolean; budget?: (tier: Tier) => number } = {}) {
  const queue: Array<{ id: number; callback: () => void }> = []
  let nextId = 0
  const state = { tier: initial.tier ?? ('fast' as Tier), visible: initial.visible ?? true }
  const env: SchedulerEnv = {
    idle: (callback) => {
      const id = (nextId += 1)
      queue.push({ id, callback })
      return () => {
        const index = queue.findIndex((entry) => entry.id === id)
        if (index >= 0) queue.splice(index, 1)
      }
    },
    tier: () => state.tier,
    visible: () => state.visible,
    budget: initial.budget ?? prefetchBudget,
  }
  async function flush(max = 50) {
    for (let guard = 0; guard < max && queue.length; guard += 1) {
      queue.shift()!.callback()
      // let the task's promise chain (and the scheduler's follow-up) settle before looking at the queue again
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
  return { env, state, flush, queue }
}

test('does nothing until started (first paint is never contended)', async () => {
  const { env, flush, queue } = fakeEnv()
  const scheduler = createPrefetchScheduler(env)
  const ran: string[] = []
  scheduler.add({ id: 'a', priority: 1, run: () => { ran.push('a') } })
  assert.equal(queue.length, 0)
  await flush()
  assert.deepEqual(ran, [])
  scheduler.start()
  await flush()
  assert.deepEqual(ran, ['a'])
})

test('runs by priority, one task per idle slot, never concurrently', async () => {
  const { env, flush } = fakeEnv()
  const scheduler = createPrefetchScheduler(env)
  const log: string[] = []
  let running = 0
  let peak = 0
  const task = (id: string, priority: number) => ({
    id,
    priority,
    run: async () => {
      running += 1
      peak = Math.max(peak, running)
      log.push(id)
      await Promise.resolve()
      running -= 1
    },
  })
  scheduler.add(task('settings', 9))
  scheduler.add(task('explore', 1))
  scheduler.add(task('search', 2))
  scheduler.start()
  await flush()
  assert.deepEqual(log, ['explore', 'search', 'settings'])
  assert.equal(peak, 1)
  assert.deepEqual([...scheduler.completed], ['explore', 'search', 'settings'])
})

test('duplicate ids are queued once', async () => {
  const { env, flush } = fakeEnv()
  const scheduler = createPrefetchScheduler(env)
  let runs = 0
  scheduler.add({ id: 'x', priority: 1, run: () => { runs += 1 } })
  scheduler.add({ id: 'x', priority: 1, run: () => { runs += 1 } })
  scheduler.start()
  await flush()
  assert.equal(runs, 1)
})

test('a failing task never blocks the rest and is not marked completed', async () => {
  const { env, flush } = fakeEnv()
  const scheduler = createPrefetchScheduler(env)
  const ran: string[] = []
  scheduler.add({ id: 'bad', priority: 1, run: () => { throw new Error('chunk 404') } })
  scheduler.add({ id: 'good', priority: 2, run: () => { ran.push('good') } })
  scheduler.start()
  await flush()
  assert.deepEqual(ran, ['good'])
  assert.equal(scheduler.completed.has('bad'), false)
  assert.equal(scheduler.completed.has('good'), true)
})

test('slow links and Data Saver get no speculative work; cellular gets a small budget', async () => {
  const slow = fakeEnv({ tier: 'slow' })
  const slowScheduler = createPrefetchScheduler(slow.env)
  let slowRuns = 0
  slowScheduler.add({ id: 'a', priority: 1, run: () => { slowRuns += 1 } })
  slowScheduler.start()
  await slow.flush()
  assert.equal(slowRuns, 0)

  const cellular = fakeEnv({ tier: 'cellular' })
  const cellularScheduler = createPrefetchScheduler(cellular.env)
  let cellularRuns = 0
  for (let index = 0; index < 8; index += 1) cellularScheduler.add({ id: `t${index}`, priority: index, run: () => { cellularRuns += 1 } })
  cellularScheduler.start()
  await cellular.flush()
  assert.equal(cellularRuns, prefetchBudget('cellular'))
  assert.equal(prefetchBudget('cellular'), 3)
})

test('hidden tabs wait instead of spending bandwidth', async () => {
  const { env, state, flush } = fakeEnv({ visible: false })
  const scheduler = createPrefetchScheduler(env)
  let runs = 0
  scheduler.add({ id: 'a', priority: 1, run: () => { runs += 1 } })
  scheduler.start()
  await flush()
  assert.equal(runs, 0)
  state.visible = true
  await flush()
  assert.equal(runs, 1)
})

test('now() runs a queued task immediately (intent) and does not run it twice', async () => {
  const { env, flush } = fakeEnv()
  const scheduler = createPrefetchScheduler(env)
  let runs = 0
  scheduler.add({ id: 'explore', priority: 1, run: () => { runs += 1 } })
  await scheduler.now('explore')
  assert.equal(runs, 1)
  scheduler.start()
  await flush()
  assert.equal(runs, 1)
  await scheduler.now('unknown-id')
})

test('cancel() drops queued work', async () => {
  const { env, flush } = fakeEnv()
  const scheduler = createPrefetchScheduler(env)
  let runs = 0
  scheduler.add({ id: 'a', priority: 1, run: () => { runs += 1 } })
  scheduler.start()
  scheduler.cancel()
  await flush()
  assert.equal(runs, 0)
  assert.equal(scheduler.pending, 0)
})

test('network tier detection', () => {
  assert.equal(networkTier(null), 'fast')
  assert.equal(networkTier({}, false), 'offline')
  assert.equal(networkTier({ saveData: true, effectiveType: '4g' }), 'slow')
  assert.equal(networkTier({ effectiveType: '2g' }), 'slow')
  assert.equal(networkTier({ effectiveType: 'slow-2g' }), 'slow')
  assert.equal(networkTier({ effectiveType: '3g' }), 'cellular')
  assert.equal(networkTier({ effectiveType: '4g', type: 'cellular' }), 'cellular')
  assert.equal(networkTier({ effectiveType: '4g', type: 'wifi' }), 'fast')
  assert.equal(allowSpeculativeWork('slow'), false)
  assert.equal(allowSpeculativeWork('offline'), false)
  assert.equal(allowSpeculativeWork('cellular'), true)
  assert.ok(imageConcurrency('slow') < imageConcurrency('cellular'))
  assert.ok(imageConcurrency('cellular') < imageConcurrency('fast'))
})
