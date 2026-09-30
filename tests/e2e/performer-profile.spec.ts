import { test, expect, type Page } from '@playwright/test'
import { installAppFixture } from './fixtures'

test('visit performers page and click a creator', async ({ page }) => {
  await installAppFixture(page)
  await page.goto('/creators')
  await expect(page.getByRole('heading', { name: /Find male creators/i })).toBeVisible()
  await page.getByText('Signal Studio', { exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: 'Creator Signal Studio' })).toContainText('Shared public studio tags')
})

const poster = 'https://fixture.invalid/poster.svg'
const hogue = {
  handle: 'hoguesdirtylaundry', displayName: 'Christian Hogue', platform: 'Redgifs',
  profileUrl: 'https://www.redgifs.com/users/hoguesdirtylaundry', avatar: poster, followers: 15200, mediaCount: 87,
  confidence: 0.98, matchedBy: 'alias', sourceAttribution: 'Redgifs public profile',
}
const yerger = { ...hogue, handle: 'michaelyerger', displayName: 'Michael Yerger', mediaCount: 142, matchedBy: 'variant', confidence: 0.8 }

const clip = (handle: string, index: number) => ({
  id: `${handle}-${index}`, title: `${handle} clip ${index}`, thumbnail: poster, source: 'Redgifs', duration: '0:12',
  isVideo: true, category: 'Featured', creator: handle, tags: ['Gay'], rating: 4.5,
  createdAt: new Date(Date.now() - index * 86_400_000).toISOString(), views: 100, likes: 5, comments: 0,
  mediaUrl: '/api/archiver-proxy?url=x', streamCandidates: [], pageUrl: 'https://www.redgifs.com/watch/x',
})

async function mockCreatorApis(page: Page, seen: string[]) {
  await installAppFixture(page)
  await page.route('**/api/creator-resolve*', async (route) => {
    const q = (new URL(route.request().url()).searchParams.get('q') || '').toLowerCase()
    const candidates = q.includes('hogue') ? [hogue] : q.includes('yerger') ? [yerger] : []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ query: q, candidates, tried: ['x'], updatedAt: new Date().toISOString() }) })
  })
  await page.route('**/api/creator-directory*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ creators: [], nextCursor: null, total: 87, lanes: [{ tag: 'Twink', pagesScanned: 2 }], updatedAt: new Date().toISOString() }),
  }))
  await page.route('**/api/creator-media*', (route) => {
    seen.push(route.request().url())
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ creator: hogue.handle, resolvedHandle: hogue.handle, items: [clip(hogue.handle, 1), clip(hogue.handle, 2)], page: 1, pages: 1, total: 87, hasMore: false }),
    })
  })
}

