import { expect, test, type Page } from '@playwright/test'

/** Lobby ohne echten Server: /me liefert das Profil dieser IP. */
async function asLoggedInAccount(page: Page): Promise<void> {
  await page.route('**/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        userId: '11111111-1111-4111-8111-111111111111',
        nickname: 'NeonNinja',
        skin: 7,
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

  test('Neue IP: Namensfeld statt Login, Lobby bleibt versteckt', async ({ page }) => {
    await page.route('**/me', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ error: 'NO_SESSION' }),
      }),
    )
    await page.goto('/')
    await expect(page.locator('#name-card')).toBeVisible()
    await expect(page.locator('#join-card')).toBeHidden()
    await expect(page.locator('#name-input')).toBeVisible()
    await expect(page.locator('#auth-email')).toHaveCount(0)
    await expect(page.locator('[data-mode]')).toHaveCount(0)
  })

  test('Namenswahl: ungültiger Name zeigt Fehler und sendet nichts', async ({ page }) => {
    await page.goto('/')
    await page.fill('#name-input', 'a b')
    await page.click('#name-submit')
    await expect(page.locator('#name-error')).toContainText('Spielername')
    await expect(page.locator('#join-card')).toBeHidden()
  })

  test('Lobby: Name aus dem Profil, kein Namensfeld, Match beitreten', async ({ page }) => {
    await asLoggedInAccount(page)
    await page.goto('/')
    await expect(page.locator('#lobby-name')).toHaveText('NeonNinja')
    await expect(page.locator('#play')).toHaveText('Match beitreten')
    await expect(page.locator('#nickname')).toHaveCount(0)
  })

  test('Lobby: Name nachträglich ändern', async ({ page }) => {
    await asLoggedInAccount(page)
    await page.route('**/me/name', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': 'http://localhost:5173',
          'access-control-allow-credentials': 'true',
        },
        body: JSON.stringify({ userId: '11111111-1111-4111-8111-111111111111', nickname: 'NeuerName', skin: 7 }),
      }),
    )
    await page.goto('/')
    await expect(page.locator('#rename-row')).toBeHidden()
    await page.click('#rename-btn')
    await expect(page.locator('#rename-input')).toHaveValue('NeonNinja')
    await page.fill('#rename-input', 'a b')
    await page.click('#rename-save')
    await expect(page.locator('#rename-error')).toContainText('Spielername')
    await page.fill('#rename-input', 'NeuerName')
    await page.click('#rename-save')
    await expect(page.locator('#lobby-name')).toHaveText('NeuerName')
    await expect(page.locator('#rename-row')).toBeHidden()
  })
})
