import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveKeyAction, type KeyLike } from '../src/lib/player/controls.ts'
import { SHORTCUTS, SHORTCUT_GROUP_ORDER, describeKeys, shortcutsByGroup } from '../src/features/queue/shortcuts.ts'

test('every cataloged shortcut resolves to the action the help claims', () => {
  const probed = SHORTCUTS.filter((entry) => entry.probe)
  assert.ok(probed.length >= 18, 'the catalog covers the player key map')
  for (const entry of probed) {
    const action = resolveKeyAction({ key: entry.probe!.key, shiftKey: entry.probe!.shiftKey }, entry.probe!.paused ?? false)
    assert.ok(action, `${entry.id} (${entry.probe!.key}) resolves to an action`)
    assert.equal(action!.type, entry.action, `${entry.id}: ${entry.probe!.key}`)
  }
})

test('queue and moments keys: N/P/Q/Shift+Q/B/A/?/I', () => {
  assert.deepEqual(resolveKeyAction({ key: 'n' }, false), { type: 'nextItem' })
  assert.deepEqual(resolveKeyAction({ key: 'N', shiftKey: true }, false), { type: 'nextItem' })
  assert.deepEqual(resolveKeyAction({ key: 'p' }, false), { type: 'prevItem' })
  assert.deepEqual(resolveKeyAction({ key: 'q' }, false), { type: 'queue' })
  assert.deepEqual(resolveKeyAction({ key: 'Q', shiftKey: true }, false), { type: 'enqueue' })
  assert.deepEqual(resolveKeyAction({ key: 'b' }, false), { type: 'moment' })
  assert.deepEqual(resolveKeyAction({ key: 'a' }, false), { type: 'abLoop' })
  assert.deepEqual(resolveKeyAction({ key: '?', shiftKey: true }, false), { type: 'help' })
  assert.deepEqual(resolveKeyAction({ key: 'i' }, false), { type: 'pip' })
})

test('no two different actions share a key, and modifiers stay with the browser', () => {
  const keys = ['abcdefghijklmnopqrstuvwxyz', ' ,.<>?/0123456789'].join('').split('')
  const seen = new Map<string, string>()
  for (const key of [...keys, 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    const lower = resolveKeyAction({ key }, true)
    const upper = key.length === 1 ? resolveKeyAction({ key: key.toUpperCase(), shiftKey: true }, true) : lower
    if (lower) seen.set(key, lower.type)
    // Bare and shifted letters may differ only for Q (queue vs add-to-queue).
    if (lower && upper && key !== 'q') assert.equal(upper.type, lower.type, `shift+${key}`)
  }
  assert.equal(seen.get('b'), 'moment')
  assert.equal(seen.get('a'), 'abLoop')
  // Free keys stay free for the host (sheet navigation, save, follow).
  for (const key of ['s', 'g', 'h', 'r', 'u', 'v', 'w', 'x', 'y', 'z', 'd', 'e']) assert.equal(resolveKeyAction({ key }, false), null, key)
  for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }] satisfies Partial<KeyLike>[]) {
    for (const key of ['n', 'p', 'b', 'q', ' ']) assert.equal(resolveKeyAction({ key, ...mod }, false), null)
  }
})

test('catalog is complete for the help overlay: grouped, labelled, unique ids', () => {
  const ids = SHORTCUTS.map((entry) => entry.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const entry of SHORTCUTS) {
    assert.ok(entry.label.length > 3)
    assert.ok(entry.keys.length > 0)
    assert.ok(SHORTCUT_GROUP_ORDER.includes(entry.group))
  }
  const groups = shortcutsByGroup()
  assert.deepEqual(groups.map((group) => group.group), [...SHORTCUT_GROUP_ORDER])
  for (const group of groups) assert.ok(group.entries.length > 0, group.group)
  // The help must mention every queue/moment action the player implements.
  const text = SHORTCUTS.map(describeKeys).join(' | ')
  for (const needle of ['N', 'P', 'Q', 'Shift+Q', 'B', 'A', '?', 'Space', 'Esc']) assert.ok(text.includes(needle), needle)
  assert.equal(describeKeys(SHORTCUTS.find((entry) => entry.id === 'toggle')!), 'Space / K')
})
