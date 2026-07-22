import { test, expect } from '@playwright/test'
import { installAppFixture } from './fixtures'

test('visit media page, scroll, and click an item', async ({ page }) => {
  await installAppFixture(page)
  await page.goto('/media')
  await expect(page.locator('[data-testid="video-tile"]').first()).toContainText('Studio signal')
  await page.evaluate(() => window.scrollBy(0, 500))
  await expect(page.locator('[data-testid="video-tile"]').first()).toBeVisible()
})