test('find a creator by name, open the full catalog with strict=0, add the handle to the radar', async ({ page }) => {
  const seen: string[] = []
  await mockCreatorApis(page, seen)
  await page.goto('/creators')
  await page.getByRole('combobox', { name: /Find a creator/i }).fill('Christian Hogue')
  const option = page.getByRole('option').first()
  await expect(option).toContainText('Christian Hogue')
  await expect(option).toContainText('@hoguesdirtylaundry')
  await expect(option).toContainText('87 posts')
  await expect(option).toContainText('Known alias')
  await option.getByRole('button', { name: 'Add to radar' }).click()
  await expect(page.getByTestId('radar-count')).toHaveText('1/40')
  await expect(page.getByRole('button', { name: 'Remove hoguesdirtylaundry from the radar' })).toBeVisible()
  await option.getByRole('button', { name: 'Open profile', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Creator Christian Hogue' })
  await expect(dialog).toContainText('Full catalog')
  await expect(dialog).toContainText('87')
  expect(seen.some((url) => url.includes('creator=hoguesdirtylaundry') && url.includes('strict=0'))).toBe(true)
})

test('find a creator shows a clear no-match state', async ({ page }) => {
  await mockCreatorApis(page, [])
  await page.goto('/creators')
  await page.getByRole('combobox', { name: /Find a creator/i }).fill('zzzz nobody')
  await expect(page.getByText(/No public match for/)).toBeVisible()
})

test('bulk add resolves names through the resolver and summarises', async ({ page }) => {
  await mockCreatorApis(page, [])
  await page.goto('/creators')
  await page.getByRole('button', { name: /Bulk add/ }).click()
  await page.getByLabel(/Paste names or handles/).fill('Christian Hogue, Michael Yerger\nNobody Here')
  await page.getByRole('button', { name: /Match & add/ }).click()
  await expect(page.getByTestId('bulk-summary')).toContainText('2 resolved · 1 unresolved')
  await expect(page.getByTestId('radar-count')).toHaveText('2/40')
})

const relatedCard = (handle: string, tags: string[]) => ({
  handle, displayName: handle.replace(/_/g, ' '), platform: 'Redgifs', avatar: poster, score: 0.7,
  reason: `Shares ${tags.map((t) => `#${t}`).join(', ')}`, sharedTags: tags,
})

async function mockRelated(page: Page, seen: string[], mode: 'ok' | 'empty' | 'error' = 'ok') {
  await page.route('**/api/creator-related*', (route) => {
    const creator = new URL(route.request().url()).searchParams.get('creator') || ''
    seen.push(creator)
    if (mode === 'error') return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"creator_related_unavailable"}' })
    const body = mode === 'empty' || creator !== hogue.handle
      ? { creator, related: [], elsewhere: [], updatedAt: new Date().toISOString() }
      : {
        creator,
        related: [relatedCard('bear_cub_one', ['bearded', 'jock']), relatedCard('gym_buddy', ['gym']), relatedCard('third_creator', ['twink'])],
        elsewhere: [
          { platform: 'Redgifs', handle: 'hogue_alt', url: 'https://www.redgifs.com/users/hogue_alt', label: 'Redgifs · @hogue_alt', verified: true, source: 'registry', linkOnly: false },
          { platform: 'X', handle: 'hogue_x', url: 'https://x.com/hogue_x', label: 'X · @hogue_x', verified: false, source: 'bio', linkOnly: true },
          { platform: 'Linktree', handle: 'hogue', url: 'https://linktr.ee/hogue', label: 'Link in bio (Linktree) · @hogue', verified: false, source: 'bio', linkOnly: true },
        ],
        updatedAt: new Date().toISOString(),
      }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function openHogue(page: Page) {
  await page.goto('/creators')
  await page.getByRole('combobox', { name: /Find a creator/i }).fill('Christian Hogue')
  await page.getByRole('option').first().getByRole('button', { name: 'Open profile', exact: true }).click()
  return page.getByRole('dialog', { name: 'Creator Christian Hogue' })
}

test('drawer shows related creators and self-published links; related opens in place with Back and Escape closes', async ({ page }) => {
  const seen: string[] = []
  await mockCreatorApis(page, [])
  await mockRelated(page, seen)
  const dialog = await openHogue(page)
  await expect(dialog.getByTestId('related-card')).toHaveCount(3)
  await expect(dialog.getByTestId('related-card').first()).toContainText('bear cub one')
  await expect(dialog.getByTestId('related-card').first()).toContainText('#bearded')

  const links = dialog.getByTestId('elsewhere-link')
  await expect(links).toHaveCount(3)
  await expect(links.first()).toHaveAttribute('rel', 'noopener noreferrer nofollow')
  await expect(links.first()).toHaveAttribute('target', '_blank')
  await expect(links.first()).toContainText('Verified')
  await expect(links.nth(1)).toContainText('link only — opens on the source')
  await expect(links.first()).not.toContainText('link only')

  await dialog.getByTestId('related-card').first().click()
  const next = page.getByRole('dialog', { name: 'Creator bear cub one' })
  await expect(next).toBeVisible()
  await expect(next.getByTestId('drawer-back')).toBeVisible()
  expect(seen).toContain('bear_cub_one')
  await next.getByTestId('drawer-back').click()
  await expect(page.getByRole('dialog', { name: 'Creator Christian Hogue' })).toBeVisible()
  await expect(page.getByTestId('drawer-back')).toHaveCount(0)

  await page.getByRole('dialog').getByTestId('related-card').nth(1).click()
  await expect(page.getByRole('dialog', { name: 'Creator gym buddy' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('related section has empty and error-with-retry states', async ({ page }) => {
  await mockCreatorApis(page, [])
  await mockRelated(page, [], 'empty')
  let dialog = await openHogue(page)
  await expect(dialog.getByText('No related creators found yet')).toBeVisible()
  await expect(dialog.getByTestId('elsewhere-section')).toHaveCount(0)
  await page.keyboard.press('Escape')

  const failing = await page.context().newPage()
  await mockCreatorApis(failing, [])
  await mockRelated(failing, [], 'error')
  dialog = await openHogue(failing)
  await expect(dialog.getByRole('alert')).toContainText("Couldn't load related creators")
  await expect(dialog.getByRole('button', { name: 'Retry' }).first()).toBeVisible()
})
