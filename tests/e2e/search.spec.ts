import { test, expect } from '@playwright/test'
import { installAppFixture } from './fixtures'

test('type in search and verify results update', async ({ page }) => {
  await installAppFixture(page)
  await page.goto('/search')
  const searchInput = page.getByPlaceholder('Search — or filter: tag:jock')
  await searchInput.fill('Studio')
  await expect(searchInput).toHaveValue('Studio')
  await expect(page.getByText('Studio signal').first()).toBeVisible()
})
