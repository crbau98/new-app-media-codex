import { expect, test, type Page } from '@playwright/test'
import { CLIP_SECONDS, ITEMS, installQueueFixture, liveMediaPayload, openItem } from './queue-fixtures'

const QUEUE_KEY = 'media-codex-queue-v1'
const MOMENTS_KEY = 'media-codex-moments-v1'
const isTouch = (page: Page) => (page.viewportSize()?.width ?? 1024) < 768

/** A persisted queue (as a returning viewer would have it): `current` plays, `upcoming` follow. */
function queueState(current: string, upcoming: string[], extra: Record<string, unknown> = {}) {
  const items = liveMediaPayload().items
  const byId = new Map(items.map((item) => [item.id, item]))
  return {
    v: 1,
    nowPlaying: byId.get(current),
    upcoming: upcoming.map((id) => byId.get(id)),
    history: [],
    repeat: 'off',
    shuffle: false,
    autoplay: 'auto',
    order: null,
    ...extra,
  }
}

/** Move to another route without reloading, so the in-memory queue and dock keep running. */
async function navigateWithinApp(page: Page, label: string) {
  const link = page.getByRole('link', { name: label, exact: true }).first()
  if (await link.isVisible().catch(() => false)) await link.click()
  else await page.getByRole('button', { name: label, exact: true }).first().click()
}

async function startPlaying(page: Page, dialog: ReturnType<Page['getByRole']>) {
  const video = dialog.locator('video')
  await expect(video).toBeVisible()
  const big = dialog.getByRole('button', { name: 'Play video' })
  if (await big.isVisible().catch(() => false)) await big.click()
  await expect.poll(async () => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.1)
  return video
}

