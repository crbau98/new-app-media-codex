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
