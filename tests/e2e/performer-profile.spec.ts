import { test, expect } from '@playwright/test'
import { installAppFixture } from './fixtures'

test('visit performers page and click a creator', async ({ page }) => {
  await installAppFixture(page)
  await page.goto('/creators')
  await expect(page.getByRole('heading', { name: /Find male creators/i })).toBeVisible()
  await page.getByText('Signal Studio', { exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: 'Creator Signal Studio' })).toContainText('Shared public studio tags')
})
