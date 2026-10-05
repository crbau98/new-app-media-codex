import { readFile } from 'node:fs/promises'
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

/* ───────── Platform presence + saved profile links ───────── */

const SUBSCRIPTION_HOSTS = /(^|\.)(onlyfans\.com|fansly\.com|justfor\.fans)$/i

/** Every request to a subscription host is recorded: the app must never make one. */
function watchSubscriptionHosts(page: Page) {
  const hits: string[] = []
  page.on('request', (request) => {
    try {
      if (SUBSCRIPTION_HOSTS.test(new URL(request.url()).hostname)) hits.push(request.url())
    } catch {
      // not a URL
    }
  })
  return hits
}

const directoryCreator = {
  id: 'dir-leo', name: 'Leo North', username: 'leonorth', avatar: poster, platform: 'Redgifs', platforms: ['Redgifs'],
  profileUrl: 'https://www.redgifs.com/users/leonorth', mediaCount: 12, followers: 900, sourceAttribution: 'Redgifs public profile',
  profileLinks: [
    { label: 'Redgifs', url: 'https://www.redgifs.com/users/leonorth' },
    { label: 'OnlyFans', url: 'https://onlyfans.com/leo.north' },
    { label: 'X', url: 'https://x.com/leo_north' },
  ],
  media: [clip('leonorth', 1)],
}
const bskyCreator = {
  id: 'dir-marco', name: 'Marco Reyes', username: 'marco.bsky.social', avatar: poster, platform: 'Bluesky', platforms: ['Bluesky'],
  profileUrl: 'https://bsky.app/profile/marco.bsky.social', mediaCount: 3, sourceAttribution: 'Bluesky public AppView', media: [],
}

async function mockDirectoryWithPlatforms(page: Page) {
  await page.route('**/api/creator-directory*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ creators: [directoryCreator, bskyCreator], nextCursor: null, total: 2, lanes: [], updatedAt: new Date().toISOString() }),
  }))
}

async function pasteSaved(page: Page, text: string, platform?: string) {
  await page.getByLabel('Paste profile links or @handles').fill(text)
  if (platform) await page.getByTestId('saved-platform').selectOption(platform)
  await page.getByTestId('saved-submit').click()
}

test('saved profiles: paste many links, link-only cards, dedupe, remove, persists, never touches subscription hosts', async ({ page }) => {
  const hits = watchSubscriptionHosts(page)
  await mockCreatorApis(page, [])
  await page.goto('/creators')
  const section = page.getByTestId('saved-section')
  await expect(section.getByRole('heading', { name: 'Your saved profiles' })).toBeVisible()
  await expect(page.getByTestId('saved-count')).toHaveText('0/300')

  await pasteSaved(
    page,
    'https://onlyfans.com/Aaron.Vale?ref=1\nfansly.com/nico_fans, @some_creator\njavascript:alert(1)\nhttp://127.0.0.1/admin\nhttps://x.com/home',
    'justforfans',
  )
  const summary = page.getByTestId('saved-summary')
  await expect(summary).toContainText('3 saved')
  await expect(summary).toContainText("3 couldn't be read")
  await expect(summary).toContainText('Only http(s) links are accepted')
  await expect(summary).toContainText('not a public website')
  // Failed lines stay in the box so they can be fixed; valid ones are gone.
  await expect(page.getByLabel('Paste profile links or @handles')).toHaveValue(/javascript:alert\(1\)/)
  await expect(page.getByTestId('saved-count')).toHaveText('3/300')

  const cards = page.getByTestId('saved-card')
  await expect(cards).toHaveCount(3)
  const of = cards.filter({ hasText: '@aaron.vale' })
  await expect(of).toContainText('OnlyFans')
  const subscribe = of.getByTestId('subscribe-link')
  await expect(subscribe).toHaveAttribute('href', 'https://onlyfans.com/aaron.vale')
  await expect(subscribe).toHaveAttribute('target', '_blank')
  await expect(subscribe).toHaveAttribute('rel', 'noopener noreferrer nofollow')
  await expect(subscribe).toContainText('Subscribe on OnlyFans')
  await expect(subscribe).toContainText('opens their page')
  await expect(of.getByTestId('paywall-note')).toHaveText("Subscription content stays behind the creator's paywall.")
  await expect(cards.filter({ hasText: '@some_creator' }).getByTestId('subscribe-link')).toHaveAttribute('href', 'https://justfor.fans/some_creator')
  // No embedded media of any kind on saved cards.
  await expect(page.getByTestId('saved-grid').locator('img, video, iframe')).toHaveCount(0)

  // Targets stay >= 44px.
  for (const target of [subscribe, of.getByRole('button', { name: /Remove @aaron\.vale/ }), of.getByRole('button', { name: /Add note|Edit note/ })]) {
    const box = await target.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(43.5)
  }

  // Dedupe by platform+handle (case, query and path variants all collapse).
  await page.getByLabel('Paste profile links or @handles').fill('https://www.onlyfans.com/AARON.VALE/media https://x.com/aaron_vale')
  await page.getByTestId('saved-submit').click()
  await expect(summary).toContainText('1 saved')
  await expect(summary).toContainText('1 already saved')
  await expect(cards).toHaveCount(4)

  // Optional note.
  await of.getByRole('button', { name: /Add note/ }).click()
  await of.getByRole('textbox', { name: /Note for/ }).fill('Pride 2025')
  await of.getByRole('button', { name: 'Save note' }).click()
  await expect(of.getByTestId('saved-note')).toHaveText('Pride 2025')

  // Persists across reloads under the versioned key.
  await page.reload()
  await expect(page.getByTestId('saved-card')).toHaveCount(4)
  await expect(page.getByTestId('saved-card').filter({ hasText: '@aaron.vale' }).getByTestId('saved-note')).toHaveText('Pride 2025')
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('media-codex-saved-links-v1') || 'null'))
  expect(stored.v).toBe(1)
  expect(stored.links).toHaveLength(4)
  expect(stored.links.every((link: { url: string }) => link.url.startsWith('https://'))).toBe(true)

  await page.getByTestId('saved-card').filter({ hasText: '@nico_fans' }).getByRole('button', { name: /Remove @nico_fans/ }).click()
  await expect(page.getByTestId('saved-card')).toHaveCount(3)
  expect(hits).toEqual([])
})

