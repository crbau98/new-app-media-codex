import { test, expect } from '@playwright/test'
import { installAppFixture } from './fixtures'

test('click video and verify player opens', async ({ page }) => {
  await installAppFixture(page)
  await page.goto('/media')
  const playButton = page.getByRole('button', { name: 'Play', exact: true })
  await expect(playButton).toBeVisible()
  await playButton.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Studio signal' })).toBeVisible()
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
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Share' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
})
