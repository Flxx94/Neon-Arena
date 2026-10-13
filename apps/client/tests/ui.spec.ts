import { expect, test } from '@playwright/test'

// UI v3: Tests brauchen keinen Server (nur Startscreen/Einstellungen).
test.describe('UI v3 (ohne Server)', () => {
  test('Theme-Umschalter wechselt Hell/Dunkel und merkt sich die Wahl', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.click('#theme-toggle')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  test('Figurenwahl: Modell + Farbe wechseln', async ({ page }) => {
    await page.goto('/')
    const before = await page.locator('#model-name').textContent()
    await page.click('#model-next')
    await expect(page.locator('#model-name')).not.toHaveText(before ?? '')
    await page.click('.swatch:nth-child(3)')
    await expect(page.locator('.swatch:nth-child(3)')).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('.swatch[aria-checked="true"]')).toHaveCount(1)
  })

  test('Einstellungen: Esc öffnet/schließt, Design-Auswahl wirkt', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Escape')
    await expect(page.locator('#settings')).toBeVisible()
    await page.click('[data-theme-pref="light"]')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.keyboard.press('Escape')
    await expect(page.locator('#settings')).toBeHidden()
  })

  test('Ungültiger Nickname zeigt Fehler und blockt den Join', async ({ page }) => {
    await page.goto('/')
    await page.fill('#nickname', 'a b')
    await page.click('#play')
    await expect(page.locator('#join-error')).toContainText('Nickname')
    await expect(page.locator('#join')).toBeVisible()
  })
})