test.describe('queue', () => {
  test('add from the sheet, reorder by keyboard, Up next advances on its own, N and P navigate', async ({ page }) => {
    test.skip(isTouch(page), 'keyboard flow; touch layout is covered separately')
    await installQueueFixture(page)
    const dialog = await openItem(page, 'Alpha clip')
    await expect(dialog.locator('video')).toBeVisible()

    // Add to queue anchors the queue at what is playing; the related rail has quick-add buttons.
    await dialog.getByTestId('add-to-queue').click()
    await expect(dialog.getByTestId('queue-status')).toBeVisible()
    await dialog.getByRole('button', { name: 'Add Bravo clip to queue' }).click()
    await expect(dialog.getByTestId('sheet-queue-button')).toHaveAttribute('aria-label', /1 up next/)
    await dialog.getByRole('button', { name: 'Add Charlie clip to queue' }).click()
    await expect(dialog.getByTestId('sheet-queue-button')).toHaveAttribute('aria-label', /2 up next/)

    await dialog.getByTestId('sheet-queue-button').click()
    const panel = dialog.getByTestId('queue-panel')
    await expect(panel).toBeVisible()
    const rows = panel.getByTestId('queue-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('Bravo clip')

    // Keyboard reorder: focus Charlie's grip and press ↑.
    await panel.locator('[data-handle="q-charlie"]').focus()
    await page.keyboard.press('ArrowUp')
    await expect(rows.nth(0)).toContainText('Charlie clip')
    await expect(rows.nth(1)).toContainText('Bravo clip')
    await expect(panel.locator('[data-handle="q-charlie"]')).toBeFocused()

    // Esc closes only the drawer.
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(dialog).toBeVisible()

    // Reordering is persisted.
    await expect.poll(async () => page.evaluate((key) => (JSON.parse(localStorage.getItem(key) || 'null')?.upcoming ?? []).map((item: { id: string }) => item.id), QUEUE_KEY)).toEqual(['q-charlie', 'q-bravo'])

    // Play to the end: the Up next card counts down and advances to Charlie.
    const video = await startPlaying(page, dialog)
    await video.evaluate((node: HTMLVideoElement, t: number) => { node.currentTime = t }, CLIP_SECONDS - 0.6)
    const upNext = dialog.getByTestId('up-next')
    await expect(upNext).toBeVisible()
    await expect(upNext).toContainText('Charlie clip')
    await expect(dialog.getByRole('heading', { name: 'Charlie clip' })).toBeVisible({ timeout: 10_000 })
    await expect.poll(async () => dialog.locator('video').evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.1)
    await expect(dialog.getByText('Queue 2 / 3')).toBeVisible()

    // P goes back (we are within the first seconds), N goes forward again.
    await page.keyboard.press('p')
    await expect(dialog.getByRole('heading', { name: 'Alpha clip' })).toBeVisible()
    await page.keyboard.press('n')
    await expect(dialog.getByRole('heading', { name: 'Charlie clip' })).toBeVisible()
  })

  test('cancelling the Up next countdown keeps the finished video in place', async ({ page }) => {
    test.skip(isTouch(page), 'keyboard flow')
    await installQueueFixture(page, { seed: { [QUEUE_KEY]: queueState('q-alpha', ['q-bravo']) } })
    const dialog = await openItem(page, 'Alpha clip')
    const video = await startPlaying(page, dialog)
    await video.evaluate((node: HTMLVideoElement, t: number) => { node.currentTime = t }, CLIP_SECONDS - 0.5)
    const upNext = dialog.getByTestId('up-next')
    await expect(upNext).toBeVisible()
    await page.keyboard.press('Escape') // first Esc cancels the countdown, not the sheet
    await expect(upNext.getByRole('button', { name: 'Dismiss' })).toBeVisible()
    await page.waitForTimeout(6_000)
    await expect(dialog.getByRole('heading', { name: 'Alpha clip' })).toBeVisible()
    await upNext.getByRole('button', { name: 'Play now' }).click()
    await expect(dialog.getByRole('heading', { name: 'Bravo clip' })).toBeVisible()
  })

  test('with autoplay-next off the card waits for you', async ({ page }) => {
    test.skip(isTouch(page), 'keyboard flow')
    await installQueueFixture(page, { seed: { [QUEUE_KEY]: queueState('q-alpha', ['q-bravo'], { autoplay: 'off' }) } })
    const dialog = await openItem(page, 'Alpha clip')
    const video = await startPlaying(page, dialog)
    await video.evaluate((node: HTMLVideoElement, t: number) => { node.currentTime = t }, CLIP_SECONDS - 0.4)
    const upNext = dialog.getByTestId('up-next')
    await expect(upNext).toBeVisible()
    await page.waitForTimeout(6_000)
    await expect(dialog.getByRole('heading', { name: 'Alpha clip' })).toBeVisible()
    await upNext.getByRole('button', { name: 'Play now' }).click()
    await expect(dialog.getByRole('heading', { name: 'Bravo clip' })).toBeVisible()
  })

  test('the queue survives a reload (restored paused) and keeps playing while you browse', async ({ page }) => {
    await installQueueFixture(page, { seed: { [QUEUE_KEY]: queueState('q-alpha', ['q-bravo', 'q-charlie']) } })
    await page.goto('/media')
    const dock = page.getByTestId('queue-dock')
    await expect(dock).toBeVisible()
    await expect(dock.getByTestId('dock-title')).toHaveText('Alpha clip')
    const dockVideo = dock.getByTestId('dock-video')
    // Restored paused: nothing plays until the viewer asks.
    await page.waitForTimeout(600)
    expect(await dockVideo.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true)

    await dock.getByTestId('dock-toggle').click()
    await expect.poll(async () => dockVideo.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.3)

    // Client-side navigation: the dock (and its video) survive the route change.
    await navigateWithinApp(page, 'Search')
    await expect(page).toHaveURL(/\/search/)
    await expect(dock).toBeVisible()
    const before = await dockVideo.evaluate((node: HTMLVideoElement) => node.currentTime)
    await expect.poll(async () => dockVideo.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(before)

    await dock.getByTestId('dock-next').click()
    await expect(dock.getByTestId('dock-title')).toHaveText('Bravo clip')
    await expect.poll(async () => dock.getByTestId('dock-video').evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.1)

    // Reload: the current item is restored (paused), history/upcoming intact.
    await page.reload()
    await expect(page.getByTestId('queue-dock').getByTestId('dock-title')).toHaveText('Bravo clip')
    expect(await page.getByTestId('dock-video').evaluate((node: HTMLVideoElement) => node.paused)).toBe(true)

    // Expanding opens the full sheet on the same item.
    await page.getByRole('button', { name: 'Open Bravo clip' }).click()
    await expect(page.getByRole('dialog', { name: 'Bravo clip' })).toBeVisible()
    await expect(page.getByTestId('queue-dock')).toBeHidden()
  })

  test('closing the sheet hands playback to the dock at the same position, and expanding hands it back', async ({ page }) => {
    test.setTimeout(90_000)
    await installQueueFixture(page, { seed: { [QUEUE_KEY]: queueState('q-alpha', ['q-bravo']) } })
    const dialog = await openItem(page, 'Alpha clip')
    const video = await startPlaying(page, dialog)
    // Jump into the clip and close straight away: the dock carries on from there (the clip is only 4.9 s long).
    await video.evaluate((node: HTMLVideoElement) => { node.currentTime = 1.4 })
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    const dock = page.getByTestId('queue-dock')
    await expect(dock).toBeVisible()
    await expect(dock.getByTestId('dock-title')).toHaveText('Alpha clip')
    const dockVideo = dock.getByTestId('dock-video')
    // It carries on from where the sheet left off (not from 0:00) and keeps playing.
    await expect.poll(async () => dockVideo.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(1.2)
    expect(await dockVideo.evaluate((node: HTMLVideoElement) => node.paused)).toBe(false)
    // Pause so the short clip cannot end (and the dock advance) while we expand it.
    await dock.getByTestId('dock-toggle').click()
    await expect.poll(async () => dockVideo.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true)

    // Expanding back into the sheet keeps the position too.
    const before = await dockVideo.evaluate((node: HTMLVideoElement) => node.currentTime)
    await dock.getByRole('button', { name: 'Open Alpha clip' }).click()
    const sheet = page.locator('[role="dialog"][aria-labelledby="media-title"]')
    await expect(sheet.getByRole('heading', { name: 'Alpha clip' })).toBeVisible()
    await expect.poll(async () => sheet.locator('video').evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(Math.min(before, 3.5) - 0.3)
  })

  test('drag a queue row to reorder it', async ({ page }) => {
    test.skip(isTouch(page), 'mouse drag; touch reorder uses the same pointer events')
    await installQueueFixture(page, { seed: { [QUEUE_KEY]: queueState('q-alpha', ['q-bravo', 'q-charlie', 'q-photo']) } })
    await page.goto('/media')
    await page.getByTestId('dock-queue').click()
    const panel = page.getByTestId('queue-panel')
    const rows = panel.getByTestId('queue-row')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('Bravo clip')
    // Let the drawer finish sliding in before measuring where the grips are.
    await panel.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined))))

    const grip = panel.locator('[data-handle="q-photo"]')
    const gripBox = (await grip.boundingBox())!
    const topBox = (await rows.nth(0).boundingBox())!
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y - 20, { steps: 6 })
    await page.mouse.move(gripBox.x + gripBox.width / 2, topBox.y - 4, { steps: 12 })
    await page.mouse.up()

    await expect(rows.nth(0)).toContainText('Harbour light')
    await expect.poll(async () => page.evaluate((key) => (JSON.parse(localStorage.getItem(key) || 'null')?.upcoming ?? []).map((item: { id: string }) => item.id), QUEUE_KEY)).toEqual(['q-photo', 'q-bravo', 'q-charlie'])
  })

  test('Media Session next/previous track follow the queue', async ({ page }) => {
    await page.addInitScript(() => {
      const handlers: Record<string, (() => void) | null> = {}
      ;(window as unknown as { __msHandlers: typeof handlers }).__msHandlers = handlers
      if (navigator.mediaSession) {
        const original = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession)
        navigator.mediaSession.setActionHandler = (action, handler) => {
          handlers[action] = handler as (() => void) | null
          try { original(action, handler) } catch { /* unsupported action */ }
        }
      }
    })
    await installQueueFixture(page, { seed: { [QUEUE_KEY]: queueState('q-alpha', ['q-bravo']) } })
    const dialog = await openItem(page, 'Alpha clip')
    await startPlaying(page, dialog)
    await expect.poll(async () => page.evaluate(() => typeof (window as unknown as { __msHandlers: Record<string, unknown> }).__msHandlers.nexttrack)).toBe('function')
    await page.evaluate(() => (window as unknown as { __msHandlers: Record<string, () => void> }).__msHandlers.nexttrack())
    await expect(dialog.getByRole('heading', { name: 'Bravo clip' })).toBeVisible()
    await expect.poll(async () => page.evaluate(() => typeof (window as unknown as { __msHandlers: Record<string, unknown> }).__msHandlers.previoustrack)).toBe('function')
    await page.evaluate(() => (window as unknown as { __msHandlers: Record<string, () => void> }).__msHandlers.previoustrack())
    await expect(dialog.getByRole('heading', { name: 'Alpha clip' })).toBeVisible()
  })

  test('dock auto-advances through the queue when a video ends', async ({ page }) => {
    await installQueueFixture(page, { seed: { [QUEUE_KEY]: queueState('q-alpha', ['q-bravo']) } })
    await page.goto('/media')
    const dock = page.getByTestId('queue-dock')
    await dock.getByTestId('dock-toggle').click()
    const dockVideo = dock.getByTestId('dock-video')
    await expect.poll(async () => dockVideo.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.1)
    await dockVideo.evaluate((node: HTMLVideoElement, t: number) => { node.currentTime = t }, CLIP_SECONDS - 0.4)
    await expect(dock.getByTestId('dock-title')).toHaveText('Bravo clip', { timeout: 10_000 })
    await expect.poll(async () => dock.getByTestId('dock-video').evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.05)
  })

  test('queue drawer: shuffle, repeat, autoplay, clear and save as a collection', async ({ page }) => {
    await installQueueFixture(page, { seed: { [QUEUE_KEY]: queueState('q-alpha', ['q-bravo', 'q-charlie', 'q-photo']) } })
    await page.goto('/media')
    await page.getByTestId('dock-queue').or(page.getByRole('button', { name: /Open queue/ })).first().click()
    const panel = page.getByTestId('queue-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('queue-now-playing')).toContainText('Alpha clip')
    await expect(panel.getByTestId('queue-row')).toHaveCount(3)

    await panel.getByTestId('queue-shuffle').click()
    await expect(panel.getByTestId('queue-shuffle')).toHaveAttribute('aria-pressed', 'true')
    await expect(panel.getByTestId('queue-row')).toHaveCount(3)
    await panel.getByTestId('queue-shuffle').click()
    await expect(panel.getByTestId('queue-row').first()).toContainText('Bravo clip')

    const repeat = panel.getByTestId('queue-repeat')
    await expect(repeat).toHaveAttribute('data-repeat', 'off')
    await repeat.click()
    await expect(repeat).toHaveAttribute('data-repeat', 'all')
    await repeat.click()
    await expect(repeat).toHaveAttribute('data-repeat', 'one')

    const autoplay = panel.getByTestId('queue-autoplay')
    await expect(autoplay).toHaveAttribute('aria-checked', 'true')
    await autoplay.click()
    await expect(autoplay).toHaveAttribute('aria-checked', 'false')

    await panel.getByTestId('queue-row').nth(1).getByRole('button', { name: /Remove Charlie clip/ }).click()
    await expect(panel.getByTestId('queue-row')).toHaveCount(2)

    await panel.getByTestId('queue-save').click()
    await panel.getByLabel('Collection name').fill('Friday night')
    await page.keyboard.press('Enter')
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('media-codex-collections-v1') || '[]'))
    expect(saved[0].name).toBe('Friday night')
    expect(saved[0].itemIds).toEqual(['q-alpha', 'q-bravo', 'q-photo'])

    const clear = panel.getByTestId('queue-clear')
    await clear.click()
    await expect(clear).toHaveText(/Confirm clear/)
    await clear.click()
    await expect(panel.getByTestId('queue-empty')).toBeVisible()
    await expect(page.getByTestId('queue-dock')).toBeHidden()
  })

  test('shortcut help lists the queue and moment keys and closes without closing the sheet', async ({ page }) => {
    test.skip(isTouch(page), 'keyboard flow')
    await installQueueFixture(page)
    const dialog = await openItem(page, 'Alpha clip')
    await expect(dialog.locator('video')).toBeVisible()
    await page.keyboard.press('?')
    const help = dialog.getByTestId('shortcut-help')
    await expect(help).toBeVisible()
    for (const text of ['Next in queue', 'Previous (or restart)', 'Open the queue', 'Add this to the queue', 'Save a moment', 'Cancel the Up next countdown', 'Play / pause']) {
      await expect(help).toContainText(text)
    }
    await page.keyboard.press('Escape')
    await expect(help).toBeHidden()
    await expect(dialog).toBeVisible()
  })

  test('Shift+Q adds the current video to the queue; Q opens the drawer', async ({ page }) => {
    test.skip(isTouch(page), 'keyboard flow')
    await installQueueFixture(page)
    const dialog = await openItem(page, 'Alpha clip')
    await expect(dialog.locator('video')).toBeVisible()
    await page.keyboard.press('Shift+Q')
    await expect(dialog.getByTestId('queue-status')).toBeVisible()
    await page.keyboard.press('q')
    await expect(dialog.getByTestId('queue-panel')).toBeVisible()
    await expect(dialog.getByTestId('queue-now-playing')).toContainText('Alpha clip')
    await page.keyboard.press('q')
    await expect(dialog.getByTestId('queue-panel')).toBeHidden()
  })
})

