import { expect, test } from '@playwright/test'

// M0-Platzhalter, wird in M1-05 zum echten 2-Client-Smoke ausgebaut.
test('client laedt mit Canvas', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#game')).toBeVisible()
})
