import { Client, Room } from '@colyseus/core'
import { MAX_PLAYERS_PER_ROOM, PLAYER_HP, PROTOCOL_V, TICK_RATE, inputSchema, joinSchema } from '@neon-arena/shared'
import { applyInput, createContext, findSpawn, initPlayer, removePlayer, update, type SimContext } from '../sim/engine.js'
import { recordTick } from '../sim/metrics.js'
import { ArenaState, Player } from '../sim/state.js'

/** M2: autoritative 30-Hz-Simulation (Bewegung, Kollision, Projektile, HP/Respawn). */
export class ArenaRoom extends Room<ArenaState> {
  maxClients = MAX_PLAYERS_PER_ROOM
  private ctx: SimContext = createContext()

  onCreate() {
    this.ctx = createContext()
    this.setState(new ArenaState())
    // 20 Hz Delta-Snapshots (PLAN §4), Simulation 30 Hz fixed.
    this.setPatchRate(1000 / 20)
    this.setSimulationInterval(() => {
      const t0 = performance.now()
      update(this.ctx, this.state)
      recordTick(performance.now() - t0)
    }, 1000 / TICK_RATE)

    this.onMessage('input', (client, raw) => {
      const parsed = inputSchema.safeParse(raw)
      if (!parsed.success) return
      applyInput(this.ctx, this.state, client.sessionId, parsed.data)
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
    player.hp = PLAYER_HP
    const spawn = findSpawn([...this.state.players.values()])
    player.x = spawn.x
    player.y = spawn.y
    this.state.players.set(client.sessionId, player)
    initPlayer(this.ctx, client.sessionId, spawn)
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId)
    removePlayer(this.ctx, client.sessionId)
  }
}