test('platform filter chips with counts work across the directory and saved profiles', async ({ page }) => {
  await mockCreatorApis(page, [])
  await mockDirectoryWithPlatforms(page)
  await page.goto('/creators')
  await pasteSaved(page, 'https://onlyfans.com/aaron.vale https://x.com/rowan_h https://fansly.com/nico_fans')
  await expect(page.getByTestId('saved-card')).toHaveCount(3)

  const filter = page.getByTestId('platform-filter')
  await expect(filter.getByRole('button', { name: /OnlyFans 2 creators/ })).toBeVisible() // 1 directory creator + 1 saved
  await expect(filter.getByRole('button', { name: /^X 2 creators/ })).toBeVisible()
  await expect(filter.getByRole('button', { name: /Bluesky 1 creators/ })).toBeVisible()
  await expect(filter.getByRole('button', { name: /Fansly 1 creators/ })).toBeVisible()

  await filter.getByRole('button', { name: /OnlyFans/ }).click()
  await expect(filter.getByRole('button', { name: /OnlyFans/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('saved-card')).toHaveCount(1)
  await expect(page.getByTestId('saved-card')).toContainText('@aaron.vale')
  await expect(page.getByTestId('saved-filter-note')).toContainText('Showing OnlyFans only')
  const grid = page.getByTestId('creator-grid')
  await expect(grid.getByRole('heading', { name: 'Leo North' })).toBeVisible()
  await expect(grid.getByRole('heading', { name: 'Marco Reyes' })).toHaveCount(0)

  await filter.getByRole('button', { name: /Bluesky/ }).click()
  await expect(page.getByTestId('saved-empty-filter')).toContainText('None of your saved profiles match Bluesky')
  await expect(grid.getByRole('heading', { name: 'Marco Reyes' })).toBeVisible()
  await expect(grid.getByRole('heading', { name: 'Leo North' })).toHaveCount(0)

  await filter.getByRole('button', { name: /All platforms/ }).click()
  await expect(page.getByTestId('saved-card')).toHaveCount(3)
})

test('directory cards offer subscription link-outs to the creator’s own page and never embed paywalled content', async ({ page }) => {
  const hits = watchSubscriptionHosts(page)
  await mockCreatorApis(page, [])
  await mockDirectoryWithPlatforms(page)
  await page.goto('/creators')
  const card = page.getByTestId('creator-grid').locator('article', { hasText: 'Leo North' })
  const links = card.getByTestId('card-platform-links')
  await expect(links).toContainText('Find them on')
  await expect(links.getByTestId('platform-chip').filter({ hasText: 'X' })).toHaveAttribute('href', 'https://x.com/leo_north')
  const subscribe = links.getByTestId('subscribe-link')
  await expect(subscribe).toHaveAttribute('href', 'https://onlyfans.com/leo.north')
  await expect(subscribe).toHaveAttribute('rel', 'noopener noreferrer nofollow')
  await expect(subscribe).toContainText('Subscribe on OnlyFans')
  await expect(links.getByTestId('paywall-note')).toBeVisible()
  expect((await subscribe.boundingBox())!.height).toBeGreaterThanOrEqual(43.5)
  // A public (non-subscription) platform gets a plain outbound chip and no subscribe button.
  const marco = page.getByTestId('creator-grid').locator('article', { hasText: 'Marco Reyes' })
  await expect(marco.getByTestId('platform-chip')).toHaveAttribute('href', 'https://bsky.app/profile/marco.bsky.social')
  await expect(marco.getByTestId('subscribe-link')).toHaveCount(0)
  expect(hits).toEqual([])
})

test('drawer: Find them on row from elsewhere links, subscription button, save these links', async ({ page }) => {
  const hits = watchSubscriptionHosts(page)
  await mockCreatorApis(page, [])
  await page.route('**/api/creator-related*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      creator: hogue.handle, related: [], updatedAt: new Date().toISOString(),
      elsewhere: [
        { platform: 'X', handle: 'hogue_x', url: 'https://x.com/hogue_x', label: 'X · @hogue_x', verified: true, source: 'registry', linkOnly: true },
        { platform: 'OnlyFans', handle: 'christianhogue', url: 'https://onlyfans.com/christianhogue', label: 'OnlyFans', verified: false, source: 'bio', linkOnly: true },
        { platform: 'Evil', handle: 'x', url: 'javascript:alert(1)', label: 'Evil', verified: false, source: 'bio', linkOnly: true },
      ],
    }),
  }))
  const dialog = await openHogue(page)
  const section = dialog.getByTestId('find-them-on')
  await expect(section).toBeVisible()
  await expect(section.getByTestId('platform-chip').filter({ hasText: 'Redgifs' })).toBeVisible()
  const x = section.getByTestId('platform-chip').filter({ hasText: 'X' })
  await expect(x).toHaveAttribute('href', 'https://x.com/hogue_x')
  await expect(x).toHaveAttribute('rel', 'noopener noreferrer nofollow')
  await expect(section.getByTestId('subscribe-link')).toHaveAttribute('href', 'https://onlyfans.com/christianhogue')
  await expect(section.getByTestId('paywall-note')).toBeVisible()
  // The javascript: link from the payload is dropped everywhere.
  await expect(dialog.locator('a[href^="javascript:"]')).toHaveCount(0)

  await section.getByTestId('save-platform-links').click()
  await expect(section.getByTestId('save-platform-links')).toContainText('Saved to your profiles')
  await expect(section.getByTestId('save-platform-links')).toBeDisabled()
  await page.keyboard.press('Escape')
  const stored = await page.evaluate(() => (JSON.parse(localStorage.getItem('media-codex-saved-links-v1') || '{"links":[]}').links as { url: string }[]).map((link) => link.url))
  expect(stored.sort()).toEqual(['https://onlyfans.com/christianhogue', 'https://www.redgifs.com/users/hoguesdirtylaundry', 'https://x.com/hogue_x'])
  await expect(page.getByTestId('saved-card')).toHaveCount(3)
  expect(hits).toEqual([])
})

