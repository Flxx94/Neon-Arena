import { describe, expect, it } from 'vitest'
import {
  BOOST_PADS,
  BOOST_PAD_RADIUS,
  BOOST_SPEED_MULT,
  BOOST_TICKS,
  PLAYER_SPEED,
  TICK_RATE,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  OBSTACLES,
  PLAYER_RADIUS,
  type ObstacleRect,
} from './constants.js'
import { onBoostPad, stepPlayer } from './physics.js'
import { COLOR_COUNT, MODEL_COUNT, SKIN_COUNT, makeSkin, skinColor, skinModel } from './skins.js'

function blocked(x: number, y: number, margin: number): boolean {
  return OBSTACLES.some(
    (o) => x > o.x - margin && x < o.x + o.w + margin && y > o.y - margin && y < o.y + o.h + margin,
  )
}

function mirror(o: ObstacleRect, mx: boolean, my: boolean): ObstacleRect {
  return {
    x: mx ? ARENA_WIDTH - o.x - o.w : o.x,
    y: my ? ARENA_HEIGHT - o.y - o.h : o.y,
    w: o.w,
    h: o.h,
  }
}

describe('Map "Prism Plaza"', () => {
  it('alle Hindernisse liegen vollstaendig in der Arena', () => {
    for (const o of OBSTACLES) {
      expect(o.x).toBeGreaterThanOrEqual(0)
      expect(o.y).toBeGreaterThanOrEqual(0)
      expect(o.x + o.w).toBeLessThanOrEqual(ARENA_WIDTH)
      expect(o.y + o.h).toBeLessThanOrEqual(ARENA_HEIGHT)
    }
  })

  it('ist achsensymmetrisch (links/rechts und oben/unten)', () => {
    const key = (o: ObstacleRect) => `${o.x},${o.y},${o.w},${o.h}`
    const keys = new Set(OBSTACLES.map(key))
    for (const o of OBSTACLES) {
      expect(keys.has(key(mirror(o, true, false)))).toBe(true)
      expect(keys.has(key(mirror(o, false, true)))).toBe(true)
    }
  })

  it('Hindernisse sind mindestens 30 breit (Projektile tunneln nicht, 13 px/Tick)', () => {
    for (const o of OBSTACLES) expect(Math.min(o.w, o.h)).toBeGreaterThanOrEqual(30)
  })

  it('Mitte und die Test-Schusslinien bleiben frei', () => {
    expect(blocked(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, PLAYER_RADIUS)).toBe(false)
    // Ein Schuss aus der Mitte nach Osten fliegt >= 30 Ticks (13 px/Tick) frei: Engine-Tests.
    for (let x = 1300; x <= 1830; x += 2) expect(blocked(x, 800, 4)).toBe(false)
    for (let x = 200; x <= 500; x += 2) expect(blocked(x, 150, 4)).toBe(false)
  })

  it('links von OBSTACLES[0] ist Platz (Kollisionstest im Server)', () => {
    const o = OBSTACLES[0]!
    expect(blocked(o.x - PLAYER_RADIUS - 5, o.y + o.h / 2, PLAYER_RADIUS)).toBe(false)
  })

  it('freie Flaeche ist zusammenhaengend (keine abgeschlossenen Kammern)', () => {
    const cell = 10
    const gx = ARENA_WIDTH / cell
    const gy = ARENA_HEIGHT / cell
    const free = (cx: number, cy: number) => {
      const x = cx * cell + cell / 2
      const y = cy * cell + cell / 2
      return (
        x > PLAYER_RADIUS &&
        x < ARENA_WIDTH - PLAYER_RADIUS &&
        y > PLAYER_RADIUS &&
        y < ARENA_HEIGHT - PLAYER_RADIUS &&
        !blocked(x, y, PLAYER_RADIUS)
      )
    }
    let total = 0
    for (let cy = 0; cy < gy; cy++) for (let cx = 0; cx < gx; cx++) if (free(cx, cy)) total++
    const seen = new Uint8Array(gx * gy)
    const stack: [number, number][] = [[gx / 2, gy / 2]]
    let reached = 0
    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!
      if (cx < 0 || cy < 0 || cx >= gx || cy >= gy) continue
      const i = cy * gx + cx
      if (seen[i] || !free(cx, cy)) continue
      seen[i] = 1
      reached++
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
    }
    expect(reached).toBe(total)
  })
})

describe('Skins', () => {
  it('Modell/Farbe round-trippen ueber alle Kombinationen', () => {
    const seen = new Set<number>()
    for (let m = 0; m < MODEL_COUNT; m++) {
      for (let c = 0; c < COLOR_COUNT; c++) {
        const skin = makeSkin(m, c)
        expect(skin).toBeGreaterThanOrEqual(0)
        expect(skin).toBeLessThan(SKIN_COUNT)
        expect(skinModel(skin)).toBe(m)
        expect(skinColor(skin)).toBe(c)
        seen.add(skin)
      }
    }
    expect(seen.size).toBe(SKIN_COUNT)
  })

  it('negative/zu grosse Eingaben werden umgebrochen statt zu crashen', () => {
    expect(skinModel(makeSkin(-1, -1))).toBe(MODEL_COUNT - 1)
    expect(skinColor(makeSkin(-1, -1))).toBe(COLOR_COUNT - 1)
    expect(skinModel(SKIN_COUNT + 2)).toBe(2)
  })
})

describe('Boost-Felder', () => {
  it('liegen frei (kein Hindernis, innerhalb der Arena) und sind symmetrisch', () => {
    for (const p of BOOST_PADS) {
      expect(blocked(p.x, p.y, BOOST_PAD_RADIUS + PLAYER_RADIUS)).toBe(false)
      expect(p.x).toBeGreaterThan(BOOST_PAD_RADIUS)
      expect(p.x).toBeLessThan(ARENA_WIDTH - BOOST_PAD_RADIUS)
      expect(p.y).toBeGreaterThan(BOOST_PAD_RADIUS)
      expect(p.y).toBeLessThan(ARENA_HEIGHT - BOOST_PAD_RADIUS)
      const has = (x: number, y: number) =>
        BOOST_PADS.some((q) => Math.abs(q.x - x) < 1e-6 && Math.abs(q.y - y) < 1e-6)
      expect(has(ARENA_WIDTH - p.x, p.y)).toBe(true)
      expect(has(p.x, ARENA_HEIGHT - p.y)).toBe(true)
    }
  })

  it('stepPlayer: Boost startet auf dem Feld, beschleunigt, laeuft nach BOOST_TICKS aus', () => {
    const pad = BOOST_PADS[0]!
    const p = { x: pad.x - 10, y: pad.y }
    expect(onBoostPad(p)).toBe(true)
    let boost = stepPlayer(p, 0, 0, 0)
    expect(boost).toBe(BOOST_TICKS)
    // Vom Feld weglaufen (nach oben, frei): erste Schritte mit Boost
    const base = PLAYER_SPEED / TICK_RATE
    const y0 = p.y
    boost = stepPlayer(p, boost, 0, -1)
    expect(y0 - p.y).toBeCloseTo(base * BOOST_SPEED_MULT, 5)
    for (let i = 0; i < 12; i++) boost = stepPlayer(p, boost, 0, -1) // Feld verlassen
    expect(onBoostPad(p)).toBe(false)
    let steps = 0
    while (boost > 0 && steps < 500) {
      boost = stepPlayer(p, boost, 0, 0)
      steps++
    }
    expect(boost).toBe(0)
    const y1 = p.y
    stepPlayer(p, 0, 0, 1)
    expect(p.y - y1).toBeCloseTo(base, 5)
  })
})
