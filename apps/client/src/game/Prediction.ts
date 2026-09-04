import { PLAYER_RADIUS, PLAYER_SPEED, TICK_RATE, resolveArena, resolveRect } from '@neon-arena/shared'
import { OBSTACLES } from '@neon-arena/shared'

export interface PendingInput {
  seq: number
  dx: number
  dy: number
}

/**
 * Client Prediction (M2-05): eigene Bewegung sofort anwenden, bei Server-Snapshot
 * via ackSeq re-concilieren (Snap + Replay offener Inputs).
 */
export class Prediction {
  /** Vom Server bestaetigte Position. */
  serverPos = { x: 0, y: 0 }
  /** Gerenderte (vorhergesagte) Position. */
  predicted = { x: 0, y: 0 }
  private pending: PendingInput[] = []

  reset(x: number, y: number): void {
    this.serverPos = { x, y }
    this.predicted = { x, y }
    this.pending = []
  }

  /** Lokal anwenden + fuer Replay merken. */
  applyLocal(input: PendingInput): void {
    this.pending.push(input)
    step(this.predicted, input.dx, input.dy)
  }

  /** Server-Snapshot uebernehmen, bestaetigte Inputs verwerfen, Rest replayen. */
  reconcile(x: number, y: number, ackSeq: number): void {
    this.serverPos = { x, y }
    this.pending = this.pending.filter((p) => p.seq > ackSeq)
    this.predicted = { x, y }
    for (const p of this.pending) {
      step(this.predicted, p.dx, p.dy)
    }
  }

  get pendingCount(): number {
    return this.pending.length
  }
}

const STEP = PLAYER_SPEED / TICK_RATE

function step(pos: { x: number; y: number }, dx: number, dy: number): void {
  pos.x += dx * STEP
  pos.y += dy * STEP
  resolveArena(pos, PLAYER_RADIUS)
  for (const obstacle of OBSTACLES) {
    resolveRect(pos, PLAYER_RADIUS, obstacle)
  }
}
