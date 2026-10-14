import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  MAP_NAME,
  OBSTACLES,
  type ObstacleRect,
} from '@neon-arena/shared'
import { FONT, type Palette, type WallKind } from './palette.js'

/**
 * Karte "Prism Plaza" — rein visuell. Kollision kommt aus shared/OBSTACLES (Server autoritativ);
 * hier wird nur gezeichnet: Boden, Markierungen, Warnstreifen-Rand und 2.5D-Waende.
 * Der statische Teil wird einmal pro (Groesse, Theme) in einen Offscreen-Canvas gerendert.
 */
export interface View {
  w: number
  h: number
  dpr: number
  scale: number
  ox: number
  oy: number
}

const TAU = Math.PI * 2
const SKIRT = 12 // sichtbare Wandhoehe (nur Optik, unter der Kollisionsflaeche)
const BAND = 20 // Warnstreifen-Rand innen

export function wallKind(o: ObstacleRect): WallKind {
  if (o.w === o.h) return o.w >= 58 ? 'pillar' : 'crate'
  if (Math.max(o.w, o.h) >= 300) return 'barricade'
  if (Math.min(o.w, o.h) <= 36 && Math.max(o.w, o.h) <= 170) return 'bunker'
  return 'wall'
}

function rr(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const k = Math.min(r, w / 2, h / 2)
  ctx.moveTo(x + k, y)
  ctx.arcTo(x + w, y, x + w, y + h, k)
  ctx.arcTo(x + w, y + h, x, y + h, k)
  ctx.arcTo(x, y + h, x, y, k)
  ctx.arcTo(x, y, x + w, y, k)
  ctx.closePath()
}

function drawBackdrop(ctx: CanvasRenderingContext2D, pal: Palette, v: View): void {
  ctx.fillStyle = pal.bg
  ctx.fillRect(0, 0, v.w, v.h)
  // Punktraster ausserhalb der Arena (Papier-/Platinenstruktur)
  ctx.fillStyle = pal.bgDot
  const step = 28
  for (let y = 0; y < v.h + step; y += step) {
    for (let x = ((y / step) % 2) * (step / 2); x < v.w + step; x += step) {
      ctx.beginPath()
      ctx.arc(x, y, 1.8, 0, TAU)
      ctx.fill()
    }
  }
  // sanfte Vignette Richtung Raender
  const g = ctx.createRadialGradient(
    v.w / 2,
    v.h / 2,
    Math.min(v.w, v.h) * 0.35,
    v.w / 2,
    v.h / 2,
    Math.max(v.w, v.h) * 0.75,
  )
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, pal.theme === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(120,70,0,0.16)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, v.w, v.h)
}

function drawFloor(ctx: CanvasRenderingContext2D, pal: Palette): void {
  const tile = 100
  for (let ty = 0; ty < ARENA_HEIGHT / tile; ty++) {
    for (let tx = 0; tx < ARENA_WIDTH / tile; tx++) {
      ctx.fillStyle = (tx + ty) % 2 === 0 ? pal.floorA : pal.floorB
      ctx.fillRect(tx * tile, ty * tile, tile, tile)
    }
  }
  ctx.strokeStyle = pal.grid
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let x = 0; x <= ARENA_WIDTH; x += tile) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, ARENA_HEIGHT)
  }
  for (let y = 0; y <= ARENA_HEIGHT; y += tile) {
    ctx.moveTo(0, y)
    ctx.lineTo(ARENA_WIDTH, y)
  }
  ctx.stroke()
}

