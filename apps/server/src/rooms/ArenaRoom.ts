import { Client, Room } from '@colyseus/core'
import { MapSchema, Schema, type } from '@colyseus/schema'
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  MAX_PLAYERS_PER_ROOM,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PROTOCOL_V,
  TICK_RATE,
  inputSchema,
  joinSchema,
} from '@neon-arena/shared'

export class Player extends Schema {
  @type('string') nickname = ''
  @type('number') x = 0
  @type('number') y = 0
  @type('number') hp = 100
}

export class ArenaState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>()
}

/** M1: Join/Leave + Echo-Bewegung. Autoritative Sim (Kollision/Kampf) kommt in M2. */
export class ArenaRoom extends Room<ArenaState> {
  maxClients = MAX_PLAYERS_PER_ROOM

  onCreate() {
    this.setState(new ArenaState())
    // 20 Hz Delta-Snapshots (PLAN §4).
    this.setPatchRate(1000 / 20)

    this.onMessage('input', (client, raw) => {
      const parsed = inputSchema.safeParse(raw)
      if (!parsed.success) return
      const player = this.state.players.get(client.sessionId)
      if (!player) return
      const { dx, dy } = parsed.data
      const step = PLAYER_SPEED / TICK_RATE
      player.x = clamp(player.x + dx * step, PLAYER_RADIUS, ARENA_WIDTH - PLAYER_RADIUS)
      player.y = clamp(player.y + dy * step, PLAYER_RADIUS, ARENA_HEIGHT - PLAYER_RADIUS)
    })
  }

  onJoin(client: Client, options: unknown) {
    const parsed = joinSchema.safeParse(options)
    if (!parsed.success) {
      throw new Error('INVALID_JOIN')
    }
    if (parsed.data.protocolV !== PROTOCOL_V) {
      // Voller Version-Gate (Kick + Hinweis) folgt in M5-01.
      throw new Error('PROTOCOL_MISMATCH')
    }
    const player = new Player()
    player.nickname = parsed.data.nickname
    const spawn = findSpawn([...this.state.players.values()])
    player.x = spawn.x
    player.y = spawn.y
    this.state.players.set(client.sessionId, player)
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId)
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

function findSpawn(others: Player[]): { x: number; y: number } {
  for (let i = 0; i < 10; i++) {
    const x = PLAYER_RADIUS + Math.random() * (ARENA_WIDTH - 2 * PLAYER_RADIUS)
    const y = PLAYER_RADIUS + Math.random() * (ARENA_HEIGHT - 2 * PLAYER_RADIUS)
    const overlap = others.some((p) => Math.hypot(p.x - x, p.y - y) < 2 * PLAYER_RADIUS)
    if (!overlap) return { x, y }
  }
  return {
    x: PLAYER_RADIUS + Math.random() * (ARENA_WIDTH - 2 * PLAYER_RADIUS),
    y: PLAYER_RADIUS + Math.random() * (ARENA_HEIGHT - 2 * PLAYER_RADIUS),
  }
}
