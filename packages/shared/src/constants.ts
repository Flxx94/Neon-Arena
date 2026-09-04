import { PROTOCOL_V } from './protocol.js'

/** Einzige Wahrheit fuer Sim-Konstanten: Client+Server importieren von hier, nie duplizieren. */
export const TICK_RATE = 30
export const SNAPSHOT_RATE = 20
export const PLAYER_SPEED = 220
export const PLAYER_RADIUS = 14
export const ARENA_WIDTH = 1600
export const ARENA_HEIGHT = 900
export const MAX_PLAYERS_PER_ROOM = 12
export const MAX_IDLE_SECONDS = 60
export const RECONNECT_GRACE_SECONDS = 15
export const ROUND_SECONDS = 180
export const KILL_SCORE = 100
export const RESPAWN_SECONDS = 3
export const SPAWN_PROTECTION_SECONDS = 2
export const MAX_INPUT_PER_SECOND = 30
export const INTERPOLATION_BUFFER_MS = 100
export const SERVER_REWIND_MS = 100

// --- Combat (M2) ---
export const FIRE_INTERVAL_MS = 250
export const PROJECTILE_SPEED = 600
export const PROJECTILE_RADIUS = 4
export const PROJECTILE_DAMAGE = 25
export const PROJECTILE_TTL_MS = 1500
export const PLAYER_HP = 100
/** Rewind in Ticks bei 30 Hz (100 ms). */
export const REWIND_TICKS = 3

// --- Arena-Hindernisse (M2): zwei symmetrische Bloecke, Mitte offen ---
export interface ObstacleRect {
  x: number
  y: number
  w: number
  h: number
}

export const OBSTACLES: ObstacleRect[] = [
  { x: 400, y: 300, w: 120, h: 300 },
  { x: 1080, y: 300, w: 120, h: 300 },
]

// --- Runden & Pickups & Bots (M3) ---
export const ROUND_END_SECONDS = 10
export const SURVIVAL_BONUS = 10
export const PICKUP_SPAWN_INTERVAL_MS = 12000
export const PICKUP_MAX_ACTIVE = 3
export const PICKUP_HP_AMOUNT = 50
export const PICKUP_SHIELD_AMOUNT = 50
export const PICKUP_RADIUS = 12
export const SHIELD_MAX = 50
export const FILL_MIN_PLAYERS = 4
export const MAX_BOTS_PER_ROOM = 6
export const BOT_THINK_TICKS = 10
export const BOT_FIRE_RANGE = 550
export const BOT_PREFERRED_RANGE = 320

export { PROTOCOL_V }
