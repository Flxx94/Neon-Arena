import { PLAYER_SPEED, mapOf, stepPlayer, type MapDef } from '@neon-arena/shared'

export interface PendingInput {
  seq: number
  dx: number
  dy: number
}

/** Korrekturen ab dieser Distanz (px) werden hart gesnappt statt weich ausgeblendet (Teleport/Respawn). */
const SNAP_DISTANCE = 90

/**
 * Client Prediction (M2-05): eigene Bewegung sofort anwenden, bei Server-Snapshot
 * via ackSeq re-concilieren (Snap + Replay offener Inputs).
 *
 * Fluessigkeit:
 *  - `prev`/`predicted` sind die letzten zwei 30-Hz-Schritte; gerendert wird dazwischen interpoliert
 *    (`renderPos`), damit die Figur auf 60/120/144-Hz-Displays nicht in 30-Hz-Spruengen laeuft.
 *  - Reconciliation-Fehler (Server weicht minimal ab) wird als `offset` weich ausgeblendet statt zu poppen.
 * Die Schrittfunktion `stepPlayer` ist dieselbe wie auf dem Server (shared/physics), inkl. Boost.
 */
export class Prediction {
  /** Vom Server bestaetigte Position. */
  serverPos = { x: 0, y: 0 }
  /** Vorhergesagte Position nach dem letzten lokalen Schritt. */
  predicted = { x: 0, y: 0 }
  /** Position vor dem letzten lokalen Schritt (fuer Interpolation). */
  prev = { x: 0, y: 0 }
  /** Verbleibende Boost-Ticks (vorhergesagt). */
  boostLeft = 0
  /** Lauftempo der Charakter-Klasse (px/s), von main.ts aus dem eigenen Skin gesetzt. */
  speed: number = PLAYER_SPEED
  /** Aktive Karte (Hindernisse/Boost-Felder fuer die Schrittfunktion); Wechsel -> `reset`. */
  map: MapDef = mapOf(0)
  /** Abklingender visueller Korrektur-Versatz. */
  private offset = { x: 0, y: 0 }
  private pending: PendingInput[] = []

  reset(x: number, y: number): void {
    this.serverPos = { x, y }
    this.predicted = { x, y }
    this.prev = { x, y }
    this.offset = { x: 0, y: 0 }
    this.boostLeft = 0
    this.pending = []
  }

  /** Lokal anwenden + fuer Replay merken. */
  applyLocal(input: PendingInput): void {
    this.pending.push(input)
    this.prev = { ...this.predicted }
    this.boostLeft = stepPlayer(this.predicted, this.boostLeft, input.dx, input.dy, this.speed, this.map.obstacles, this.map.boostPads)
  }

  /** Server-Snapshot uebernehmen, bestaetigte Inputs verwerfen, Rest replayen. */
  reconcile(x: number, y: number, ackSeq: number, boost: number): void {
    const oldX = this.predicted.x
    const oldY = this.predicted.y
    this.serverPos = { x, y }
    this.pending = this.pending.filter((p) => p.seq > ackSeq)
    this.predicted = { x, y }
    this.boostLeft = boost
    this.prev = { x, y }
    for (const p of this.pending) {
      this.prev = { ...this.predicted }
      this.boostLeft = stepPlayer(this.predicted, this.boostLeft, p.dx, p.dy, this.speed, this.map.obstacles, this.map.boostPads)
    }
    // Visuelle Kontinuitaet: bisher gezeigte Position minus neue = Versatz, der danach abklingt.
    const ex = oldX - this.predicted.x + this.offset.x
    const ey = oldY - this.predicted.y + this.offset.y
    if (Math.hypot(ex, ey) > SNAP_DISTANCE) this.offset = { x: 0, y: 0 }
    else this.offset = { x: ex, y: ey }
  }

  /** Pro Frame: Korrektur-Versatz abklingen lassen (frameraten-unabhaengig). */
  decay(dtSeconds: number): void {
    const k = Math.exp(-dtSeconds * 12)
    this.offset.x *= k
    this.offset.y *= k
    if (Math.abs(this.offset.x) < 0.02) this.offset.x = 0
    if (Math.abs(this.offset.y) < 0.02) this.offset.y = 0
  }

  /** Anzuzeigende Position: Interpolation zwischen den letzten zwei Schritten (alpha 0..1) + Versatz. */
  renderPos(alpha: number): { x: number; y: number } {
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha
    return {
      x: this.prev.x + (this.predicted.x - this.prev.x) * a + this.offset.x,
      y: this.prev.y + (this.predicted.y - this.prev.y) * a + this.offset.y,
    }
  }

  get pendingCount(): number {
    return this.pending.length
  }
}