function drawDecals(ctx: CanvasRenderingContext2D, pal: Palette): void {
  const cx = ARENA_WIDTH / 2
  const cy = ARENA_HEIGHT / 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // Mittel-Emblem
  ctx.strokeStyle = pal.decal
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(cx, cy, 170, 0, TAU)
  ctx.stroke()
  ctx.setLineDash([16, 14])
  ctx.beginPath()
  ctx.arc(cx, cy, 128, 0, TAU)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.strokeStyle = pal.decalStrong
  ctx.lineWidth = 6
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU - Math.PI / 2
    const x = cx + Math.cos(a) * 78
    const y = cy + Math.sin(a) * 78
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, 22, 0, TAU)
  ctx.fillStyle = pal.decal
  ctx.fill()
  // Pfeile zur Mitte
  ctx.fillStyle = pal.decal
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU
    ctx.save()
    ctx.translate(cx + Math.cos(a) * 250, cy + Math.sin(a) * 250)
    ctx.rotate(a + Math.PI)
    ctx.beginPath()
    ctx.moveTo(18, 0)
    ctx.lineTo(-12, 15)
    ctx.lineTo(-4, 0)
    ctx.lineTo(-12, -15)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  // Fahrbahn-Strichlinien oben/unten + seitlich
  ctx.strokeStyle = pal.decal
  ctx.lineWidth = 4
  ctx.setLineDash([22, 18])
  ctx.beginPath()
  ctx.moveTo(cx, BAND + 30)
  ctx.lineTo(cx, 200)
  ctx.moveTo(cx, ARENA_HEIGHT - BAND - 30)
  ctx.lineTo(cx, ARENA_HEIGHT - 200)
  ctx.moveTo(BAND + 30, cy)
  ctx.lineTo(120, cy)
  ctx.moveTo(ARENA_WIDTH - BAND - 30, cy)
  ctx.lineTo(ARENA_WIDTH - 120, cy)
  ctx.stroke()
  ctx.setLineDash([])
  // Eckmarken
  ctx.strokeStyle = pal.decalStrong
  ctx.lineWidth = 6
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    const px = sx === 1 ? BAND + 26 : ARENA_WIDTH - BAND - 26
    const py = sy === 1 ? BAND + 26 : ARENA_HEIGHT - BAND - 26
    ctx.beginPath()
    ctx.moveTo(px + sx * 54, py)
    ctx.lineTo(px, py)
    ctx.lineTo(px, py + sy * 54)
    ctx.stroke()
  }
  // Viertel-Embleme: orientieren in der grossen Arena (Ring + Raute)
  for (const [qx, qy] of [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ] as const) {
    const ex = ARENA_WIDTH * qx
    const ey = ARENA_HEIGHT * qy
    ctx.strokeStyle = pal.decal
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(ex, ey, 96, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([12, 12])
    ctx.beginPath()
    ctx.arc(ex, ey, 70, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = pal.decalStrong
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(ex, ey - 38)
    ctx.lineTo(ex + 38, ey)
    ctx.lineTo(ex, ey + 38)
    ctx.lineTo(ex - 38, ey)
    ctx.closePath()
    ctx.stroke()
  }
  // Mittellinien (Orientierung): gestrichelt zwischen Emblemen
  ctx.strokeStyle = pal.decal
  ctx.lineWidth = 4
  ctx.setLineDash([22, 18])
  ctx.beginPath()
  ctx.moveTo(cx - 520, cy)
  ctx.lineTo(cx - 320, cy)
  ctx.moveTo(cx + 320, cy)
  ctx.lineTo(cx + 520, cy)
  ctx.moveTo(cx, cy - 320)
  ctx.lineTo(cx, cy - 520)
  ctx.moveTo(cx, cy + 320)
  ctx.lineTo(cx, cy + 520)
  ctx.stroke()
  ctx.setLineDash([])
  // Boden-Schriftzug
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.fillStyle = pal.decal
  ctx.font = `800 54px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(MAP_NAME.toUpperCase().split('').join(' '), cx, ARENA_HEIGHT - 62)
  ctx.restore()
}

function drawBand(ctx: CanvasRenderingContext2D, pal: Palette): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT)
  ctx.rect(BAND, BAND, ARENA_WIDTH - BAND * 2, ARENA_HEIGHT - BAND * 2)
  ctx.clip('evenodd')
  ctx.fillStyle = pal.borderBand
  ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT)
  // Diagonale Warnstreifen
  ctx.globalAlpha = pal.theme === 'dark' ? 0.55 : 0.9
  ctx.lineWidth = 12
  ctx.strokeStyle = pal.stripeA
  ctx.beginPath()
  for (let x = -ARENA_HEIGHT; x < ARENA_WIDTH + ARENA_HEIGHT; x += 36) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x + ARENA_HEIGHT, ARENA_HEIGHT)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.restore()
  // Innenkante des Rands
  ctx.strokeStyle = pal.ink
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.rect(BAND, BAND, ARENA_WIDTH - BAND * 2, ARENA_HEIGHT - BAND * 2)
  ctx.stroke()
}

function drawWall(ctx: CanvasRenderingContext2D, pal: Palette, o: ObstacleRect): void {
  const kind = wallKind(o)
  const c = pal.walls[kind]
  const rad = Math.min(10, o.w / 3, o.h / 3)
  // Bodenschatten
  ctx.fillStyle = pal.shadow
  ctx.beginPath()
  rr(ctx, o.x + 8, o.y + SKIRT + 10, o.w, o.h, rad)
  ctx.fill()
  // Dunkles Leuchten im Night-Theme (statisch gecacht -> shadowBlur ist hier gratis)
  if (pal.additive) {
    ctx.save()
    ctx.shadowColor = c.top
    ctx.shadowBlur = 26
    ctx.fillStyle = c.top
    ctx.beginPath()
    rr(ctx, o.x, o.y, o.w, o.h, rad)
    ctx.fill()
    ctx.restore()
  }
  // Seitenflaeche (Skirt)
  ctx.lineJoin = 'round'
  ctx.lineWidth = 4
  ctx.strokeStyle = pal.ink
  ctx.fillStyle = c.side
  ctx.beginPath()
  rr(ctx, o.x, o.y + SKIRT, o.w, o.h, rad)
  ctx.fill()
  ctx.stroke()
  // Deckflaeche
  ctx.fillStyle = c.top
  ctx.beginPath()
  rr(ctx, o.x, o.y, o.w, o.h, rad)
  ctx.fill()
  // Muster je nach Typ (innerhalb der Deckflaeche geclippt)
  ctx.save()
  ctx.beginPath()
  rr(ctx, o.x, o.y, o.w, o.h, rad)
  ctx.clip()
  ctx.strokeStyle = c.hi
  ctx.fillStyle = c.hi
  switch (kind) {
    case 'bunker': {
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 6
      ctx.beginPath()
      for (let d = -o.h; d < o.w + o.h; d += 18) {
        ctx.moveTo(o.x + d, o.y + o.h)
        ctx.lineTo(o.x + d + o.h, o.y)
      }
      ctx.stroke()
      break
    }
    case 'wall': {
      ctx.globalAlpha = 0.85
      const vertical = o.h > o.w
      ctx.lineWidth = 5
      ctx.setLineDash([14, 12])
      ctx.beginPath()
      if (vertical) {
        ctx.moveTo(o.x + o.w / 2, o.y + 10)
        ctx.lineTo(o.x + o.w / 2, o.y + o.h - 10)
      } else {
        ctx.moveTo(o.x + 10, o.y + o.h / 2)
        ctx.lineTo(o.x + o.w - 10, o.y + o.h / 2)
      }
      ctx.stroke()
      ctx.setLineDash([])
      break
    }
    case 'pillar': {
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 5
      ctx.beginPath()
      rr(ctx, o.x + 11, o.y + 11, o.w - 22, o.h - 22, 6)
      ctx.stroke()
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.arc(o.x + o.w / 2, o.y + o.h / 2, 7, 0, TAU)
      ctx.fill()
      break
    }
    case 'barricade': {
      ctx.globalAlpha = 0.6
      ctx.lineWidth = 5
      ctx.beginPath()
      for (let x = o.x + 14; x < o.x + o.w - 8; x += 26) {
        ctx.moveTo(x, o.y + o.h - 8)
        ctx.lineTo(x + 10, o.y + o.h / 2)
        ctx.lineTo(x, o.y + 8)
      }
      ctx.stroke()
      break
    }
    case 'crate': {
      ctx.globalAlpha = 0.7
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.moveTo(o.x + 8, o.y + 8)
      ctx.lineTo(o.x + o.w - 8, o.y + o.h - 8)
      ctx.moveTo(o.x + o.w - 8, o.y + 8)
      ctx.lineTo(o.x + 8, o.y + o.h - 8)
      ctx.stroke()
      break
    }
  }
  ctx.globalAlpha = 1
  // Glanzkante oben/links
  ctx.strokeStyle = c.hi
  ctx.globalAlpha = 0.8
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(o.x + rad, o.y + 3)
  ctx.lineTo(o.x + o.w - rad, o.y + 3)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.restore()
  // Outline
  ctx.lineWidth = 4
  ctx.strokeStyle = pal.ink
  ctx.beginPath()
  rr(ctx, o.x, o.y, o.w, o.h, rad)
  ctx.stroke()
  // Nieten an den Ecken (grosse Bloecke)
  if (o.w >= 56 && o.h >= 56) {
    ctx.fillStyle = pal.ink
    for (const [bx, by] of [
      [o.x + 9, o.y + 9],
      [o.x + o.w - 9, o.y + 9],
      [o.x + 9, o.y + o.h - 9],
      [o.x + o.w - 9, o.y + o.h - 9],
    ] as const) {
      ctx.beginPath()
      ctx.arc(bx, by, 3, 0, TAU)
      ctx.fill()
    }
  }
}

/** Hintergrund ausserhalb der Arena (Viewport-gross, unabhaengig von der Kamera). */
export function buildBackdropLayer(pal: Palette, v: View): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(v.w * v.dpr))
  canvas.height = Math.max(1, Math.round(v.h * v.dpr))
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0)
  drawBackdrop(ctx, pal, v)
  return canvas
}

/** Rand um die Arena im Welt-Layer (Sockel, Schatten, Eck-Beacons). */
export const WORLD_PAD = 48

/**
 * Rendert die komplette Arena (Boden, Rand, Waende) einmal pro (Theme, Aufloesung) in einen
 * Offscreen-Canvas. `ls` = Pixel pro Welteinheit; die Kamera zeichnet ihn skaliert/verschoben.
 */
export function buildWorldLayer(pal: Palette, ls: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round((ARENA_WIDTH + WORLD_PAD * 2) * ls))
  canvas.height = Math.max(1, Math.round((ARENA_HEIGHT + WORLD_PAD * 2) * ls))
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(ls, 0, 0, ls, WORLD_PAD * ls, WORLD_PAD * ls)

  // Arena-Sockel: Schatten + dicke Kante (3D-Rand unten)
  ctx.fillStyle = pal.shadow
  ctx.beginPath()
  rr(ctx, 10, 26, ARENA_WIDTH, ARENA_HEIGHT, 26)
  ctx.fill()
  ctx.fillStyle = pal.ink
  ctx.beginPath()
  rr(ctx, -8, -8, ARENA_WIDTH + 16, ARENA_HEIGHT + 30, 30)
  ctx.fill()

  ctx.save()
  ctx.beginPath()
  rr(ctx, 0, 0, ARENA_WIDTH, ARENA_HEIGHT, 22)
  ctx.clip()
  drawFloor(ctx, pal)
  drawDecals(ctx, pal)
  drawBand(ctx, pal)
  ctx.restore()

  // Waende nach Hoehe sortieren: weiter unten = spaeter (korrekte Ueberlappung der Skirts)
  const walls = [...OBSTACLES].sort((a, b) => a.y + a.h - (b.y + b.h))
  for (const o of walls) drawWall(ctx, pal, o)
  return canvas
}

/** Animierter Dekor-Anteil (leicht, pro Frame): Mittel-Puls und Eck-Leuchten. */
export function drawAmbient(ctx: CanvasRenderingContext2D, pal: Palette, t: number): void {
  const cx = ARENA_WIDTH / 2
  const cy = ARENA_HEIGHT / 2
  const k = (t % 3.2) / 3.2
  ctx.globalAlpha = (1 - k) * (pal.theme === 'dark' ? 0.5 : 0.35)
  ctx.strokeStyle = pal.decalStrong
  ctx.lineWidth = 6 * (1 - k) + 1
  ctx.beginPath()
  ctx.arc(cx, cy, 24 + k * 170, 0, TAU)
  ctx.stroke()
  ctx.globalAlpha = 1
  // Eck-Beacons (ausserhalb des Rands, auf dem Sockel)
  const colors = [
    pal.walls.bunker.top,
    pal.walls.wall.top,
    pal.walls.pillar.top,
    pal.walls.barricade.top,
  ]
  const spots = [
    [-2, -2],
    [ARENA_WIDTH + 2, -2],
    [ARENA_WIDTH + 2, ARENA_HEIGHT + 2],
    [-2, ARENA_HEIGHT + 2],
  ] as const
  spots.forEach(([x, y], i) => {
    const on = 0.5 + 0.5 * Math.sin(t * 2.6 + i * 1.57)
    ctx.beginPath()
    ctx.arc(x, y, 10, 0, TAU)
    ctx.fillStyle = pal.ink
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y, 6.5, 0, TAU)
    ctx.fillStyle = colors[i]!
    ctx.globalAlpha = 0.45 + on * 0.55
    ctx.fill()
    ctx.globalAlpha = 1
  })
}