test('saved Redgifs handles open the public catalog in the existing drawer; subscription cards cannot', async ({ page }) => {
  const seen: string[] = []
  await mockCreatorApis(page, seen)
  await mockRelated(page, [])
  await page.goto('/creators')
  await pasteSaved(page, 'https://www.redgifs.com/users/HoguesDirtyLaundry https://onlyfans.com/aaron.vale')
  const rg = page.getByTestId('saved-card').filter({ hasText: 'Redgifs' })
  await expect(rg.getByTestId('saved-open')).toHaveAttribute('href', 'https://www.redgifs.com/users/hoguesdirtylaundry')
  await expect(page.getByTestId('saved-card').filter({ hasText: 'OnlyFans' }).getByTestId('saved-open-catalog')).toHaveCount(0)
  await rg.getByTestId('saved-open-catalog').click()
  const dialog = page.getByRole('dialog', { name: 'Creator hoguesdirtylaundry' })
  await expect(dialog).toContainText('Full catalog')
  expect(seen.some((url) => url.includes('creator=hoguesdirtylaundry') && url.includes('strict=0'))).toBe(true)
})

test('export and import saved profiles as JSON, with validation', async ({ page }) => {
  await mockCreatorApis(page, [])
  await page.goto('/creators')
  await pasteSaved(page, 'https://onlyfans.com/aaron.vale https://x.com/rowan_h example.com/me')
  await expect(page.getByTestId('saved-card')).toHaveCount(3)

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('saved-export').click()])
  expect(download.suggestedFilename()).toMatch(/^media-codex-saved-profiles-\d{4}-\d{2}-\d{2}\.json$/)
  const body = await readFile((await download.path())!, 'utf8')
  const exported = JSON.parse(body)
  expect(exported.kind).toBe('saved-profile-links')
  expect(exported.links.map((link: { url: string }) => link.url).sort()).toEqual(['https://example.com/me', 'https://onlyfans.com/aaron.vale', 'https://x.com/rowan_h'])

  await page.getByRole('button', { name: 'Clear all' }).click()
  await page.getByRole('button', { name: 'Yes, clear' }).click()
  await expect(page.getByTestId('saved-card')).toHaveCount(0)
  await expect(page.getByTestId('saved-count')).toHaveText('0/300')

  const input = page.getByTestId('saved-import-input')
  await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{nope') })
  await expect(page.getByTestId('saved-summary')).toContainText('Import failed')
  await input.setInputFiles({
    name: 'hostile.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, links: [{ url: 'javascript:alert(1)' }, { url: 'http://localhost/x' }] })),
  })
  await expect(page.getByTestId('saved-summary')).toContainText('None of the links')
  await expect(page.getByTestId('saved-card')).toHaveCount(0)

  await input.setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(body) })
  await expect(page.getByTestId('saved-summary')).toContainText('3 imported')
  await expect(page.getByTestId('saved-card')).toHaveCount(3)
  // Importing the same file again adds nothing.
  await input.setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(body) })
  await expect(page.getByTestId('saved-summary')).toContainText('0 imported')
  await expect(page.getByTestId('saved-card')).toHaveCount(3)
})

