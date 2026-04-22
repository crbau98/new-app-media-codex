import { test, expect } from '@playwright/test'

test('type in search and verify results update', async ({ page }) => {
  await page.goto('/#/media')
  const searchInput = page.locator('input[placeholder*="Search" i], input[type="search"]').first()
  await searchInput.fill('test query')
  await page.waitForTimeout(600)
  // Results container or no-results state should be visible
  await expect(page.locator('body')).toContainText('test query')
})
