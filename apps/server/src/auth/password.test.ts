import { describe, expect, it } from 'vitest'
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password.js'

describe('Passwort-Hashing (scrypt)', () => {
  it('Roundtrip: richtiges Passwort passt, falsches nicht', async () => {
    const h = await hashPassword('correct horse battery')
    expect(h.startsWith('scrypt$')).toBe(true)
    expect(h).not.toContain('correct horse')
    expect(await verifyPassword('correct horse battery', h)).toBe(true)
    expect(await verifyPassword('correct horse batterz', h)).toBe(false)
    expect(await verifyPassword('', h)).toBe(false)
  })

  it('gleiches Passwort ergibt durch Salt verschiedene Hashes', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toBe(b)
    expect(await verifyPassword('same-password', a)).toBe(true)
    expect(await verifyPassword('same-password', b)).toBe(true)
  })

  it('kaputte oder manipulierte Formate werden abgewiesen statt zu werfen', async () => {
    expect(await verifyPassword('x', '')).toBe(false)
    expect(await verifyPassword('x', 'bcrypt$a$b')).toBe(false)
    expect(await verifyPassword('x', 'scrypt$1$1$1$AAAA$AAAA')).toBe(false)
    // Speicher-/CPU-Angriff ueber riesige Parameter: abgewiesen, ohne zu rechnen.
    expect(await verifyPassword('x', 'scrypt$1073741824$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA')).toBe(false)
  })

  it('verifyAgainstDummy wirft nicht', async () => {
    await expect(verifyAgainstDummy('irgendwas')).resolves.toBeUndefined()
  })
})
