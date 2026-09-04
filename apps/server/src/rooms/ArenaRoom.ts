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
import { checkGuestSession } from '../auth/guest.js'
import { getDb } from '../db/prisma.js'
import { persistMatch, type ResultsDb } from '../db/results.js'
import { checkLimit, getRateStore } from '../ratelimit/limiter.js'
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

/** M4: Gast-Identitaet, Rate-Limits, Runden-Persistenz + M3-Lifecycle/Simulation. */
export class ArenaRoom extends Room<ArenaState> {
  maxClients = MAX_PLAYERS_PER_ROOM
  private ctx: SimContext = createContext(true)
  private emptySince = 0
  private startedAt = new Date()
  /** sessionId -> userId (nur echte Spieler; Bots haben keins). */
  private userIds = new Map<string, string>()

  onCreate() {
    // Bots per Env schaltbar (PLAN M3-06): Tests setzen BOTS_ENABLED=false.
    this.ctx = createContext(process.env.BOTS_ENABLED !== 'false')
    // Kurze Runden fuer Tests (M4): ROUND_SECONDS_OVERRIDE in Sekunden.
    const override = Number(process.env.ROUND_SECONDS_OVERRIDE ?? NaN)
    if (Number.isFinite(override) && override > 0) {
      this.ctx.roundTicksLeft = Math.ceil(override * TICK_RATE)
      this.ctx.roundTotal = Math.ceil(override * TICK_RATE)
    }
    this.startedAt = new Date()
    this.setState(new ArenaState())
    // 20 Hz Delta-Snapshots (PLAN §4), Simulation 30 Hz fixed.
    this.setPatchRate(1000 / 20)
    this.setSimulationInterval(() => {
      const t0 = performance.now()
      update(this.ctx, this.state)
      // Sim-Events sofort broadcasten (Killfeed <500 ms, M3-04).
      for (const e of drainEvents(this.ctx)) {
        if (e.type === 'kill') this.broadcast('killfeed', { by: e.by, victim: e.victim })
        else if (e.type === 'roundEnd') {
          this.broadcast('round', { phase: 'end', winner: e.winner })
          this.persistResult(e.winner)
        } else this.broadcast('round', { phase: 'play', winner: '' })
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
      void this.handleInput(client, raw)
    })
  }

  private async handleInput(client: Client, raw: unknown): Promise<void> {
    // M4-05: Input-Limit 30/s (Toleranz 35), Flood -> Disconnect.
    const hits = await getRateStore().hit(`input:${client.sessionId}`, 1000)
    if (hits > 120) {
      client.leave(4400)
      return
    }
    if (hits > 35) return
    const parsed = inputSchema.safeParse(raw)
    if (!parsed.success) return
    applyInput(this.ctx, this.state, client.sessionId, parsed.data)
  }

  async onJoin(client: Client, options: unknown) {
    const parsed = joinSchema.safeParse(options)
    if (!parsed.success) {
      throw new Error('INVALID_JOIN')
    }
    if (parsed.data.protocolV !== PROTOCOL_V) {
      // Voller Version-Gate (Kick + Hinweis) folgt in M5-01.
      throw new Error('PROTOCOL_MISMATCH')
    }
    // M4-05: Join-Limit 5/min/IP.
    if (!(await checkLimit(getRateStore(), `join:${clientIp(client)}`, 5, 60_000))) {
      throw new Error('RATE_LIMITED')
    }
    // M4-02: Gast-Session prüfen (fremde Tokens abweisen).
    if (!(await checkGuestSession(parsed.data.userId))) {
      throw new Error('INVALID_GUEST')
    }
    const player = new Player()
    player.nickname = parsed.data.nickname
    player.hp = PLAYER_HP
    const spawn = findSpawn([...this.state.players.values()])
    player.x = spawn.x
    player.y = spawn.y
    this.state.players.set(client.sessionId, player)
    initPlayer(this.ctx, client.sessionId, spawn)
    this.userIds.set(client.sessionId, parsed.data.userId as string)
  }

  async onLeave(client: Client, consented: boolean) {
    this.userIds.delete(client.sessionId)
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

  /** Rundenende async persistieren (M4-03): fire-and-forget, nie im Sim-Tick warten. */
  private persistResult(winnerNickname: string): void {
    const db = getDb() as ResultsDb | null
    if (!db) return
    let winnerId: string | null = null
    let best = -1
    const rows: { userId: string; nickname: string; kills: number; deaths: number; score: number }[] = []
    for (const [sessionId, player] of this.state.players) {
      const userId = this.userIds.get(sessionId)
      if (!userId || player.isBot) continue
      rows.push({ userId, nickname: player.nickname, kills: player.kills, deaths: player.deaths, score: player.score })
      if (player.score > best) {
        best = player.score
        winnerId = userId
      }
    }
    if (rows.length === 0) return
    void persistMatch(db, {
      roomId: this.roomId,
      startedAt: this.startedAt,
      endedAt: new Date(),
      winnerId: winnerNickname ? winnerId : null,
      players: rows,
    }).catch((err: unknown) => console.error('[db] persistMatch failed:', err))
  }
}

/** Client-IP mit Fallbacks (WS-Socket -> Session). */
export function clientIp(client: Client): string {
  const req = (client as unknown as { request?: { socket?: { remoteAddress?: string } } }).request
  const sock = (client as unknown as { _socket?: { remoteAddress?: string } })._socket
  return req?.socket?.remoteAddress ?? sock?.remoteAddress ?? client.sessionId
}
