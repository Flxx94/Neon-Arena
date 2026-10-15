import { expect, test, type Page } from '@playwright/test'

/** Lobby ohne echten Server: /me liefert eine Konto-Session. */
async function asLoggedInAccount(page: Page): Promise<void> {
  await page.route('**/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        userId: '11111111-1111-4111-8111-111111111111',
        nickname: 'NeonNinja',
        isGuest: false,
        skin: 7,
        email: 'neo@example.com',
      }),
    }),
  )
}

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

  test('Figurenwahl in der Lobby: Modell + Farbe wechseln', async ({ page }) => {
    await asLoggedInAccount(page)
    await page.goto('/')
    await expect(page.locator('#join-card')).toBeVisible()
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

  test('Ohne Session: Login-Seite mit Tabs, Lobby bleibt versteckt', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#auth-card')).toBeVisible()
    await expect(page.locator('#join-card')).toBeHidden()
    await expect(page.locator('#auth-submit')).toHaveText('Anmelden')
    await page.click('[data-mode="register"]')
    await expect(page.locator('#auth-submit')).toHaveText('Konto erstellen')
    await expect(page.locator('#auth-nickname')).toBeVisible()
    await page.click('[data-mode="guest"]')
    await expect(page.locator('#auth-email')).toBeHidden()
  })

  test('Registrierung: ungültige Eingaben zeigen Fehler und senden nichts', async ({ page }) => {
    await page.goto('/')
    await page.click('[data-mode="register"]')
    await page.fill('#auth-email', 'keine-email')
    await page.click('#auth-submit')
    await expect(page.locator('#auth-error')).toContainText('E-Mail')
    await page.fill('#auth-email', 'neo@example.com')
    await page.fill('#auth-password', 'kurz')
    await page.fill('#auth-nickname', 'a b')
    await page.click('#auth-submit')
    await expect(page.locator('#auth-error')).toContainText('Passwort')
    await page.fill('#auth-password', 'sehr-geheim-123')
    await page.click('#auth-submit')
    await expect(page.locator('#auth-error')).toContainText('Spielername')
    await expect(page.locator('#join-card')).toBeHidden()
  })

  test('Lobby: Name aus dem Konto, kein Namensfeld, Match beitreten', async ({ page }) => {
    await asLoggedInAccount(page)
    await page.goto('/')
    await expect(page.locator('#lobby-name')).toHaveText('NeonNinja')
    await expect(page.locator('#lobby-badge')).toHaveText('Konto')
    await expect(page.locator('#play')).toHaveText('Match beitreten')
    await expect(page.locator('#nickname')).toHaveCount(0)
  })
})
