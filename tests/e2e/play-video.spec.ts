import { test, expect } from '@playwright/test'
import { installAppFixture } from './fixtures'

test('click video and verify player opens', async ({ page }) => {
  await installAppFixture(page)
  await page.goto('/media')
  const videoTile = page.locator('[data-testid="video-tile"]').first()
  await expect(videoTile).toBeVisible()
  await videoTile.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Studio signal' })).toBeVisible()
  await expect(dialog.locator('video')).toBeVisible()
})
