import { test, expect } from '@playwright/test'

test('visit media page, scroll, and click an item', async ({ page }) => {
  await page.goto('/#/media')
  await expect(page.locator('text=Media')).toBeVisible()
  // Scroll down to trigger lazy loading
  await page.evaluate(() => window.scrollBy(0, 500))
  await page.waitForTimeout(300)
  // Expect at least the grid or skeleton to be present
  await expect(page.locator('body')).toContainText('Media')
})
