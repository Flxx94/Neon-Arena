import { Client, Room } from 'colyseus.js'
import { MAX_INPUT_PER_SECOND, PROTOCOL_V, type AdminPlayerInput, type AdminRoundInput } from '@neon-arena/shared'

import { SERVER_URL, type Identity } from './auth.js'

export interface AdminBan {
  ip: string
  nickname: string
  at: number
}

export interface AdminInfo {
  ips: Record<string, string>
  bans: AdminBan[]
}

export interface NetEvents {
  onSnapshot: (snapshot: WorldSnapshot) => void
  onKill: (by: string, victim: string) => void
  onError: (message: string) => void
}

/** Lokale Sicht auf einen Spieler (inkl. Nickname fuers UI/Tests). */
export interface ClientPlayer {
  id: string
  nickname: string
  x: number
  y: number
  hp: number
  alive: boolean
  ackSeq: number
  score: number
  kills: number
  deaths: number
  shield: number
  isBot: boolean
  skin: number
  aim: number
  boost: number
  /** Ult-Ladung 0..ULT_MAX und Status-Zaehler (Ult aktiv, betaeubt, gewurzelt, Geisterwelt-Instanz). */
  ult: number
  ultTicks: number
  stun: number
  disarm: number
  realm: number
  slow: number
  hidden: number
  /** Ult-Richtung (Rakete: Flugrichtung) und Ult-Punkt (Strahl-Ursprung, Wuerfel-Ziel). */
  ultAim: number
  ultX: number
  ultY: number
}

export interface ClientProjectile {
  id: string
  x: number
  y: number
  owner: string
  /** Charakter-Klasse des Schuetzen (Modellindex): bestimmt Optik/Sound. */
  kind: number
}

export interface ClientPickup {
  id: string
  kind: string
  x: number
  y: number
}

export interface WorldSnapshot {
  at: number
  players: ClientPlayer[]
  projectiles: ClientProjectile[]
  pickups: ClientPickup[]
  timeLeft: number
  phase: string
  winner: string
  map: number
}

/** M1-Net-Layer: Connect, Snapshot-Empfang, Input-Senden mit seq (30/s). */
export class NetClient {
  private client = new Client(SERVER_URL)
  private room: Room | null = null
  private seq = 0
  /** Ring-Buffer der letzten Snapshots (M3: Interpolation). */
  snapshots: WorldSnapshot[] = []
  /** Debug: letzte Roundtrip-Zeit (ms) und Abstand zwischen Snapshots (Mittel/Max der letzten ~2 s). */
  stats = { rtt: -1, snapAvg: 0, snapMax: 0 }
  private lastSnapAt = 0
  private snapGaps: number[] = []
  private pingTimer: number | undefined

  get sessionId(): string | null {
    return this.room?.sessionId ?? null
  }

