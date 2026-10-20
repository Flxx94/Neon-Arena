import { describe, expect, it, vi } from 'vitest'
import { MemoryProfileStore, PrismaProfileStore, type ProfileDb } from './profiles.js'

describe('ProfileStore', () => {
  it('Memory: neuestes Profil pro IP, IPv4-mapped IPv6 zaehlt als gleiche IP', async () => {
    const s = new MemoryProfileStore()
    const a = await s.create('Alt', '1.2.3.4')
    const b = await s.create('Neu', '::ffff:1.2.3.4')
    expect((await s.findByIp('1.2.3.4'))?.id).toBe(b.id)
    expect(await s.findByIp('5.6.7.8')).toBeNull()
    await s.rename(a.id, 'Alt2')
    await s.setSkin(b.id, 7)
    expect((await s.findByIp('1.2.3.4'))?.skin).toBe(7)
  })

  it('Prisma: speichert normalisierte IP, sucht neuestes Profil', async () => {
    const db = {
      user: {
        create: vi.fn(async () => ({})),
        findFirst: vi.fn(async () => ({ id: 'u1', nickname: 'N', skin: 3, ip: '1.2.3.4' })),
        update: vi.fn(async () => ({})),
      },
    }
    const s = new PrismaProfileStore(db as unknown as ProfileDb)
    const p = await s.create('N', '::ffff:1.2.3.4')
    expect(p.ip).toBe('1.2.3.4')
    expect(db.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ nickname: 'N', ip: '1.2.3.4', isGuest: false }) })
    expect((await s.findByIp('1.2.3.4'))?.skin).toBe(3)
    expect(db.user.findFirst).toHaveBeenCalledWith({ where: { ip: '1.2.3.4' }, orderBy: { createdAt: 'desc' } })
    await s.rename('u1', 'X')
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { nickname: 'X' } })
  })
})
