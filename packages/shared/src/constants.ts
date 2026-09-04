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

export { PROTOCOL_V }
