import { createHash, timingSafeEqual } from 'node:crypto'
import { Client, Room } from '@colyseus/core'
import {
  INPUT_BURST_TOLERANCE,
  MAX_IDLE_SECONDS,
  MAX_PLAYERS_PER_ROOM,
  classOf,
  PROTOCOL_V,
  RECONNECT_GRACE_SECONDS,
  TICK_RATE,
  inputSchema,
  joinSchema,
  skinChangeSchema,
  adminAuthSchema,
  adminPlayerSchema,
  adminRoundSchema,
  adminBanSchema,
  adminUnbanSchema,
  MAP_COUNT,
} from '@neon-arena/shared'
import { getBanStore, normalizeIp } from '../db/bans.js'
import { getSessionStore } from '../auth/sessions.js'
import { getDb } from '../db/prisma.js'
import { persistMatch, type ResultsDb } from '../db/results.js'
import { checkLimit, getRateStore } from '../ratelimit/limiter.js'
import {
  adminPlayer,
  adminRound,
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
  /** Sessions, die sich mit dem ADMIN_TOKEN angemeldet haben (nur diese Raum-Instanz). */
  private admins = new Set<string>()
  /** IP je Session (nur fuer Admin-Panel + Bann-Pruefung; nie im State/Broadcast). */
  private ips = new Map<string, string>()
  /** Alle laufenden Raeume: ein IP-Bann wirkt sofort auf Verbindungen in allen Raeumen. */
  private static rooms = new Set<ArenaRoom>()

  onCreate() {
    ArenaRoom.rooms.add(this)
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
    // Startkarte zufaellig; danach rotiert die Engine pro Runde.
    this.state.map = Math.floor(Math.random() * MAP_COUNT)
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
    this.onMessage('adminAuth', (client, raw) => {
      void this.handleAdminAuth(client, raw)
    })
    this.onMessage('adminInfo', (client) => void this.sendAdminInfo(client))
    this.onMessage('adminBan', (client, raw) => void this.handleAdminBan(client, raw))
    this.onMessage('adminUnban', (client, raw) => void this.handleAdminUnban(client, raw))
    this.onMessage('adminPlayer', (client, raw) => this.handleAdminPlayer(client, raw))
    this.onMessage('adminRound', (client, raw) => this.handleAdminRound(client, raw))
    // Charakterwechsel: nur waehrend man tot ist; wirkt ab dem naechsten Respawn (HP/Waffe/Tempo der Klasse).
    this.onMessage('skin', (client, raw) => {
      const parsed = skinChangeSchema.safeParse(raw)
      const player = this.state.players.get(client.sessionId)
      if (!parsed.success || !player || player.alive || this.state.phase !== 'play') return
      void checkLimit(getRateStore(), `skin:${client.sessionId}`, 5, 1000).then((ok) => {
        if (ok && !player.alive) player.skin = parsed.data.skin
      })
    })
  }

  /** Admin-Panel: Token (ADMIN_TOKEN) pruefen; ohne gesetztes Token ist das Panel komplett deaktiviert. */
  private isAdmin(client: Client): boolean {
    return this.admins.has(client.sessionId)
  }

  private async handleAdminAuth(client: Client, raw: unknown): Promise<void> {
    const expected = process.env.ADMIN_TOKEN
    const parsed = adminAuthSchema.safeParse(raw)
    const reply = (ok: boolean): void => client.send('adminAuth', { ok })
    if (!expected || !parsed.success) return reply(false)
    if (!(await checkLimit(getRateStore(), `admin-auth:${clientIp(client)}`, 5, 60_000))) return reply(false)
    const a = createHash('sha256').update(parsed.data.token).digest()
    const b = createHash('sha256').update(expected).digest()
    const ok = timingSafeEqual(a, b)
    if (ok) this.admins.add(client.sessionId)
    reply(ok)
  }

  /** IPs der Spieler dieser Instanz + Bann-Liste (nur an angemeldete Admins). */
  private async sendAdminInfo(client: Client): Promise<void> {
    if (!this.isAdmin(client)) return
    const ips: Record<string, string> = {}
    for (const [id, ip] of this.ips) ips[id] = ip
    client.send('adminInfo', { ips, bans: await (await getBanStore()).list() })
  }

  private async handleAdminBan(client: Client, raw: unknown): Promise<void> {
    if (!this.isAdmin(client)) return
    const parsed = adminBanSchema.safeParse(raw)
    if (!parsed.success) return
    const ip = this.ips.get(parsed.data.target)
    const player = this.state.players.get(parsed.data.target)
    if (!ip || !player || player.isBot) return
    if (normalizeIp(ip) === normalizeIp(clientIp(client))) return // kein Selbst-Bann (Aussperr-Schutz)
    await (await getBanStore()).add({ ip, nickname: player.nickname, at: Date.now() })
    console.log(`[admin] ip-ban ${player.nickname}`)
    ArenaRoom.kickIp(ip)
    await this.sendAdminInfo(client)
  }

  private async handleAdminUnban(client: Client, raw: unknown): Promise<void> {
    if (!this.isAdmin(client)) return
    const parsed = adminUnbanSchema.safeParse(raw)
    if (!parsed.success) return
    if (await (await getBanStore()).remove(parsed.data.ip)) console.log('[admin] ip-unban')
    await this.sendAdminInfo(client)
  }

  /** Alle Verbindungen dieser IP in allen Raeumen trennen. */
  private static kickIp(ip: string): void {
    const n = normalizeIp(ip)
    for (const room of ArenaRoom.rooms) {
      for (const c of room.clients) {
        const cip = room.ips.get(c.sessionId)
        if (cip && normalizeIp(cip) === n) c.leave(4403)
      }
    }
  }

  private handleAdminPlayer(client: Client, raw: unknown): void {
    if (!this.isAdmin(client)) return
    const parsed = adminPlayerSchema.safeParse(raw)
    if (!parsed.success) return
    const cmd = parsed.data
    if (cmd.action === 'kick') {
      const player = this.state.players.get(cmd.target)
      if (!player) return
      const victim = this.clients.find((c) => c.sessionId === cmd.target)
      if (victim) victim.leave(4403)
      else removePlayer(this.ctx, this.state, cmd.target) // Bot
      console.log(`[admin] kick ${player.nickname}`)
      return
    }
    if (adminPlayer(this.ctx, this.state, cmd)) {
      console.log(`[admin] ${cmd.action} ${cmd.mode} ${cmd.value} -> ${this.state.players.get(cmd.target)?.nickname}`)
    }
  }

  private handleAdminRound(client: Client, raw: unknown): void {
    if (!this.isAdmin(client)) return
    const parsed = adminRoundSchema.safeParse(raw)
    if (!parsed.success) return
    adminRound(this.ctx, this.state, parsed.data)
    console.log(`[admin] round ${parsed.data.op} ${parsed.data.value}`)
  }

  private async handleInput(client: Client, raw: unknown): Promise<void> {
    // M4-05: Input-Limit 30/s (Toleranz 45 fuer Client-Hitches), Flood -> Disconnect.
    const hits = await getRateStore().hit(`input:${client.sessionId}`, 1000)
    if (hits > 120) {
      client.leave(4400)
      return
    }
    if (hits > INPUT_BURST_TOLERANCE) return
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
      // M5-01: Version-Gate mit Reload-Hinweis.
      throw new Error('PROTOCOL_MISMATCH:Bitte neu laden')
    }
    // IP-Bann (Admin-Panel): gesperrte Adressen kommen nicht mehr hinein.
    const ip = clientIp(client)
    if (await (await getBanStore()).isBanned(ip)) throw new Error('BANNED')
    // M4-05: Join-Limit 5/min/IP.
    if (!(await checkLimit(getRateStore(), `join:${clientIp(client)}`, 5, 60_000))) {
      throw new Error('RATE_LIMITED')
    }
    // M4-02: Gast-Session prüfen (fremde Tokens abweisen).
    // Der Spielername kommt aus der Session (Konto/Gast), nicht aus den Client-Optionen.
    const session = parsed.data.userId ? await getSessionStore().get(parsed.data.userId) : null
    if (!session) {
      throw new Error('INVALID_GUEST')
    }
    const player = new Player()
    player.nickname = session.nickname
    player.skin = parsed.data.skin ?? 0
    player.hp = classOf(player.skin).hp
    const spawn = findSpawn([...this.state.players.values()], this.state.map)
    player.x = spawn.x
    player.y = spawn.y
    this.state.players.set(client.sessionId, player)
    initPlayer(this.ctx, client.sessionId, spawn)
    this.userIds.set(client.sessionId, parsed.data.userId as string)
    this.ips.set(client.sessionId, ip)
  }

  async onLeave(client: Client, consented: boolean) {
    this.admins.delete(client.sessionId)
    this.userIds.delete(client.sessionId)
    // Explizites leave() -> sofort entfernen; Abriss -> 15 s Grace (M3-01).
    if (consented) {
      this.ips.delete(client.sessionId)
      removePlayer(this.ctx, this.state, client.sessionId)
      return
    }
    try {
      await this.allowReconnection(client, RECONNECT_GRACE_SECONDS)
      // Reconnected: Spieler + Score bleiben erhalten.
    } catch {
      this.ips.delete(client.sessionId)
      removePlayer(this.ctx, this.state, client.sessionId)
    }
  }

  onDispose() {
    ArenaRoom.rooms.delete(this)
  }

  /** Rundenende async persistieren (M4-03): fire-and-forget, nie im Sim-Tick warten. */
  private persistResult(winnerNickname: string): void {
    const db = getDb() as ResultsDb | null
    if (!db) return
    let winnerId: string | null = null
    let best = -1
    const rows: {
      userId: string
      nickname: string
      kills: number
      deaths: number
      score: number
    }[] = []
    for (const [sessionId, player] of this.state.players) {
      const userId = this.userIds.get(sessionId)
      if (!userId || player.isBot) continue
      rows.push({
        userId,
        nickname: player.nickname,
        kills: player.kills,
        deaths: player.deaths,
        score: player.score,
      })
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

/**
 * Client-IP: hinter einem Reverse-Proxy (Render, nginx, Compose) der LETZTE `X-Forwarded-For`-Eintrag
 * (den der naechste vertrauenswuerdige Proxy angehaengt hat; der erste waere client-faelschbar).
 * `TRUST_PROXY=false` (Server direkt im Netz) ignoriert den Header. Fallback: Socket-Adresse.
 */
export function clientIp(client: Client): string {
  const req = (client as unknown as {
    request?: { socket?: { remoteAddress?: string }; headers?: Record<string, string | string[] | undefined> }
  }).request
  const sock = (client as unknown as { _socket?: { remoteAddress?: string } })._socket
  if (process.env.TRUST_PROXY !== 'false') {
    const fwd = req?.headers?.['x-forwarded-for']
    const raw = Array.isArray(fwd) ? fwd.join(',') : fwd
    const last = raw?.split(',').at(-1)?.trim()
    if (last) return last
  }
  return req?.socket?.remoteAddress ?? sock?.remoteAddress ?? client.sessionId
}
