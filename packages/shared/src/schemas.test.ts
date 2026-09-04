import { describe, expect, it } from 'vitest'
import { inputSchema, joinSchema } from './schemas.js'
import { PROTOCOL_V } from './protocol.js'

describe('shared schemas (M1-01 Vorgriff)', () => {
  it('akzeptiert gueltigen Join', () => {
    expect(joinSchema.parse({ nickname: 'Neo_1', protocolV: PROTOCOL_V })).toBeDefined()
  })

  it('lehnt Script-Nickname ab', () => {
    expect(() =>
      joinSchema.parse({ nickname: '<script>alert(1)</script>', protocolV: 1 }),
    ).toThrow()
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