test.describe('moments', () => {
  test('B saves a moment, the list jumps back to it, labels persist, clips loop', async ({ page }) => {
    test.setTimeout(90_000)
    test.skip(isTouch(page), 'keyboard flow')
    await installQueueFixture(page)
    const dialog = await openItem(page, 'Alpha clip')
    const video = await startPlaying(page, dialog)

    await video.evaluate((node: HTMLVideoElement) => { node.pause(); node.currentTime = 2 })
    await page.keyboard.press('b')
    const chip = dialog.getByTestId('moment-chip')
    await expect(chip).toContainText('Moment saved')
    await expect(chip).toContainText('0:02')
    await chip.getByRole('button', { name: 'Add label' }).click()
    await chip.getByLabel('Moment label').fill('the good bit')
    await page.keyboard.press('Enter')
    await expect(chip).toContainText('the good bit')

    const row = dialog.getByTestId('moment-row')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('the good bit')
    await expect(dialog.getByTestId('moment-tick')).toHaveCount(1)

    // Seek elsewhere, then jump back through the list.
    await video.evaluate((node: HTMLVideoElement) => { node.currentTime = 0.2 })
    await row.getByRole('button', { name: /Jump to the good bit/ }).click()
    await expect.poll(async () => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(1.8)

    // Only ids, metadata and timestamps are stored.
    await page.waitForTimeout(400)
    const stored = await page.evaluate((key) => localStorage.getItem(key), MOMENTS_KEY)
    expect(stored).toContain('"itemId":"q-alpha"')
    expect(stored).toContain('the good bit')
    expect(stored!.length).toBeLessThan(2000)
    expect(stored).not.toContain('base64')

    // Clip: A, A (set A and B), then B saves the range.
    await video.evaluate((node: HTMLVideoElement) => { node.currentTime = 1 })
    await page.keyboard.press('a')
    await video.evaluate((node: HTMLVideoElement) => { node.currentTime = 3 })
    await page.keyboard.press('a')
    await page.keyboard.press('b')
    await expect(chip).toContainText('Clip saved')
    await expect(row).toHaveCount(2)
    await expect(dialog.getByText('Loop', { exact: true })).toBeVisible()

    // Opening a clip from the list loops it: playback stays inside 1–3 s.
    await video.evaluate((node: HTMLVideoElement) => { node.currentTime = 0.1 })
    await row.getByRole('button', { name: /Play clip/ }).click()
    const samples: number[] = []
    for (let i = 0; i < 12; i += 1) {
      samples.push(await video.evaluate((node: HTMLVideoElement) => node.currentTime))
      await page.waitForTimeout(350)
    }
    expect(Math.min(...samples)).toBeGreaterThan(0.7)
    expect(Math.max(...samples)).toBeLessThan(3.4)
  })

  test('export and import round-trip through a JSON file', async ({ page }) => {
    test.skip(isTouch(page), 'download flow')
    await installQueueFixture(page, {
      seed: {
        [MOMENTS_KEY]: {
          v: 1,
          moments: [
            { id: 'mom-1', itemId: 'q-alpha', t: 2, label: 'first', createdAt: 1000, title: 'Alpha clip', creator: 'Signal Studio', thumbnail: 'https://fixture.invalid/poster-q-alpha.svg', duration: 5 },
            { id: 'mom-2', itemId: 'q-bravo', t: 1.5, end: 3.5, label: '', createdAt: 2000, title: 'Bravo clip', creator: 'Signal Studio', thumbnail: 'https://fixture.invalid/poster-q-bravo.svg', duration: 5 },
          ],
        },
      },
    })
    const dialog = await openItem(page, 'Alpha clip')
    await expect(dialog.getByTestId('moments-panel')).toBeVisible()
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export' }).click()])
    expect(download.suggestedFilename()).toMatch(/^media-codex-moments-\d{4}-\d{2}-\d{2}\.json$/)
    const path = await download.path()
    const { readFileSync } = await import('node:fs')
    const exported = JSON.parse(readFileSync(path, 'utf8'))
    expect(exported.kind).toBe('moments')
    expect(exported.moments).toHaveLength(2)

    // Import the same file back: nothing new; then a file with one new moment and one bad entry.
    await dialog.getByLabel('Import moments file').setInputFiles({ name: 'm.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) })
    await expect(page.getByText('Nothing new to import')).toBeVisible()
    const extra = { ...exported, moments: [{ id: 'mom-9', itemId: 'q-alpha', t: 4, label: 'imported', createdAt: 5000, title: 'Alpha clip', creator: 'Signal Studio', thumbnail: '' }, { nope: true }] }
    await dialog.getByLabel('Import moments file').setInputFiles({ name: 'm2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(extra)) })
    await expect(page.getByText('Moments imported')).toBeVisible()
    await expect(dialog.getByTestId('moment-row')).toHaveCount(2)
    await dialog.getByLabel('Import moments file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('not json') })
    await expect(page.getByText('Could not import moments')).toBeVisible()
  })
})

test.describe('player memory and resume', () => {
  test('playback speed is remembered per video', async ({ page }) => {
    test.skip(isTouch(page), 'keyboard flow')
    await installQueueFixture(page)
    let dialog = await openItem(page, 'Alpha clip')
    let video = await startPlaying(page, dialog)
    await page.mouse.move(700, 400)
    await dialog.getByRole('button', { name: 'Settings' }).click()
    await dialog.getByRole('menuitemradio', { name: '1.5×' }).click()
    await expect(dialog.getByText('Speed · remembered for this video')).toBeVisible()
    await expect.poll(async () => video.evaluate((node: HTMLVideoElement) => node.playbackRate)).toBe(1.5)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    // Another video starts at the last speed used, then gets its own.
    dialog = await openItem(page, 'Bravo clip')
    video = await startPlaying(page, dialog)
    await expect.poll(async () => video.evaluate((node: HTMLVideoElement) => node.playbackRate)).toBe(1.5)
    await page.keyboard.press('<')
    await page.keyboard.press('<')
    await expect.poll(async () => video.evaluate((node: HTMLVideoElement) => node.playbackRate)).toBe(1)
    await page.keyboard.press('Escape')

    // Alpha still remembers 1.5× even though the last speed used was 1×.
    dialog = await openItem(page, 'Alpha clip')
    video = await startPlaying(page, dialog)
    await expect.poll(async () => video.evaluate((node: HTMLVideoElement) => node.playbackRate)).toBe(1.5)
  })

  test('smart start offers the creator\'s usual start, explains itself, and can be switched off per creator', async ({ page }) => {
    test.skip(isTouch(page), 'keyboard flow')
    // The clip is only 4.9 s; present a long duration so the offer's "enough video left" rule can be exercised.
    await page.addInitScript(() => {
      Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get: () => 60 })
    })
    await installQueueFixture(page, { seed: { 'media-codex-smart-start-v1': { v: 1, creators: { 'signal studio': { samples: [30, 31, 29], updatedAt: 1 } } } } })
    const dialog = await openItem(page, 'Alpha clip')
    const chip = dialog.getByTestId('skip-start')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('Skip to 0:30')
    await expect(chip).toContainText('your usual start for @Signal Studio')
    const video = dialog.locator('video')
    await chip.getByRole('button', { name: /^Skip to/ }).click()
    await expect.poll(async () => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(4)
    await expect(chip).toBeHidden()

    // "Don't suggest again" forgets that creator on this device.
    await page.keyboard.press('Escape')
    const second = await openItem(page, 'Bravo clip')
    const secondChip = second.getByTestId('skip-start')
    await expect(secondChip).toBeVisible()
    await secondChip.getByRole('button', { name: /Don't suggest skipping/ }).click()
    await expect(secondChip).toBeHidden()
    expect(await page.evaluate(() => localStorage.getItem('media-codex-smart-start-v1'))).not.toContain('signal studio')
  })

  test('Moments rail on Home opens a moment at its saved time and a clip loops (when mounted by the integrator)', async ({ page }) => {
    test.skip(isTouch(page), 'keyboard flow')
    await installQueueFixture(page, {
      seed: {
        [MOMENTS_KEY]: {
          v: 1,
          moments: [{ id: 'mom-rail', itemId: 'q-alpha', t: 2, end: 3.4, label: 'rail clip', createdAt: 9000, title: 'Alpha clip', creator: 'Signal Studio', thumbnail: 'https://fixture.invalid/poster-q-alpha.svg', duration: 5 }],
        },
      },
    })
    await page.goto('/media')
    const rail = page.locator('section[aria-label="Your moments"]')
    await rail.waitFor({ timeout: 5_000 }).catch(() => undefined)
    test.skip((await rail.count()) === 0, 'MomentsRail is not mounted on Home yet — see the integration note in the report')
    await rail.getByTestId('moment-card').first().getByRole('button', { name: /Play clip/ }).click()
    const dialog = page.locator('[role="dialog"][aria-labelledby="media-title"]')
    const video = dialog.locator('video')
    await expect(video).toBeVisible()
    await expect.poll(async () => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(1.8)
    const samples: number[] = []
    for (let i = 0; i < 10; i += 1) {
      samples.push(await video.evaluate((node: HTMLVideoElement) => node.currentTime))
      await page.waitForTimeout(350)
    }
    expect(Math.min(...samples)).toBeGreaterThan(1.7)
    expect(Math.max(...samples)).toBeLessThan(3.8)
  })

  test('Continue watching is newest-first with remove and clear', async ({ page }) => {
    const now = Date.now()
    await installQueueFixture(page, {
      seed: {
        'media-codex-progress-v1': {
          'q-alpha': { itemId: 'q-alpha', seconds: 60, duration: 100, updatedAt: now - 60_000 },
          'q-bravo': { itemId: 'q-bravo', seconds: 40, duration: 100, updatedAt: now - 1_000 },
          'q-charlie': { itemId: 'q-charlie', seconds: 98, duration: 100, updatedAt: now },
        },
      },
    })
    await page.goto('/media')
    const rail = page.getByRole('region', { name: 'Continue watching' }).or(page.locator('section[aria-label="Continue watching"]')).first()
    await expect(rail).toBeVisible()
    const cards = rail.getByTestId('video-tile')
    await expect(cards).toHaveCount(2) // the finished video (98%) is not offered
    await expect(cards.nth(0)).toContainText('Bravo clip')
    await expect(cards.nth(1)).toContainText('Alpha clip')

    await rail.getByRole('button', { name: 'Remove Bravo clip from Continue watching' }).click()
    await expect(cards).toHaveCount(1)
    await expect(cards.nth(0)).toContainText('Alpha clip')

    const clear = rail.getByTestId('continue-clear')
    await clear.click()
    await expect(clear).toHaveText('Confirm clear all')
    await clear.click()
    await expect(rail).toBeHidden()
    expect(await page.evaluate(() => localStorage.getItem('media-codex-progress-v1'))).toBeNull()
  })
})

test.describe('phones', () => {
  test('sheet header queue button, drawer and dock fit the screen without horizontal scroll', async ({ page }) => {
    test.skip(!isTouch(page), 'phone layout')
    await installQueueFixture(page)
    const dialog = await openItem(page, 'Alpha clip')
    await expect(dialog.locator('video')).toBeVisible()
    await dialog.getByTestId('add-to-queue').click()
    await dialog.getByRole('button', { name: 'Add Bravo clip to queue' }).click()
    await dialog.getByTestId('sheet-queue-button').click()
    const panel = dialog.getByTestId('queue-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('queue-row')).toHaveCount(1)
    const box = (await panel.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    await panel.getByRole('button', { name: 'Close queue' }).click()
    await expect(panel).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    // Closing the sheet leaves the dock up, inside the viewport and above the tab bar.
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    const dock = page.getByTestId('queue-dock')
    await expect(dock).toBeVisible()
    const dockBox = (await dock.boundingBox())!
    expect(dockBox.x).toBeGreaterThanOrEqual(0)
    expect(dockBox.x + dockBox.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await dock.getByTestId('dock-next').click()
    await expect(dock.getByTestId('dock-title')).toHaveText('Bravo clip')
  })

  test('Save moment is a tap target in the control bar', async ({ page }) => {
    test.skip(!isTouch(page), 'phone layout')
    await installQueueFixture(page)
    const dialog = await openItem(page, 'Alpha clip')
    const video = await startPlaying(page, dialog)
    const box = (await video.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await video.evaluate((node: HTMLVideoElement) => { node.pause(); node.currentTime = 2 })
    const save = dialog.getByRole('button', { name: 'Save moment (B)' })
    await expect(save).toBeVisible()
    const saveBox = (await save.boundingBox())!
    expect(saveBox.width).toBeGreaterThanOrEqual(40)
    await save.click()
    await expect(dialog.getByTestId('moment-chip')).toContainText('Moment saved')
    await expect(dialog.getByTestId('moment-row')).toHaveCount(1)
    expect(ITEMS.length).toBe(4)
  })
})
