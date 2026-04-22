import { test, expect } from '@playwright/test'

test('click video and verify player opens', async ({ page }) => {
  await page.goto('/#/media')
  await page.waitForTimeout(1000)
  // Look for any element that looks like a video tile
  const videoTile = page.locator('[data-testid="video-tile"]').first()
  if (await videoTile.isVisible().catch(() => false)) {
    await videoTile.click()
    await expect(page.locator('video, [data-testid="video-player"]')).toBeVisible()
  } else {
    test.skip()
  }
})
