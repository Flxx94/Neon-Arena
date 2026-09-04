import { Client, Room } from 'colyseus.js'
import { MAX_INPUT_PER_SECOND, type PlayerSnapshot } from '@neon-arena/shared'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:2567'

export interface NetEvents {
  onPlayers: (players: ClientPlayer[]) => void
  onError: (message: string) => void
}

/** Lokale Sicht auf einen Spieler (inkl. Nickname fuers UI/Tests). */
export interface ClientPlayer extends PlayerSnapshot {
  nickname: string
}

/** M1-Net-Layer: Connect, Snapshot-Empfang, Input-Senden mit seq (30/s). */
export class NetClient {
  private client = new Client(SERVER_URL)
  private room: Room | null = null
  private seq = 0
  /** Ring-Buffer der letzten Snapshots (M2: Interpolation/Reconciliation). */
  snapshots: ClientPlayer[][] = []

  get sessionId(): string | null {
    return this.room?.sessionId ?? null
  }

  async join(nickname: string, events: NetEvents): Promise<void> {
    this.room = await this.client.joinOrCreate('arena', { nickname, protocolV: 1 })
    this.room.onStateChange((state) => {
      const players: ClientPlayer[] = [...state.players.entries()].map(
        ([id, p]: [string, { x: number; y: number; hp: number; nickname: string }]) => ({
          id,
          x: p.x,
          y: p.y,
          hp: p.hp,
          nickname: p.nickname,
        }),
      )
      this.snapshots.push(players)
      if (this.snapshots.length > 10) this.snapshots.shift()
      events.onPlayers(players)
    })
    this.room.onError((_code, message) => events.onError(message || 'Verbindung verloren'))
    this.room.onLeave(() => events.onError('Verbindung getrennt'))
  }

  /** Wird vom Game-Loop mit 30 Hz aufgerufen; seq steigt pro Input. */
  sendInput(dx: number, dy: number, aim: number, fire: boolean): void {
    if (!this.room) return
    this.room.send('input', { kind: 'input', seq: this.seq++, dx, dy, aim, fire })
  }

  leave(): void {
    void this.room?.leave()
    this.room = null
  }
}

export const INPUT_HZ = MAX_INPUT_PER_SECOND
