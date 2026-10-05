import { test, expect } from '@playwright/test'
// VP8/WebM fixture (see queue-fixtures.ts): sandboxed Chromium builds cannot decode the H.264 clip used by the older fixtures.
import { installQueueFixture } from './queue-fixtures'

test('click video and verify player opens', async ({ page }) => {
  await installQueueFixture(page)
  await page.goto('/media')
  const playButton = page.getByRole('button', { name: 'Play', exact: true })
  await expect(playButton).toBeVisible()
  await playButton.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Alpha clip' })).toBeVisible()
  const video = dialog.locator('video')
  await expect(video).toBeVisible()
  const playVideo = dialog.getByRole('button', { name: 'Play video' })
  if (await playVideo.isVisible()) await playVideo.click()
  await expect.poll(async () => video.evaluate((node) => ({
    currentTime: node.currentTime,
    readyState: node.readyState,
    videoWidth: node.videoWidth,
  }))).toMatchObject({
    readyState: 4,
    videoWidth: 320,
  })
  await expect.poll(async () => video.evaluate((node) => node.currentTime)).toBeGreaterThan(0)
  await expect(dialog.getByRole('status', { name: 'Loading video' })).toBeHidden()

  const viewport = page.viewportSize()
  const dialogBox = await dialog.boundingBox()
  const videoBox = await video.boundingBox()
  expect(viewport).not.toBeNull()
  expect(dialogBox).not.toBeNull()
  expect(videoBox).not.toBeNull()
  expect(dialogBox!.width).toBeLessThanOrEqual(viewport!.width)
  expect(videoBox!.width).toBeLessThanOrEqual(viewport!.width)
  expect(videoBox!.height).toBeLessThanOrEqual(viewport!.height)

  if (viewport!.width < 768) {
    expect(dialogBox!.width).toBeGreaterThanOrEqual(viewport!.width * 0.9)
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Share', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
})

test('custom controls: scrubber, settings menu, keyboard seek and mute', async ({ page }) => {
  await installQueueFixture(page)
  await page.goto('/media')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const video = dialog.locator('video')
  await expect(video).toBeVisible()
  await expect.poll(async () => video.evaluate((node) => node.readyState)).toBeGreaterThanOrEqual(3)
  // The native control UI is replaced by ours.
  expect(await video.evaluate((node) => node.controls)).toBe(false)
  const viewport = page.viewportSize()!
  const desktop = viewport.width >= 768
  if (desktop) await page.mouse.move(viewport.width / 2, viewport.height / 2)
  else {
    const box = (await video.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  }
  const seek = dialog.getByRole('slider', { name: 'Seek' })
  await expect(seek).toBeVisible()
  await expect(seek).toHaveAttribute('aria-valuemin', '0')
  await dialog.getByRole('button', { name: 'Settings' }).click()
  const menu = dialog.getByRole('menu', { name: 'Player settings' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitemradio', { name: '1.5×' }).click()
  await expect.poll(async () => video.evaluate((node) => node.playbackRate)).toBe(1.5)
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(dialog).toBeVisible()
  if (desktop) {
    await video.evaluate((node) => { node.pause(); node.currentTime = 1 })
    await page.keyboard.press('l')
    await expect.poll(async () => video.evaluate((node) => node.currentTime)).toBeGreaterThan(1.5)
    const wasMuted = await video.evaluate((node) => node.muted)
    await page.keyboard.press('m')
    await expect.poll(async () => video.evaluate((node) => node.muted)).toBe(!wasMuted)
  }
})
