import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BOOST_PADS,
  BOOST_PAD_RADIUS,
  BOOST_SPEED_MULT,
  BOOST_TICKS,
  OBSTACLES,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  TICK_RATE,
  type BoostPad,
  type ObstacleRect,
} from './constants.js'

export interface Vec {
  x: number
  y: number
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** Kreis in Arena halten (Wand-Kollision). Mutiert p. */
export function resolveArena(p: Vec, radius: number): void {
  p.x = clamp(p.x, radius, ARENA_WIDTH - radius)
  p.y = clamp(p.y, radius, ARENA_HEIGHT - radius)
}

/** Kreis aus Rechteck schieben (Hindernis-Kollision). Mutiert p. */
export function resolveRect(p: Vec, radius: number, rect: ObstacleRect): void {
  const cx = clamp(p.x, rect.x, rect.x + rect.w)
  const cy = clamp(p.y, rect.y, rect.y + rect.h)
  const dx = p.x - cx
  const dy = p.y - cy
  const distSq = dx * dx + dy * dy
  if (distSq >= radius * radius) return
  if (distSq > 1e-9) {
    const dist = Math.sqrt(distSq)
    p.x = cx + (dx / dist) * radius
    p.y = cy + (dy / dist) * radius
    return
  }
  // Zentrum im Rechteck: zur naechsten Kante schieben.
  const left = p.x - rect.x
  const right = rect.x + rect.w - p.x
  const top = p.y - rect.y
  const bottom = rect.y + rect.h - p.y
  const min = Math.min(left, right, top, bottom)
  if (min === left) p.x = rect.x - radius
  else if (min === right) p.x = rect.x + rect.w + radius
  else if (min === top) p.y = rect.y - radius
  else p.y = rect.y + rect.h + radius
}

/**
 * Zwei Kreise entflechten (Spieler-Spieler). Mutiert beide je zur Haelfte.
 * Gibt true zurueck, wenn sie sich ueberschnitten haben.
 */
export function resolveCircle(a: Vec, ra: number, b: Vec, rb: number): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const minDist = ra + rb
  const distSq = dx * dx + dy * dy
  if (distSq >= minDist * minDist) return false
  if (distSq < 1e-9) {
    a.x -= minDist / 2
    b.x += minDist / 2
    return true
  }
  const dist = Math.sqrt(distSq)
  const push = (minDist - dist) / 2
  const nx = dx / dist
  const ny = dy / dist
  a.x -= nx * push
  a.y -= ny * push
  b.x += nx * push
  b.y += ny * push
  return true
}

/** Segment (Projektil-Bahn pro Tick) gegen Kreis (Spieler mit Rewind-Position). */
export function segmentHitsCircle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  let t = 0
  if (lenSq > 1e-9) {
    t = clamp(((cx - x1) * dx + (cy - y1) * dy) / lenSq, 0, 1)
  }
  const px = x1 + dx * t
  const py = y1 + dy * t
  const ox = cx - px
  const oy = cy - py
  return ox * ox + oy * oy <= radius * radius
}

/** Steht der Kreis auf einem Boost-Feld? */
export function onBoostPad(p: Vec, pads: readonly BoostPad[] = BOOST_PADS): boolean {
  const r = BOOST_PAD_RADIUS
  for (const pad of pads) {
    const dx = p.x - pad.x
    const dy = p.y - pad.y
    if (dx * dx + dy * dy <= r * r) return true
  }
  return false
}

/**
 * Ein Bewegungs-Tick eines Spielers (Server-Sim UND Client-Prediction nutzen exakt dies).
 * `boost` = verbleibende Boost-Ticks; Rueckgabe = neuer Wert. Boost wirkt ab dem Tick nach dem
 * Betreten, wird auf dem Feld aufgefrischt und laeuft sonst pro Tick um 1 ab.
 * `baseSpeed` = Lauftempo der Charakter-Klasse (px/s). Mutiert p.
 */
export function stepPlayer(
  p: Vec,
  boost: number,
  dx: number,
  dy: number,
  baseSpeed: number = PLAYER_SPEED,
  obstacles: readonly ObstacleRect[] = OBSTACLES,
  pads: readonly BoostPad[] = BOOST_PADS,
): number {
  const speed = (baseSpeed / TICK_RATE) * (boost > 0 ? BOOST_SPEED_MULT : 1)
  p.x += dx * speed
  p.y += dy * speed
  resolveArena(p, PLAYER_RADIUS)
  for (const obstacle of obstacles) resolveRect(p, PLAYER_RADIUS, obstacle)
  return onBoostPad(p, pads) ? BOOST_TICKS : Math.max(0, boost - 1)
}
