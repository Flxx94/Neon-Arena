import { ARENA_HEIGHT, ARENA_WIDTH, BOOST_PADS, MAP_NAME, OBSTACLES } from './constants.js'
import type { BoostPad, ObstacleRect } from './constants.js'

/**
 * Karten: nur Hindernisse + Boost-Felder unterscheiden sich (Bewegung, Tempo, Physik sind identisch).
 * `theme` steuert ausschliesslich die Optik im Client. Karte 0 = Neon ("Prism Plaza", Altbestand).
 * Alle Karten sind punkt- und achsensymmetrisch (faire Spawns), Mitte (1400,800) bleibt frei.
 */
export type MapTheme = 'neon' | 'winter' | 'desert' | 'jungle'

export interface MapDef {
  id: number
  name: string
  theme: MapTheme
  obstacles: ObstacleRect[]
  boostPads: BoostPad[]
}

function mirrored(o: ObstacleRect, mx: boolean, my: boolean): ObstacleRect {
  return {
    x: mx ? ARENA_WIDTH - o.x - o.w : o.x,
    y: my ? ARENA_HEIGHT - o.y - o.h : o.y,
    w: o.w,
    h: o.h,
  }
}

/** Oberes linkes Viertel -> alle vier Viertel (Achsen-Duplikate werden entfernt). */
function symmetric(quadrant: ObstacleRect[]): ObstacleRect[] {
  const out: ObstacleRect[] = []
  const seen = new Set<string>()
  for (const o of quadrant) {
    for (const [mx, my] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const) {
      const m = mirrored(o, mx, my)
      const key = `${m.x},${m.y},${m.w},${m.h}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(m)
    }
  }
  return out
}

function symmetricPads(quadrant: BoostPad[]): BoostPad[] {
  const out: BoostPad[] = []
  const seen = new Set<string>()
  for (const p of quadrant) {
    for (const [mx, my] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const) {
      const m = { x: mx ? ARENA_WIDTH - p.x : p.x, y: my ? ARENA_HEIGHT - p.y : p.y }
      const key = `${m.x},${m.y}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(m)
    }
  }
  return out
}

/** Winter "Frostfeld": Iglus, Eiswaende und Schneewehen, viel freie Flaeche. */
const WINTER: MapDef = {
  id: 1,
  name: 'Frostfeld',
  theme: 'winter',
  obstacles: symmetric([
    { x: 300, y: 280, w: 170, h: 100 }, // Iglu
    { x: 560, y: 180, w: 40, h: 240 }, // Eiswand
    { x: 760, y: 520, w: 110, h: 110 }, // Schneewehe
    { x: 300, y: 640, w: 60, h: 200 },
    { x: 980, y: 300, w: 220, h: 40 },
    { x: 1100, y: 580, w: 60, h: 60 },
    { x: 560, y: 760, w: 130, h: 40 },
    { x: 1320, y: 360, w: 160, h: 50 }, // Mitte oben/unten
    { x: 880, y: 800, w: 50, h: 50 }, // Pfeiler auf der Mittellinie
  ]),
  boostPads: symmetricPads([
    { x: 1400, y: 250 },
    { x: 220, y: 800 },
    { x: 860, y: 420 },
    { x: 700, y: 1000 },
  ]),
}

/** Wueste "Sandsturm": Pyramiden, Saeulenreihen, niedrige Mauern. */
const DESERT: MapDef = {
  id: 2,
  name: 'Sandsturm',
  theme: 'desert',
  obstacles: symmetric([
    { x: 340, y: 300, w: 190, h: 190 }, // Pyramide
    { x: 760, y: 220, w: 44, h: 44 }, // Saeulenreihe
    { x: 760, y: 340, w: 44, h: 44 },
    { x: 760, y: 460, w: 44, h: 44 },
    { x: 1000, y: 580, w: 240, h: 40 },
    { x: 1040, y: 240, w: 40, h: 200 },
    { x: 520, y: 640, w: 40, h: 180 },
    { x: 1360, y: 470, w: 80, h: 80 }, // Obelisk
    { x: 1340, y: 130, w: 120, h: 40 },
    { x: 240, y: 880, w: 120, h: 40 },
  ]),
  boostPads: symmetricPads([
    { x: 1400, y: 300 },
    { x: 1000, y: 800 },
    { x: 400, y: 800 },
    { x: 900, y: 420 },
  ]),
}

/** Dschungel "Tempelruine": Baumstaemme, Rankenwaende und ein offener Tempelring. */
const JUNGLE: MapDef = {
  id: 3,
  name: 'Tempelruine',
  theme: 'jungle',
  obstacles: symmetric([
    { x: 300, y: 360, w: 64, h: 64 }, // Baeume
    { x: 480, y: 240, w: 64, h: 64 },
    { x: 620, y: 440, w: 64, h: 64 },
    { x: 340, y: 620, w: 64, h: 64 },
    { x: 840, y: 640, w: 64, h: 64 },
    { x: 900, y: 280, w: 64, h: 64 },
    { x: 560, y: 840, w: 190, h: 34 }, // Rankenwand
    { x: 1080, y: 400, w: 34, h: 240 },
    { x: 1180, y: 640, w: 110, h: 34 }, // Tempelmauer
    { x: 1330, y: 140, w: 140, h: 34 },
    { x: 1250, y: 560, w: 34, h: 100 },
  ]),
  boostPads: symmetricPads([
    { x: 1400, y: 320 },
    { x: 260, y: 800 },
    { x: 740, y: 560 },
    { x: 1000, y: 960 },
  ]),
}

const NEON: MapDef = {
  id: 0,
  name: MAP_NAME,
  theme: 'neon',
  obstacles: OBSTACLES,
  boostPads: BOOST_PADS,
}

export const MAPS: MapDef[] = [NEON, WINTER, DESERT, JUNGLE]
export const MAP_COUNT = MAPS.length

export function mapOf(id: number): MapDef {
  return MAPS[id] ?? NEON
}

/** Naechste Karte der Rotation (nie dieselbe zweimal hintereinander, solange es mehr als eine gibt). */
export function nextMapId(current: number, rand: number = Math.random()): number {
  if (MAP_COUNT <= 1) return 0
  const others = MAPS.filter((m) => m.id !== current)
  return others[Math.min(others.length - 1, Math.floor(rand * others.length))]!.id
}
