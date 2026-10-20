import { describe, expect, it, vi } from 'vitest'
import { MemoryProfileStore, PrismaProfileStore, type ProfileDb } from './profiles.js'

describe('ProfileStore', () => {
  it('Memory: mehrere Profile pro IP bleiben getrennt, IPv4-mapped IPv6 wird normalisiert', async () => {
    const s = new MemoryProfileStore()
    const a = await s.create('Alt', '1.2.3.4')
    const b = await s.create('Neu', '::ffff:1.2.3.4')
    expect(a.id).not.toBe(b.id)
    expect(b.ip).toBe('1.2.3.4')
    expect(await s.findById('gibts-nicht')).toBeNull()
    await s.rename(a.id, 'Alt2')
    await s.setSkin(b.id, 7)
    expect((await s.findById(a.id))?.nickname).toBe('Alt2')
    expect((await s.findById(b.id))?.skin).toBe(7)
  })

  it('Prisma: speichert normalisierte IP, liest per ID', async () => {
    const db = {
      user: {
        create: vi.fn(async () => ({})),
        findUnique: vi.fn(async () => ({ id: 'u1', nickname: 'N', skin: 3, ip: '1.2.3.4' })),
        update: vi.fn(async () => ({})),
      },
    }
    const s = new PrismaProfileStore(db as unknown as ProfileDb)
    const p = await s.create('N', '::ffff:1.2.3.4')
    expect(p.ip).toBe('1.2.3.4')
    expect(db.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ nickname: 'N', ip: '1.2.3.4', isGuest: false }) })
    expect((await s.findById('u1'))?.skin).toBe(3)
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } })
    await s.rename('u1', 'X')
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { nickname: 'X' } })
  })
})
