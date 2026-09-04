import { Client, Room } from '@colyseus/core'
import {
  MAX_IDLE_SECONDS,
  MAX_PLAYERS_PER_ROOM,
  PLAYER_HP,
  PROTOCOL_V,
  RECONNECT_GRACE_SECONDS,
  TICK_RATE,
  inputSchema,
  joinSchema,
} from '@neon-arena/shared'
import {
  applyInput,
  createContext,
  drainEvents,
  findSpawn,
  initPlayer,
  removePlayer,
  update,
  type SimContext,
} from '../sim/engine.js'
import { recordTick } from '../sim/metrics.js'
import { ArenaState, Player } from '../sim/state.js'

/** M3: Room-Lifecycle (maxIdle, Reconnect-Grace) + 30-Hz-Simulation + Event-Broadcast. */
export class ArenaRoom extends Room<ArenaState> {
  maxClients = MAX_PLAYERS_PER_ROOM
  private ctx: SimContext = createContext(true)
  private emptySince = 0

  onCreate() {
    // Bots per Env schaltbar (PLAN M3-06): Tests setzen BOTS_ENABLED=false.
    this.ctx = createContext(process.env.BOTS_ENABLED !== 'false')
    this.setState(new ArenaState())
    // 20 Hz Delta-Snapshots (PLAN §4), Simulation 30 Hz fixed.
    this.setPatchRate(1000 / 20)
    this.setSimulationInterval(() => {
      const t0 = performance.now()
      update(this.ctx, this.state)
      // Sim-Events sofort broadcasten (Killfeed <500 ms, M3-04).
      for (const e of drainEvents(this.ctx)) {
        if (e.type === 'kill') this.broadcast('killfeed', { by: e.by, victim: e.victim })
        else if (e.type === 'roundEnd') this.broadcast('round', { phase: 'end', winner: e.winner })
        else this.broadcast('round', { phase: 'play', winner: '' })
      }
      recordTick(performance.now() - t0)
    }, 1000 / TICK_RATE)

    // maxIdle (M3-01): leeren Raum nach 60 s schließen.
    this.clock.setInterval(() => {
      if (this.state.players.size === 0) {
        if (this.emptySince === 0) this.emptySince = Date.now()
        else if (Date.now() - this.emptySince > MAX_IDLE_SECONDS * 1000) void this.disconnect()
      } else {
        this.emptySince = 0
      }
    }, 1000)

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

  async onLeave(client: Client, consented: boolean) {
    // Explizites leave() -> sofort entfernen; Abriss -> 15 s Grace (M3-01).
    if (consented) {
      removePlayer(this.ctx, this.state, client.sessionId)
      return
    }
    try {
      await this.allowReconnection(client, RECONNECT_GRACE_SECONDS)
      // Reconnected: Spieler + Score bleiben erhalten.
    } catch {
      removePlayer(this.ctx, this.state, client.sessionId)
    }
  }
}
