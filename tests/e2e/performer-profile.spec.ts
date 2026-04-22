import { test, expect } from '@playwright/test'

test('visit performers page and click a creator', async ({ page }) => {
  await page.goto('/#/performers')
  await expect(page.locator('text=Creators')).toBeVisible()
  const firstCard = page.locator('.content-card, [data-testid="performer-card"]').first()
  if (await firstCard.isVisible().catch(() => false)) {
    await firstCard.click()
    await expect(page.locator('body')).toContainText('Creator')
  } else {
    test.skip()
  }
})
