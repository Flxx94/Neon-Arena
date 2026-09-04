import { expect, test, type Page } from '@playwright/test'

async function joinAs(page: Page, nickname: string) {
  await page.goto('/')
  await page.fill('#nickname', nickname)
  await page.click('#play')
  await page.waitForFunction(() => window.__arena.connected(), null, { timeout: 15_000 })
}

async function playerNames(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__arena.players().map((p) => p.nickname))
}

async function ownX(page: Page, nickname: string): Promise<number> {
  return page.evaluate(
    (nick) => window.__arena.players().find((p) => p.nickname === nick)?.x ?? NaN,
    nickname,
  )
}

async function projectileCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__arena.projectiles().length)
}

// M1-05: 2 Clients joinen, sehen einander, Bewegung erscheint gegenueber (<200 ms lokal).
// M2: Schuss erzeugt serverseitig Projektile.
test('2 Clients joinen und bewegen sich', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    await joinAs(pageA, 'Alpha')
    await joinAs(pageB, 'Beta')

    // Beide echten Spieler sehen einander (Bots fuellen ggf. auf).
    await expect
      .poll(async () => playerNames(pageA), { timeout: 15_000 })
      .toEqual(expect.arrayContaining(['Alpha', 'Beta']))
    await expect
      .poll(async () => playerNames(pageB), { timeout: 15_000 })
      .toEqual(expect.arrayContaining(['Alpha', 'Beta']))

    // M3: Scoreboard lebt und listet beide Nicknames.
    await expect(pageA.locator('#scoreboard')).toBeVisible()
    await expect(pageA.locator('#scoreboard')).toContainText('Alpha')
    await expect(pageA.locator('#scoreboard')).toContainText('Beta')

    const x0 = await ownX(pageA, 'Alpha')
    expect(Number.isFinite(x0)).toBe(true)

    await pageA.keyboard.down('d')
    await expect
      .poll(async () => ownX(pageB, 'Alpha'), { timeout: 15_000 })
      .toBeGreaterThan(x0)
    await pageA.keyboard.up('d')

    await pageA.mouse.move(800, 400)
    await pageA.mouse.down()
    await expect
      .poll(async () => projectileCount(pageA), { timeout: 15_000 })
      .toBeGreaterThan(0)
    await pageA.mouse.up()
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})
