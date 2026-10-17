import { Client, Room } from 'colyseus.js'
import { MAX_INPUT_PER_SECOND } from '@neon-arena/shared'

import { SERVER_URL, type Identity } from './auth.js'

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
  root: number
  realm: number
  slow: number
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

  get sessionId(): string | null {
    return this.room?.sessionId ?? null
  }

  async join(identity: Identity, skin: number, events: NetEvents): Promise<void> {
    this.room = await this.client.joinOrCreate('arena', {
      nickname: identity.nickname,
      protocolV: 1,
      userId: identity.userId,
      skin,
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
            skin: number
            aim: number
            boost: number
            ult?: number
            ultTicks?: number
            stun?: number
            root?: number
            realm?: number
            slow?: number
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
          root: p.root ?? 0,
          realm: p.realm ?? 0,
          slow: p.slow ?? 0,
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
    this.room.onLeave(() => events.onError('Verbindung getrennt'))
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

  /** Charakterwechsel (nur waehrend man tot ist; sonst ignoriert der Server die Nachricht). */
  changeSkin(skin: number): void {
    this.room?.send('skin', { skin })
  }

  leave(): void {
    void this.room?.leave()
    this.room = null
  }
}

export const INPUT_HZ = MAX_INPUT_PER_SECOND
