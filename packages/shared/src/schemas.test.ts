import { describe, expect, it } from 'vitest'
import { inputSchema, joinSchema, profileNameSchema, skinChangeSchema, skinUpdateSchema } from './schemas.js'
import { adminAuthSchema, adminPlayerSchema, adminRoundSchema } from './schemas.js'
import { PROTOCOL_V } from './protocol.js'
import { SKIN_COUNT } from './skins.js'

describe('shared schemas (M1-01 Vorgriff)', () => {
  it('akzeptiert gueltigen Join', () => {
    expect(joinSchema.parse({ nickname: 'Neo_1', protocolV: PROTOCOL_V })).toBeDefined()
  })

  it('lehnt Script-Nickname ab', () => {
    expect(() =>
      joinSchema.parse({ nickname: '<script>alert(1)</script>', protocolV: PROTOCOL_V }),
    ).toThrow()
  })

  it('alte Protokoll-Version passiert Schema (Gate entscheidet, M5-01)', () => {
    expect(joinSchema.parse({ nickname: 'Neo_1', protocolV: 0 }).protocolV).toBe(0)
  })

  it('akzeptiert Skin im gueltigen Bereich, lehnt ausserhalb ab', () => {
    expect(joinSchema.parse({ nickname: 'Neo_1', protocolV: PROTOCOL_V, skin: 0 }).skin).toBe(0)
    expect(joinSchema.parse({ nickname: 'Neo_1', protocolV: PROTOCOL_V, skin: SKIN_COUNT - 1 }).skin).toBe(
      SKIN_COUNT - 1,
    )
    expect(joinSchema.parse({ nickname: 'Neo_1', protocolV: PROTOCOL_V }).skin).toBeUndefined()
    for (const skin of [-1, SKIN_COUNT, 1.5, Number.NaN]) {
      expect(() => joinSchema.parse({ nickname: 'Neo_1', protocolV: PROTOCOL_V, skin })).toThrow()
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

describe('Profil-Schemas (ADR-014)', () => {

  it('Profilname: strippt unbekannte Felder, lehnt Script-/Leer-/Zu-lange-Namen ab', () => {
    expect(profileNameSchema.parse({ nickname: 'Neo_1', isAdmin: true })).toEqual({ nickname: 'Neo_1' })
    expect(profileNameSchema.safeParse({ nickname: '<img onerror=1>' }).success).toBe(false)
    expect(profileNameSchema.safeParse({ nickname: '' }).success).toBe(false)
    expect(profileNameSchema.safeParse({ nickname: 'x'.repeat(17) }).success).toBe(false)
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

  it('Admin-Schemas: Defaults, Grenzen, unbekannte Aktionen abgelehnt', () => {
    expect(adminPlayerSchema.parse({ action: 'ult', target: 'x' })).toMatchObject({ mode: 'set', value: 0 })
    expect(() => adminPlayerSchema.parse({ action: 'drop-db', target: 'x' })).toThrow()
    expect(() => adminPlayerSchema.parse({ action: 'ult', target: 'x', value: 1e9 })).toThrow()
    expect(() => adminRoundSchema.parse({ op: 'nuke' })).toThrow()
    expect(adminAuthSchema.safeParse({ token: '' }).success).toBe(false)
  })
})
