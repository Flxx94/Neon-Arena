import { describe, expect, it } from 'vitest'
import { inputSchema, joinSchema } from './schemas.js'
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
