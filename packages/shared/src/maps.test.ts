import { describe, expect, it } from 'vitest'
import { ARENA_HEIGHT, ARENA_WIDTH, BOOST_PAD_RADIUS, PLAYER_RADIUS } from './constants.js'
import { MAPS, mapOf, nextMapId } from './maps.js'
import { stepPlayer } from './physics.js'

const CELL = 20

function inflatedBlocked(m: (typeof MAPS)[number], x: number, y: number): boolean {
  const r = PLAYER_RADIUS
  return m.obstacles.some((o) => x > o.x - r && x < o.x + o.w + r && y > o.y - r && y < o.y + o.h + r)
}

describe('maps', () => {
  it('hat stabile Ids und vier Karten', () => {
    expect(MAPS.map((m) => m.id)).toEqual([0, 1, 2, 3])
    expect(mapOf(99).id).toBe(0)
  })

  for (const m of MAPS) {
    describe(m.name, () => {
      it('liegt komplett in der Arena, ohne Duplikate', () => {
        for (const o of m.obstacles) {
          expect(o.x).toBeGreaterThanOrEqual(0)
          expect(o.y).toBeGreaterThanOrEqual(0)
          expect(o.x + o.w).toBeLessThanOrEqual(ARENA_WIDTH)
          expect(o.y + o.h).toBeLessThanOrEqual(ARENA_HEIGHT)
        }
        const keys = m.obstacles.map((o) => `${o.x},${o.y},${o.w},${o.h}`)
        expect(new Set(keys).size).toBe(keys.length)
      })

      it('ist punktsymmetrisch (faire Spawns)', () => {
        const keys = new Set(m.obstacles.map((o) => `${o.x},${o.y},${o.w},${o.h}`))
        for (const o of m.obstacles) {
          const k = `${ARENA_WIDTH - o.x - o.w},${ARENA_HEIGHT - o.y - o.h},${o.w},${o.h}`
          expect(keys.has(k)).toBe(true)
        }
      })

      it('haelt Mitte und Boost-Felder frei', () => {
        expect(inflatedBlocked(m, ARENA_WIDTH / 2, ARENA_HEIGHT / 2)).toBe(false)
        for (const pad of m.boostPads) {
          expect(inflatedBlocked(m, pad.x, pad.y)).toBe(false)
          expect(pad.x).toBeGreaterThan(BOOST_PAD_RADIUS)
          expect(pad.y).toBeGreaterThan(BOOST_PAD_RADIUS)
        }
      })

      it('hat keine eingeschlossenen Bereiche (alles von der Mitte erreichbar)', () => {
        const cols = Math.floor(ARENA_WIDTH / CELL)
        const rows = Math.floor(ARENA_HEIGHT / CELL)
        const free = (cx: number, cy: number): boolean =>
          cx >= 1 && cy >= 1 && cx < cols - 1 && cy < rows - 1 && !inflatedBlocked(m, cx * CELL + CELL / 2, cy * CELL + CELL / 2)
        const seen = new Uint8Array(cols * rows)
        const stack = [Math.floor(cols / 2) + Math.floor(rows / 2) * cols]
        seen[stack[0]!] = 1
        let reached = 0
        while (stack.length) {
          const i = stack.pop()!
          reached++
          const cx = i % cols
          const cy = Math.floor(i / cols)
          for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as const) {
            if (!free(nx, ny)) continue
            const j = nx + ny * cols
            if (seen[j]) continue
            seen[j] = 1
            stack.push(j)
          }
        }
        let total = 0
        for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) if (free(cx, cy)) total++
        expect(reached).toBe(total)
      })

      it('bewegt sich auf jeder Karte identisch schnell (nur Hindernisse unterscheiden sich)', () => {
        const p = { x: 1400, y: 800 }
        let boost = 0
        for (let i = 0; i < 10; i++) boost = stepPlayer(p, boost, 0, 1, undefined, m.obstacles, m.boostPads)
        expect(p.y - 800).toBeCloseTo((165 / 30) * 10, 5)
      })
    })
  }

  it('nextMapId wechselt immer die Karte', () => {
    for (let c = 0; c < MAPS.length; c++) {
      for (const r of [0, 0.34, 0.67, 0.999]) expect(nextMapId(c, r)).not.toBe(c)
    }
  })
})