  async join(identity: Identity, skin: number, events: NetEvents): Promise<void> {
    this.room = await this.client.joinOrCreate('arena', {
      nickname: identity.nickname,
      protocolV: PROTOCOL_V,
      userId: identity.userId,
      skin,
    })
    this.room.onMessage('adminInfo', (msg: AdminInfo) => this.onAdminInfo?.(msg))
    this.room.onMessage('adminAuth', (msg: { ok: boolean }) => this.onAdminAuth?.(!!msg?.ok))
    this.room.onMessage('killfeed', (msg: { by: string; victim: string }) => {
      events.onKill(String(msg.by), String(msg.victim))
    })
    this.room.onMessage('pong', (t: number) => {
      this.stats.rtt = Math.round(performance.now() - t)
    })
    window.clearInterval(this.pingTimer)
    this.pingTimer = window.setInterval(() => this.room?.send('ping', performance.now()), 2000)
    this.room.onStateChange((state) => {
      const nowMs = performance.now()
      if (this.lastSnapAt) {
        this.snapGaps.push(nowMs - this.lastSnapAt)
        if (this.snapGaps.length > 40) this.snapGaps.shift()
        this.stats.snapAvg = Math.round(this.snapGaps.reduce((a, b) => a + b, 0) / this.snapGaps.length)
        this.stats.snapMax = Math.round(Math.max(...this.snapGaps))
      }
      this.lastSnapAt = nowMs
      const players: ClientPlayer[] = [...state.players.entries()].map(
        ([id, p]: [
          string,
          {
            x: number
            y: number
            hp: number
            nickname: string
            alive: boolean
            ackSeq: number
            score: number
            kills: number
            deaths: number
            shield: number
            isBot: boolean
            skin: number
            aim: number
            boost: number
            ult?: number
            ultTicks?: number
            stun?: number
            disarm?: number
            realm?: number
            slow?: number
            hidden?: number
            ultAim?: number
            ultX?: number
            ultY?: number
          },
        ]) => ({
          id,
          x: p.x,
          y: p.y,
          hp: p.hp,
          nickname: p.nickname,
          alive: p.alive,
          ackSeq: p.ackSeq,
          score: p.score,
          kills: p.kills,
          deaths: p.deaths,
          shield: p.shield,
          isBot: p.isBot,
          skin: p.skin,
          aim: p.aim,
          boost: p.boost ?? 0,
          ult: p.ult ?? 0,
          ultTicks: p.ultTicks ?? 0,
          stun: p.stun ?? 0,
          disarm: p.disarm ?? 0,
          realm: p.realm ?? 0,
          slow: p.slow ?? 0,
          hidden: p.hidden ?? 0,
          ultAim: p.ultAim ?? 0,
          ultX: p.ultX ?? 0,
          ultY: p.ultY ?? 0,
        }),
      )
      const projectiles: ClientProjectile[] = [...state.projectiles.values()].map(
        (p: {
          id: string
          x: number
          y: number
          kind?: number
          owner?: string
        }) => ({
          id: p.id,
          x: p.x,
          y: p.y,
          kind: p.kind ?? 0,
          owner: p.owner ?? '',
        }),
      )
      const pickups: ClientPickup[] = [...state.pickups.values()].map(
        (p: { id: string; kind: string; x: number; y: number }) => ({
          id: p.id,
          kind: p.kind,
          x: p.x,
          y: p.y,
        }),
      )
      const snapshot: WorldSnapshot = {
        at: performance.now(),
        players,
        projectiles,
        pickups,
        timeLeft: state.timeLeft as number,
        phase: state.phase as string,
        winner: state.winner as string,
        map: state.map as number,
      }
      this.snapshots.push(snapshot)
      if (this.snapshots.length > 10) this.snapshots.shift()
      events.onSnapshot(snapshot)
    })
    this.room.onError((_code, message) => events.onError(message || 'Verbindung verloren'))
    this.room.onLeave((code) =>
      events.onError(code === 4403 ? 'Du wurdest vom Server entfernt.' : 'Verbindung getrennt'),
    )
  }

  /** Wird vom Game-Loop mit 30 Hz aufgerufen; seq steigt pro Input. Gibt seq zurueck. */
  sendInput(
    dx: number,
    dy: number,
    aim: number,
    fire: boolean,
    ult: { ua: number; ud: number } | null = null,
  ): number {
    if (!this.room) return -1
    const seq = this.seq++
    this.room.send(
      'input',
      ult
        ? { kind: 'input', seq, dx, dy, aim, fire, ult: true, ua: ult.ua, ud: ult.ud }
        : { kind: 'input', seq, dx, dy, aim, fire },
    )
    return seq
  }

  /** Admin-Panel: Antwort auf `adminAuth` (true = angemeldet). */
  onAdminAuth: ((ok: boolean) => void) | null = null

  /** Admin-Panel: IPs der Spieler + Bann-Liste. */
  onAdminInfo: ((info: AdminInfo) => void) | null = null

  adminInfo(): void {
    this.room?.send('adminInfo', {})
  }

  adminBan(target: string): void {
    this.room?.send('adminBan', { target })
  }

  adminUnban(ip: string): void {
    this.room?.send('adminUnban', { ip })
  }

  adminAuth(token: string): void {
    this.room?.send('adminAuth', { token })
  }

  adminPlayer(cmd: Pick<AdminPlayerInput, 'action' | 'target'> & Partial<Pick<AdminPlayerInput, 'mode' | 'value'>>): void {
    this.room?.send('adminPlayer', cmd)
  }

  adminRound(cmd: Pick<AdminRoundInput, 'op'> & Partial<Pick<AdminRoundInput, 'value'>>): void {
    this.room?.send('adminRound', cmd)
  }

  /** Charakterwechsel (nur waehrend man tot ist; sonst ignoriert der Server die Nachricht). */
  changeSkin(skin: number): void {
    this.room?.send('skin', { skin })
  }

  leave(): void {
    window.clearInterval(this.pingTimer)
    this.lastSnapAt = 0
    this.snapGaps = []
    this.stats.rtt = -1
    void this.room?.leave()
    this.room = null
  }
}

export const INPUT_HZ = MAX_INPUT_PER_SECOND
