import { describe, expect, it } from 'vitest'
import { MemoryRateStore, checkLimit } from './limiter.js'

describe('rate limiter (M4-05)', () => {
  it('laesst Limit durch, blockiert danach', async () => {
    const store = new MemoryRateStore()
    for (let i = 0; i < 30; i++) {
      expect(await checkLimit(store, 'k', 30, 1000)).toBe(true)
    }
    expect(await checkLimit(store, 'k', 30, 1000)).toBe(false)
  })

  it('Fenster laeuft ab', async () => {
    const store = new MemoryRateStore()
    expect(await checkLimit(store, 'k', 1, 30)).toBe(true)
    expect(await checkLimit(store, 'k', 1, 30)).toBe(false)
    await new Promise((r) => setTimeout(r, 50))
    expect(await checkLimit(store, 'k', 1, 30)).toBe(true)
  })

  it('Keys sind unabhaengig', async () => {
    const store = new MemoryRateStore()
    expect(await checkLimit(store, 'a', 1, 60_000)).toBe(true)
    expect(await checkLimit(store, 'b', 1, 60_000)).toBe(true)
    expect(await checkLimit(store, 'a', 1, 60_000)).toBe(false)
  })
})