test('Find a creator holds subscription links: open or save, search public sources only on request', async ({ page }) => {
  const hits = watchSubscriptionHosts(page)
  const resolved: string[] = []
  await mockCreatorApis(page, [])
  await page.route('**/api/creator-resolve*', (route) => {
    resolved.push(new URL(route.request().url()).searchParams.get('q') || '')
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ query: 'x', candidates: [], tried: [], updatedAt: new Date().toISOString() }) })
  })
  await page.goto('/creators')
  await page.getByRole('combobox', { name: /Find a creator/i }).fill('https://onlyfans.com/someone.cool')
  const offer = page.getByTestId('finder-profile-offer')
  await expect(offer.getByTestId('subscribe-link')).toHaveAttribute('href', 'https://onlyfans.com/someone.cool')
  await expect(offer).toContainText('Subscription content stays behind')
  await page.waitForTimeout(700)
  expect(resolved).toEqual([]) // nothing is sent anywhere for a subscription link
  await offer.getByTestId('finder-save-profile').click()
  await expect(offer.getByTestId('finder-save-profile')).toContainText('Saved to your profiles')
  await expect(page.getByTestId('saved-card')).toHaveCount(1)
  await offer.getByTestId('finder-search-anyway').click()
  await expect.poll(() => resolved).toEqual(['someone.cool'])
  expect(hits).toEqual([])
})

test('phone width, lite graphics on: no horizontal overflow, bounded mounted cards', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockCreatorApis(page, [])
  await page.route('**/api/creator-directory*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      creators: Array.from({ length: 40 }, (_, i) => ({ ...directoryCreator, id: `dir-${i}`, name: `Creator ${i}`, username: `creator${i}`, profileUrl: `https://www.redgifs.com/users/creator${i}`, profileLinks: [{ label: 'OnlyFans', url: `https://onlyfans.com/creator${i}` }] })),
      nextCursor: null, total: 40, lanes: [], updatedAt: new Date().toISOString(),
    }),
  }))
  await page.addInitScript(() => {
    const links = Array.from({ length: 30 }, (_, i) => ({ url: `https://x.com/saved_user${i}`, addedAt: Date.now() - i * 1000 }))
    localStorage.setItem('media-codex-saved-links-v1', JSON.stringify({ v: 1, links }))
  })
  await page.goto('/creators?lite=1')
  await expect(page.locator('html')).toHaveAttribute('data-lite', 'true')
  await expect(page.getByTestId('saved-card')).toHaveCount(12)
  await expect(page.getByRole('button', { name: /Show more saved profiles · 18 left/ })).toBeVisible()
  await expect(page.getByTestId('creator-grid').locator('article')).toHaveCount(12)
  await expect(page.getByTestId('platform-filter')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await page.getByRole('button', { name: /Show more saved profiles/ }).click()
  await expect(page.getByTestId('saved-card')).toHaveCount(24)
})
