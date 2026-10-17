import { describe, expect, it } from 'vitest'
import { inputSchema, joinSchema, loginSchema, registerSchema, skinChangeSchema, skinUpdateSchema } from './schemas.js'
import { PROTOCOL_V } from './protocol.js'
import { SKIN_COUNT } from './skins.js'

describe('shared schemas (M1-01 Vorgriff)', () => {
  it('akzeptiert gueltigen Join', () => {
    expect(joinSchema.parse({ nickname: 'Neo_1', protocolV: PROTOCOL_V })).toBeDefined()
  })

  it('lehnt Script-Nickname ab', () => {
    expect(() =>
      joinSchema.parse({ nickname: '<script>alert(1)</script>', protocolV: 1 }),
    ).toThrow()
  })

  it('alte Protokoll-Version passiert Schema (Gate entscheidet, M5-01)', () => {
    expect(joinSchema.parse({ nickname: 'Neo_1', protocolV: 0 }).protocolV).toBe(0)
  })

  it('akzeptiert Skin im gueltigen Bereich, lehnt ausserhalb ab', () => {
    expect(joinSchema.parse({ nickname: 'Neo_1', protocolV: 1, skin: 0 }).skin).toBe(0)
    expect(joinSchema.parse({ nickname: 'Neo_1', protocolV: 1, skin: SKIN_COUNT - 1 }).skin).toBe(
      SKIN_COUNT - 1,
    )
    expect(joinSchema.parse({ nickname: 'Neo_1', protocolV: 1 }).skin).toBeUndefined()
    for (const skin of [-1, SKIN_COUNT, 1.5, Number.NaN]) {
      expect(() => joinSchema.parse({ nickname: 'Neo_1', protocolV: 1, skin })).toThrow()
    }
  })

  it('stript unbekannte Felder in Input', () => {
    const parsed = inputSchema.parse({
      kind: 'input',
      seq: 7,
      dx: 1,
      dy: 0,
      aim: 0,
      fire: true,
      admin: true,
    })
    expect((parsed as Record<string, unknown>).admin).toBeUndefined()
  })
})

describe('Account-Schemas (ADR-005)', () => {
  const ok = { email: '  Neo@Example.COM ', password: 'sehr-geheim-123', nickname: 'Neo_1' }

  it('Register normalisiert die Email und strippt unbekannte Felder', () => {
    const r = registerSchema.parse({ ...ok, isAdmin: true })
    expect(r.email).toBe('neo@example.com')
    expect('isAdmin' in r).toBe(false)
  })

  it('Register lehnt kurze Passwoerter, kaputte Emails und Script-Namen ab', () => {
    expect(registerSchema.safeParse({ ...ok, password: '1234567' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...ok, password: 'x'.repeat(129) }).success).toBe(false)
    expect(registerSchema.safeParse({ ...ok, email: 'nope' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...ok, nickname: '<img onerror=1>' }).success).toBe(false)
  })

  it('Login braucht nur Email + nicht-leeres Passwort', () => {
    expect(loginSchema.safeParse({ email: 'a@b.de', password: 'x' }).success).toBe(true)
    expect(loginSchema.safeParse({ email: 'a@b.de', password: '' }).success).toBe(false)
  })

  it('Skin-Update prueft den Bereich', () => {
    expect(skinUpdateSchema.safeParse({ skin: 0 }).success).toBe(true)
    expect(skinUpdateSchema.safeParse({ skin: SKIN_COUNT }).success).toBe(false)
    expect(skinUpdateSchema.safeParse({ skin: 1.5 }).success).toBe(false)
  })

  it('Input: ult optional und nur boolean; Charakterwechsel prueft den Skin-Bereich', () => {
    const base = { kind: 'input', seq: 1, dx: 0, dy: 0, aim: 0, fire: false }
    expect(inputSchema.parse(base).ult).toBeUndefined()
    expect(inputSchema.parse({ ...base, ult: true }).ult).toBe(true)
    expect(inputSchema.safeParse({ ...base, ult: 'ja' }).success).toBe(false)
    expect(inputSchema.parse({ ...base, ult: true, ua: 1.2, ud: 0.5 }).ud).toBe(0.5)
    expect(inputSchema.safeParse({ ...base, ult: true, ud: 1.5 }).success).toBe(false)
    expect(inputSchema.safeParse({ ...base, ult: true, ua: 9 }).success).toBe(false)
    expect(skinChangeSchema.safeParse({ skin: 0 }).success).toBe(true)
    expect(skinChangeSchema.safeParse({ skin: SKIN_COUNT - 1 }).success).toBe(true)
    expect(skinChangeSchema.safeParse({ skin: SKIN_COUNT }).success).toBe(false)
    expect(skinChangeSchema.safeParse({ skin: -1 }).success).toBe(false)
    expect(skinChangeSchema.safeParse({ skin: 1.5 }).success).toBe(false)
  })
})
