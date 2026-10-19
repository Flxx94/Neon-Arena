import { describe, expect, it } from 'vitest'
import { MemoryBanStore, RedisBanStore, normalizeIp } from './bans.js'

describe('IP-Banns', () => {
  it('normalisiert IPv4-mapped IPv6', () => {
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4')
    expect(normalizeIp(' 1.2.3.4 ')).toBe('1.2.3.4')
    expect(normalizeIp('2001:DB8::1')).toBe('2001:db8::1')
  })

  it('Memory: bannen, pruefen, listen, entbannen', async () => {
    const s = new MemoryBanStore()
    expect(await s.isBanned('1.2.3.4')).toBe(false)
    await s.add({ ip: '::ffff:1.2.3.4', nickname: 'Troll', at: 1 })
    await s.add({ ip: '5.6.7.8', nickname: 'Spam', at: 2 })
    expect(await s.isBanned('1.2.3.4')).toBe(true)
    expect((await s.list()).map((b) => b.nickname)).toEqual(['Spam', 'Troll'])
    expect(await s.remove('1.2.3.4')).toBe(true)
    expect(await s.remove('1.2.3.4')).toBe(false)
    expect(await s.isBanned('::ffff:1.2.3.4')).toBe(false)
  })

  it('Redis-Store spricht den Hash `bans:ip`', async () => {
    const h = new Map<string, string>()
    const s = new RedisBanStore({
      hExists: async (_k, f) => h.has(f),
      hSet: async (_k, f, v) => void h.set(f, v),
      hDel: async (_k, f) => (h.delete(f) ? 1 : 0),
      hGetAll: async () => Object.fromEntries(h),
    })
    await s.add({ ip: '9.9.9.9', nickname: 'X', at: 5 })
    expect(await s.isBanned('9.9.9.9')).toBe(true)
    expect((await s.list())[0]!.nickname).toBe('X')
    expect(await s.remove('9.9.9.9')).toBe(true)
    expect(await s.list()).toEqual([])
  })
})
