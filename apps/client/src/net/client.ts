import { Client, Room } from 'colyseus.js'
import { MAX_INPUT_PER_SECOND } from '@neon-arena/shared'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:2567'

export interface GuestIdentity {
  userId: string
  nickname: string
}

/** Gast-Identitaet holen (M4-02): /me per Cookie, sonst neu ausstellen. */
export async function ensureGuest(nickname: string): Promise<GuestIdentity> {
  const me = await fetch(`${SERVER_URL}/me`, { credentials: 'include' }).catch(() => null)
  if (me?.ok) {
    const identity = (await me.json()) as GuestIdentity
    if (identity.nickname === nickname) return identity
  }
  const res = await fetch(`${SERVER_URL}/auth/guest`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname }),
  })
  if (!res.ok) throw new Error(res.status === 429 ? 'Zu viele Versuche – warte kurz' : 'Gast-Anmeldung fehlgeschlagen')
  return (await res.json()) as GuestIdentity
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
}

export interface ClientProjectile {
  id: string
  x: number
  y: number
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
}

/** M1-Net-Layer: Connect, Snapshot-Empfang, Input-Senden mit seq (30/s). */
export class NetClient {
  private client = new Client(SERVER_URL)
  private room: Room | null = null
  private seq = 0
  /** Ring-Buffer der letzten Snapshots (M3: Interpolation). */
  snapshots: WorldSnapshot[] = []

  get sessionId(): string | null {
    return this.room?.sessionId ?? null
  }

  async join(nickname: string, events: NetEvents): Promise<void> {
    const guest = await ensureGuest(nickname)
    this.room = await this.client.joinOrCreate('arena', {
      nickname: guest.nickname,
      protocolV: 1,
      userId: guest.userId,
    })
    this.room.onMessage('killfeed', (msg: { by: string; victim: string }) => {
      events.onKill(String(msg.by), String(msg.victim))
    })
    this.room.onStateChange((state) => {
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
        }),
      )
      const projectiles: ClientProjectile[] = [...state.projectiles.values()].map(
        (p: { id: string; x: number; y: number }) => ({ id: p.id, x: p.x, y: p.y }),
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
      }
      this.snapshots.push(snapshot)
      if (this.snapshots.length > 10) this.snapshots.shift()
      events.onSnapshot(snapshot)
    })
    this.room.onError((_code, message) => events.onError(message || 'Verbindung verloren'))
    this.room.onLeave(() => events.onError('Verbindung getrennt'))
  }

  /** Wird vom Game-Loop mit 30 Hz aufgerufen; seq steigt pro Input. Gibt seq zurueck. */
  sendInput(dx: number, dy: number, aim: number, fire: boolean): number {
    if (!this.room) return -1
    const seq = this.seq++
    this.room.send('input', { kind: 'input', seq, dx, dy, aim, fire })
    return seq
  }

  leave(): void {
    void this.room?.leave()
    this.room = null
  }
}

export const INPUT_HZ = MAX_INPUT_PER_SECOND
