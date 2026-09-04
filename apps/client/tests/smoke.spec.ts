import { expect, test, type Page } from '@playwright/test'

async function joinAs(page: Page, nickname: string) {
  await page.goto('/')
  await page.fill('#nickname', nickname)
  await page.click('#play')
  await page.waitForFunction(() => window.__arena.connected(), null, { timeout: 15_000 })
}

async function playerCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__arena.players().length)
}

async function ownX(page: Page, nickname: string): Promise<number> {
  return page.evaluate(
    (nick) => window.__arena.players().find((p) => p.nickname === nick)?.x ?? NaN,
    nickname,
  )
}

// M1-05: 2 Clients joinen, sehen einander, Bewegung erscheint gegenueber (<200 ms lokal).
test('2 Clients joinen und bewegen sich', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  try {
    await joinAs(pageA, 'Alpha')
    await joinAs(pageB, 'Beta')

    await expect
      .poll(async () => playerCount(pageA), { timeout: 15_000 })
      .toBe(2)
    await expect.poll(async () => playerCount(pageB), { timeout: 15_000 }).toBe(2)

    const x0 = await ownX(pageA, 'Alpha')
    expect(Number.isFinite(x0)).toBe(true)

    await pageA.keyboard.down('d')
    await expect
      .poll(async () => ownX(pageB, 'Alpha'), { timeout: 15_000 })
      .toBeGreaterThan(x0)
    await pageA.keyboard.up('d')
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})
