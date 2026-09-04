import { describe, expect, it } from 'vitest'
import { ARENA_HEIGHT, ARENA_WIDTH } from './constants.js'
import { resolveArena, resolveCircle, resolveRect, segmentHitsCircle } from './physics.js'

describe('physics (M2)', () => {
  it('Arena-Clamp haelt Kreis drinnen', () => {
    const p = { x: -50, y: ARENA_HEIGHT + 99 }
    resolveArena(p, 14)
    expect(p.x).toBe(14)
    expect(p.y).toBe(ARENA_HEIGHT - 14)
  })

  it('Rechteck schiebt Kreis nach draussen', () => {
    const p = { x: 450, y: 450 }
    resolveRect(p, 14, { x: 400, y: 300, w: 120, h: 300 })
    // Zentrum war im Rechteck -> muss ausserhalb + Radius landen.
    const insideX = p.x > 400 - 14 && p.x < 520 + 14
    const insideY = p.y > 300 - 14 && p.y < 600 + 14
    expect(insideX && insideY).toBe(false)
  })

  it('Kreis-Kreis entflieht symmetrisch', () => {
    const a = { x: 100, y: 100 }
    const b = { x: 110, y: 100 }
    expect(resolveCircle(a, 14, b, 14)).toBe(true)
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(28, 5)
    expect(a.x + b.x).toBeCloseTo(210, 5)
  })

  it('kein Kontakt -> keine Aenderung', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 500, y: 500 }
    expect(resolveCircle(a, 14, b, 14)).toBe(false)
    expect(a).toEqual({ x: 0, y: 0 })
  })

  it('Segment trifft Kreis (Tunneling-Schutz)', () => {
    // Projektil fliegt in einem Tick am Ziel vorbei-weit: trotzdem Treffer.
    expect(segmentHitsCircle(0, 0, 100, 0, 50, 5, 14)).toBe(true)
    expect(segmentHitsCircle(0, 0, 100, 0, 50, 50, 14)).toBe(false)
  })

  it('ARENA_WIDTH bleibt Export-vertraeglich', () => {
    expect(ARENA_WIDTH).toBe(1600)
  })
})
