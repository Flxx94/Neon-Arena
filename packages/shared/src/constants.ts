import { PROTOCOL_V } from './protocol.js'

/** Einzige Wahrheit fuer Sim-Konstanten: Client+Server importieren von hier, nie duplizieren. */
export const TICK_RATE = 30
export const SNAPSHOT_RATE = 20
export const PLAYER_SPEED = 165
export const PLAYER_RADIUS = 14
export const ARENA_WIDTH = 2800
export const ARENA_HEIGHT = 1600
export const MAX_PLAYERS_PER_ROOM = 12
export const MAX_IDLE_SECONDS = 60
export const RECONNECT_GRACE_SECONDS = 15
export const ROUND_SECONDS = 180
export const KILL_SCORE = 100
export const RESPAWN_SECONDS = 3
export const SPAWN_PROTECTION_SECONDS = 2
export const MAX_INPUT_PER_SECOND = 30
/** Server toleriert Bursts (Frame-Hitches des Clients), ohne Inputs zu verwerfen. */
export const INPUT_BURST_TOLERANCE = 45
export const INTERPOLATION_BUFFER_MS = 100
export const SERVER_REWIND_MS = 100

// --- Combat (M2) ---
export const FIRE_INTERVAL_MS = 250
export const PROJECTILE_SPEED = 400
export const PROJECTILE_RADIUS = 4
export const PROJECTILE_DAMAGE = 25
export const PROJECTILE_TTL_MS = 2200
export const PLAYER_HP = 100
/** Rewind in Ticks bei 30 Hz (100 ms). */
export const REWIND_TICKS = 3

// --- Arena-Hindernisse: Karte "Prism Plaza" (UI v3, vergroessert auf 2800x1600) ---
// Punkt- und achsensymmetrisch. Mitte (1400,800) und die Schusslinien y=800 (bis x=1830: Projektile
// fliegen ~13 px/Tick, Engine-Tests verlassen sich auf freie Ticks) und y=150 bleiben frei.
// Reihenfolge ist stabil: [0] = linke Seitenwand (Tests verlassen sich darauf).
// Dekor (Boden, Markierungen, Lichter) lebt rein im Client (`game/map.ts`), Kollision nur hier.
export interface ObstacleRect {
  x: number
  y: number
  w: number
  h: number
}

export const MAP_NAME = 'Prism Plaza'

function mirrored(o: ObstacleRect, mx: boolean, my: boolean): ObstacleRect {
  return {
    x: mx ? ARENA_WIDTH - o.x - o.w : o.x,
    y: my ? ARENA_HEIGHT - o.y - o.h : o.y,
    w: o.w,
    h: o.h,
  }
}

/** Oberes linkes Viertel; die drei anderen entstehen durch Spiegelung (Symmetrie = faire Spawns). */
const QUADRANT: ObstacleRect[] = [
  // Eck-Bunker (L-Form)
  { x: 300, y: 300, w: 260, h: 40 },
  { x: 300, y: 300, w: 40, h: 200 },
  // zweiter Bunker zur Mitte hin
  { x: 620, y: 520, w: 120, h: 36 },
  { x: 1000, y: 260, w: 240, h: 36 },
  { x: 1160, y: 540, w: 36, h: 160 },
  // Kisten (diagonale Deckung)
  { x: 760, y: 400, w: 56, h: 56 },
  { x: 1000, y: 580, w: 56, h: 56 },
  { x: 460, y: 640, w: 56, h: 56 },
  // Pfeiler am Mittelkreuz
  { x: 1240, y: 420, w: 60, h: 60 },
]

/** Auf den Mittellinien (selbst-symmetrisch). */
const CENTER: ObstacleRect[] = [
  // Seitenwaende (Flankenschutz)
  { x: 560, y: 680, w: 40, h: 240 },
  { x: 2200, y: 680, w: 40, h: 240 },
  // Mittel-Pfeiler um die offene Mitte
  { x: 900, y: 770, w: 60, h: 60 },
  { x: 1840, y: 770, w: 60, h: 60 },
  { x: 1370, y: 520, w: 60, h: 60 },
  { x: 1370, y: 1020, w: 60, h: 60 },
  // Barrikaden oben/unten
  { x: 1240, y: 120, w: 320, h: 34 },
  { x: 1240, y: 1446, w: 320, h: 34 },
]

export const OBSTACLES: ObstacleRect[] = [
  ...CENTER.slice(0, 2),
  ...QUADRANT.flatMap((o) => [
    o,
    mirrored(o, true, false),
    mirrored(o, false, true),
    mirrored(o, true, true),
  ]),
  ...CENTER.slice(2),
]

// --- Boost-Felder: kurzer Speed-Boost beim Drueberlaufen (Server + Client-Prediction identisch) ---
export const BOOST_SPEED_MULT = 1.7
/** Boost-Dauer in Ticks (2 s bei 30 Hz); auf dem Feld stehen bleibend wird er aufgefrischt. */
export const BOOST_TICKS = 60
export const BOOST_PAD_RADIUS = 46

export interface BoostPad {
  x: number
  y: number
}

const PAD_QUADRANT: BoostPad[] = [{ x: 860, y: 680 }]
const PAD_CENTER: BoostPad[] = [
  { x: 1400, y: 330 },
  { x: 1400, y: 1270 },
  { x: 260, y: 800 },
  { x: 2540, y: 800 },
]

/** 8 Felder, punkt- und achsensymmetrisch (faire Verteilung). */
export const BOOST_PADS: BoostPad[] = [
  ...PAD_CENTER,
  ...PAD_QUADRANT.flatMap((p) => [
    p,
    { x: ARENA_WIDTH - p.x, y: p.y },
    { x: p.x, y: ARENA_HEIGHT - p.y },
    { x: ARENA_WIDTH - p.x, y: ARENA_HEIGHT - p.y },
  ]),
]

// --- Runden & Pickups & Bots (M3) ---
export const ROUND_END_SECONDS = 10
export const SURVIVAL_BONUS = 10
export const PICKUP_SPAWN_INTERVAL_MS = 9000
export const PICKUP_MAX_ACTIVE = 5
export const PICKUP_HP_AMOUNT = 50
export const PICKUP_SHIELD_AMOUNT = 50
export const PICKUP_RADIUS = 12
export const SHIELD_MAX = 50
export const FILL_MIN_PLAYERS = 4
export const MAX_BOTS_PER_ROOM = 6
export const BOT_THINK_TICKS = 10
export const BOT_FIRE_RANGE = 600
export const BOT_PREFERRED_RANGE = 360

export { PROTOCOL_V }
