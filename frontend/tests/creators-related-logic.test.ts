import assert from 'node:assert/strict'
import test from 'node:test'

import { DRAWER_STACK_MAX, pushDrawerStack, relatedToCreator } from '../src/features/creators/creatorLogic.ts'

const c = (handle: string) => relatedToCreator({ handle, displayName: handle })

test('relatedToCreator builds a drawer-ready Redgifs creator with a catalog-capable profile URL', () => {
  const creator = relatedToCreator({ handle: '@Top_Dry', displayName: 'Top Dry', avatar: '/api/archiver-proxy?url=x', reason: 'Shares #bearded', sharedTags: ['bearded'] })
  assert.equal(creator.username, 'Top_Dry')
  assert.equal(creator.id, 'resolved-top_dry')
  assert.equal(creator.platform, 'Redgifs')
  assert.equal(creator.profileUrl, 'https://www.redgifs.com/users/Top_Dry')
  assert.deepEqual(creator.matchReasons, ['Shares #bearded'])
  assert.deepEqual(creator.media, [])
})

test('drawer history pushes related creators, ignores the one already open and stays bounded', () => {
  const root = c('root')
  let stack = pushDrawerStack([], root, c('a'))
  assert.deepEqual(stack.map((x) => x.username), ['a'])
  assert.equal(pushDrawerStack(stack, c('a'), c('A')), stack)
  for (let i = 0; i < DRAWER_STACK_MAX + 5; i += 1) stack = pushDrawerStack(stack, stack[stack.length - 1], c(`h${i}`))
  assert.equal(stack.length, DRAWER_STACK_MAX)
  assert.equal(stack[stack.length - 1].username, `h${DRAWER_STACK_MAX + 4}`)
})
