import { INTERPOLATION_BUFFER_MS } from '@neon-arena/shared'
import type { ClientPlayer } from '../net/client.js'

export interface InterpPos {
  x: number
  y: number
}

interface Stamped {
  at: number
  pos: Map<string, InterpPos>
}

/**
 * Gegner-Interpolation (M3-05): rendern mit 100 ms Verzoegerungs-Puffer,
 * linear zwischen den zwei umgebenden Snapshots. Eigener Spieler bleibt predicted.
 */
export class Interpolator {
  private buffer: Stamped[] = []

  push(at: number, players: ClientPlayer[]): void {
    const pos = new Map<string, InterpPos>()
    for (const p of players) pos.set(p.id, { x: p.x, y: p.y })
    this.buffer.push({ at, pos })
    if (this.buffer.length > 10) this.buffer.shift()
  }

  /** Position zum Render-Zeitpunkt (now - 100 ms). Fallback: neuester Snapshot. */
  sample(id: string, now: number): InterpPos | null {
    const target = now - INTERPOLATION_BUFFER_MS
    const buf = this.buffer
    if (buf.length === 0) return null
    let older = buf[0]!
    if (target <= older.at) return older.pos.get(id) ?? null
    for (let i = 1; i < buf.length; i++) {
      const newer = buf[i]!
      if (target <= newer.at) {
        const a = older.pos.get(id)
        const b = newer.pos.get(id)
        if (!a) return b ?? null
        if (!b) return a
        const span = newer.at - older.at
        const t = span > 0 ? (target - older.at) / span : 1
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      }
      older = newer
    }
    return older.pos.get(id) ?? null
  }
}
