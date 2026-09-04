import { describe, expect, it } from 'vitest'
import { Interpolator } from './Interpolation.js'

function player(id: string, x: number, y: number) {
  return {
    id,
    nickname: id,
    x,
    y,
    hp: 100,
    alive: true,
    ackSeq: 0,
    score: 0,
    kills: 0,
    deaths: 0,
    shield: 0,
    isBot: false,
  }
}

describe('Interpolator (M3-05)', () => {
  it('lerpt zwischen Snapshots am 100-ms-Puffer', () => {
    const interp = new Interpolator()
    interp.push(1000, [player('a', 0, 0)])
    interp.push(1050, [player('a', 100, 0)])
    // now=1150 -> target 1050 -> exakt zweiter Snapshot.
    expect(interp.sample('a', 1150)).toEqual({ x: 100, y: 0 })
    // now=1125 -> target 1025 -> Haelfte.
    expect(interp.sample('a', 1125)).toEqual({ x: 50, y: 0 })
  })

  it('unbekannte Spieler -> null, Fallback neuester', () => {
    const interp = new Interpolator()
    expect(interp.sample('x', 2000)).toBeNull()
    interp.push(1000, [player('a', 5, 5)])
    expect(interp.sample('zzz', 2000)).toBeNull()
    expect(interp.sample('a', 5000)).toEqual({ x: 5, y: 5 })
  })
})
