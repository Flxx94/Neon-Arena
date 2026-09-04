import { ARENA_HEIGHT, ARENA_WIDTH, type ObstacleRect } from './constants.js'

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
