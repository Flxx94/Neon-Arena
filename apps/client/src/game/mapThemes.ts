import { ARENA_HEIGHT, ARENA_WIDTH, type MapTheme, type ObstacleRect } from '@neon-arena/shared'
import type { Palette, WallColors, WallKind } from './palette.js'

/**
 * Optik der Zusatz-Karten (Winter, Wueste, Dschungel). Rein visuell: Kollision/Physik kommen
 * aus shared/maps. Alles Statische wird einmal in den Welt-Layer gezeichnet (Zufall ist geseedet,
 * damit alle Clients dieselbe Karte sehen); nur `drawThemeAmbient` laeuft pro Frame.
 */
const TAU = Math.PI * 2
const BAND = 20

export type ThemedMap = Exclude<MapTheme, 'neon'>

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath()
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, TAU)
  ctx.fill()
}

// ------------------------------------------------------------------------------------
// Boden
// ------------------------------------------------------------------------------------
export function drawThemeFloor(ctx: CanvasRenderingContext2D, pal: Palette, theme: ThemedMap): void {
  const R = rng(theme === 'winter' ? 11 : theme === 'desert' ? 22 : 33)
  ctx.fillStyle = pal.floorA
  ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT)
  if (theme === 'winter') {
    // Schneeverwehungen: weiche Flecken, dazu Glitzerpunkte
    ctx.fillStyle = pal.floorB
    for (let i = 0; i < 420; i++) {
      ctx.globalAlpha = 0.35 + R() * 0.4
      blob(ctx, R() * ARENA_WIDTH, R() * ARENA_HEIGHT, 40 + R() * 150, 18 + R() * 60)
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = pal.theme === 'dark' ? 'rgba(235, 248, 255, 0.55)' : 'rgba(150, 195, 230, 0.55)'
    for (let i = 0; i < 700; i++) {
      const s = 1.5 + R() * 2.5
      ctx.fillRect(R() * ARENA_WIDTH, R() * ARENA_HEIGHT, s, s)
    }
    // Spuren im Schnee
    ctx.strokeStyle = pal.decal
    ctx.lineWidth = 3
    ctx.setLineDash([6, 22])
    ctx.lineCap = 'round'
    for (let i = 0; i < 5; i++) {
      const y = 200 + R() * (ARENA_HEIGHT - 400)
      ctx.beginPath()
      ctx.moveTo(60, y)
      ctx.bezierCurveTo(ARENA_WIDTH * 0.3, y + 160 * (R() - 0.5), ARENA_WIDTH * 0.6, y + 160 * (R() - 0.5), ARENA_WIDTH - 60, y + 80 * (R() - 0.5))
      ctx.stroke()
    }
    ctx.setLineDash([])
  } else if (theme === 'desert') {
    // Duenenwellen + Kiesel
    ctx.strokeStyle = pal.floorB
    ctx.lineWidth = 7
    ctx.lineCap = 'round'
    for (let y = 30; y < ARENA_HEIGHT; y += 52) {
      ctx.globalAlpha = 0.7
      ctx.beginPath()
      const ph = R() * TAU
      const amp = 8 + R() * 10
      for (let x = 0; x <= ARENA_WIDTH; x += 40) {
        const yy = y + Math.sin(x / 150 + ph) * amp + Math.sin(x / 61 + ph * 2) * 3
        if (x === 0) ctx.moveTo(x, yy)
        else ctx.lineTo(x, yy)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = pal.decal
    for (let i = 0; i < 520; i++) blob(ctx, R() * ARENA_WIDTH, R() * ARENA_HEIGHT, 2 + R() * 4, 1.5 + R() * 2.5)
  } else {
    // Dschungel: Wegekreuz aus Erde, Grasbueschel, Blaetter
    ctx.strokeStyle = pal.theme === 'dark' ? '#3a2e1a' : '#c8b07a'
    ctx.globalAlpha = 0.6
    ctx.lineWidth = 120
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(120, ARENA_HEIGHT / 2)
    ctx.lineTo(ARENA_WIDTH - 120, ARENA_HEIGHT / 2)
    ctx.moveTo(ARENA_WIDTH / 2, 120)
    ctx.lineTo(ARENA_WIDTH / 2, ARENA_HEIGHT - 120)
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.fillStyle = pal.floorB
    for (let i = 0; i < 300; i++) {
      ctx.globalAlpha = 0.6
      blob(ctx, R() * ARENA_WIDTH, R() * ARENA_HEIGHT, 30 + R() * 90, 16 + R() * 40)
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = pal.decalStrong
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (let i = 0; i < 1100; i++) {
      const x = R() * ARENA_WIDTH
      const y = R() * ARENA_HEIGHT
      const h = 7 + R() * 9
      ctx.moveTo(x - 5, y)
      ctx.lineTo(x - 2, y - h)
      ctx.moveTo(x, y)
      ctx.lineTo(x, y - h * 1.2)
      ctx.moveTo(x + 5, y)
      ctx.lineTo(x + 2, y - h)
    }
    ctx.stroke()
  }
}

// ------------------------------------------------------------------------------------
// Dekor in der Mitte (rein optisch, Kollision unberuehrt)
// ------------------------------------------------------------------------------------
export function drawThemeDecals(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  theme: ThemedMap,
  name: string,
): void {
  const cx = ARENA_WIDTH / 2
  const cy = ARENA_HEIGHT / 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (theme === 'winter') {
    // Zugefrorener See
    ctx.fillStyle = pal.theme === 'dark' ? 'rgba(140, 210, 255, 0.30)' : 'rgba(120, 190, 240, 0.35)'
    ctx.strokeStyle = pal.decalStrong
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.ellipse(cx, cy, 300, 190, 0, 0, TAU)
    ctx.fill()
    ctx.stroke()
    ctx.lineWidth = 3
    ctx.strokeStyle = pal.decal
    ctx.beginPath()
    ctx.ellipse(cx, cy, 240, 140, 0, 0, TAU)
    ctx.stroke()
    // Risse im Eis
    ctx.strokeStyle = pal.decalStrong
    ctx.lineWidth = 3
    ctx.beginPath()
    for (const [x1, y1, x2, y2, x3, y3] of [
      [-170, -40, -60, -10, 10, -60],
      [-60, -10, -30, 50, -90, 100],
      [60, 10, 150, 30, 210, -10],
      [60, 10, 40, 80, 100, 120],
    ] as const) {
      ctx.moveTo(cx + x1, cy + y1)
      ctx.lineTo(cx + x2, cy + y2)
      ctx.lineTo(cx + x3, cy + y3)
    }
    ctx.stroke()
  } else if (theme === 'desert') {
    // Sonnen-Glyphe
    ctx.strokeStyle = pal.decal
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.arc(cx, cy, 170, 0, TAU)
    ctx.stroke()
    ctx.strokeStyle = pal.decalStrong
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.arc(cx, cy, 70, 0, TAU)
    ctx.stroke()
    ctx.beginPath()
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU
      const r1 = i % 2 === 0 ? 96 : 92
      const r2 = i % 2 === 0 ? 150 : 124
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2)
    }
    ctx.stroke()
  } else {
    // Steinkreis mit Glyphen
    ctx.fillStyle = pal.decal
    ctx.strokeStyle = pal.decalStrong
    ctx.lineWidth = 4
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU
      ctx.beginPath()
      ctx.arc(cx + Math.cos(a) * 170, cy + Math.sin(a) * 170, 15, 0, TAU)
      ctx.fill()
      ctx.stroke()
    }
    ctx.lineWidth = 5
    ctx.beginPath()
    let first = true
    for (let a = 0; a < TAU * 2.2; a += 0.12) {
      const r = 20 + a * 11
      const x = cx + Math.cos(a) * r
      const y = cy + Math.sin(a) * r
      if (first) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
      first = false
    }
    ctx.stroke()
  }
  ctx.fillStyle = pal.decalStrong
  ctx.font = `900 30px ui-rounded, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(name.toUpperCase().split('').join(' '), cx, ARENA_HEIGHT - 62)
}

// ------------------------------------------------------------------------------------
// Rand
// ------------------------------------------------------------------------------------
export function drawThemeBand(ctx: CanvasRenderingContext2D, pal: Palette, theme: ThemedMap): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT)
  ctx.rect(BAND, BAND, ARENA_WIDTH - BAND * 2, ARENA_HEIGHT - BAND * 2)
  ctx.clip('evenodd')
  ctx.fillStyle = pal.borderBand
  ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT)
  ctx.fillStyle = pal.stripeA
  ctx.strokeStyle = pal.stripeA
  if (theme === 'winter') {
    // Schneewall: Kuppen entlang der Kante
    for (let x = 0; x < ARENA_WIDTH; x += 26) {
      blob(ctx, x + 13, BAND - 2, 15, 12)
      blob(ctx, x + 13, ARENA_HEIGHT - BAND + 2, 15, 12)
    }
    for (let y = 0; y < ARENA_HEIGHT; y += 26) {
      blob(ctx, BAND - 2, y + 13, 12, 15)
      blob(ctx, ARENA_WIDTH - BAND + 2, y + 13, 12, 15)
    }
  } else if (theme === 'desert') {
    // Sandsteinquader
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 3
    ctx.strokeStyle = pal.ink
    ctx.beginPath()
    for (let x = 0; x < ARENA_WIDTH; x += 48) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, BAND)
      ctx.moveTo(x + 24, ARENA_HEIGHT - BAND)
      ctx.lineTo(x + 24, ARENA_HEIGHT)
    }
    for (let y = 0; y < ARENA_HEIGHT; y += 48) {
      ctx.moveTo(0, y)
      ctx.lineTo(BAND, y)
      ctx.moveTo(ARENA_WIDTH - BAND, y + 24)
      ctx.lineTo(ARENA_WIDTH, y + 24)
    }
    ctx.stroke()
    ctx.globalAlpha = 0.35
    ctx.fillStyle = pal.stripeA
    ctx.fillRect(0, 0, ARENA_WIDTH, 6)
    ctx.fillRect(0, ARENA_HEIGHT - 6, ARENA_WIDTH, 6)
    ctx.fillRect(0, 0, 6, ARENA_HEIGHT)
    ctx.fillRect(ARENA_WIDTH - 6, 0, 6, ARENA_HEIGHT)
    ctx.globalAlpha = 1
  } else {
    // Hecke aus Blattbuckeln
    const R = rng(77)
    for (let x = 0; x < ARENA_WIDTH; x += 22) {
      ctx.globalAlpha = 0.65 + R() * 0.35
      blob(ctx, x + 11, 6 + R() * 8, 13, 11)
      blob(ctx, x + 11, ARENA_HEIGHT - 6 - R() * 8, 13, 11)
    }
    for (let y = 0; y < ARENA_HEIGHT; y += 22) {
      ctx.globalAlpha = 0.65 + R() * 0.35
      blob(ctx, 6 + R() * 8, y + 11, 11, 13)
      blob(ctx, ARENA_WIDTH - 6 - R() * 8, y + 11, 11, 13)
    }
    ctx.globalAlpha = 1
  }
  ctx.restore()
  ctx.strokeStyle = pal.ink
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.rect(BAND, BAND, ARENA_WIDTH - BAND * 2, ARENA_HEIGHT - BAND * 2)
  ctx.stroke()
}

// ------------------------------------------------------------------------------------
// Waende: Muster in der (geclippten) Deckflaeche + optionales Overlay nach der Outline
// ------------------------------------------------------------------------------------
/** Innerhalb des Clips der Deckflaeche; true = Standard-Neon-Muster ueberspringen. */
export function drawThemeWallPattern(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  theme: ThemedMap,
  kind: WallKind,
  o: ObstacleRect,
  c: WallColors,
): void {
  const square = o.w === o.h
  if (theme === 'winter') {
    ctx.globalAlpha = 0.5
    ctx.strokeStyle = c.hi
    ctx.lineWidth = 4
    ctx.beginPath()
    for (let d = 14; d < o.w + o.h; d += 36) {
      ctx.moveTo(o.x + d, o.y + o.h)
      ctx.lineTo(o.x + d - o.h * 0.6, o.y)
    }
    ctx.stroke()
    // Schneehaube mit welligem Rand
    const cap = Math.min(o.h * 0.5, 30)
    ctx.globalAlpha = 1
    ctx.fillStyle = pal.theme === 'dark' ? '#f2faff' : '#ffffff'
    ctx.beginPath()
    ctx.moveTo(o.x - 2, o.y - 2)
    ctx.lineTo(o.x + o.w + 2, o.y - 2)
    ctx.lineTo(o.x + o.w + 2, o.y + cap)
    const steps = Math.max(2, Math.round(o.w / 22))
    const sw = o.w / steps
    for (let i = steps; i > 0; i--) {
      const x1 = o.x + i * sw
      ctx.quadraticCurveTo(x1 - sw / 2, o.y + cap + (i % 2 ? 10 : 4), x1 - sw, o.y + cap)
    }
    ctx.closePath()
    ctx.fill()
    if (square && o.w >= 100) {
      // Iglu-Eingang
      ctx.fillStyle = pal.ink
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.arc(o.x + o.w / 2, o.y + o.h - 2, o.w * 0.2, Math.PI, 0)
      ctx.fill()
    }
  } else if (theme === 'desert') {
    if (square && o.w >= 150) {
      // Stufenpyramide
      for (let i = 0, inset = 0; inset < o.w / 2 - 12; i++, inset += 22) {
        ctx.globalAlpha = i % 2 === 0 ? 0.0 : 0.38
        ctx.fillStyle = c.hi
        ctx.fillRect(o.x + inset, o.y + inset, o.w - inset * 2, o.h - inset * 2)
        ctx.globalAlpha = 0.85
        ctx.strokeStyle = c.side
        ctx.lineWidth = 3
        ctx.strokeRect(o.x + inset, o.y + inset, o.w - inset * 2, o.h - inset * 2)
      }
    } else if (square && o.w <= 60) {
      // Saeule/Obelisk von oben: Trommel
      ctx.globalAlpha = 0.9
      ctx.strokeStyle = c.side
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(o.x + o.w / 2, o.y + o.h / 2, o.w * 0.32, 0, TAU)
      ctx.stroke()
      ctx.fillStyle = c.hi
      ctx.beginPath()
      ctx.arc(o.x + o.w / 2, o.y + o.h / 2, o.w * 0.12, 0, TAU)
      ctx.fill()
    } else {
      // Mauerwerk
      ctx.globalAlpha = 0.55
      ctx.strokeStyle = c.side
      ctx.lineWidth = 3
      ctx.beginPath()
      let row = 0
      for (let y = o.y + 14; y < o.y + o.h; y += 14, row++) {
        ctx.moveTo(o.x, y)
        ctx.lineTo(o.x + o.w, y)
        for (let x = o.x + (row % 2 ? 12 : 30); x < o.x + o.w; x += 36) {
          ctx.moveTo(x, y)
          ctx.lineTo(x, y - 14)
        }
      }
      ctx.stroke()
    }
  } else {
    // Dschungel: Moos auf Stein (Waende) / Blattmuster
    const R = rng(Math.round(o.x * 7 + o.y * 13))
    if (!square) {
      ctx.globalAlpha = 0.4
      ctx.strokeStyle = c.side
      ctx.lineWidth = 3
      ctx.beginPath()
      const vertical = o.h > o.w
      const len = vertical ? o.h : o.w
      for (let t = 18; t < len; t += 26) {
        if (vertical) {
          ctx.moveTo(o.x, o.y + t)
          ctx.lineTo(o.x + o.w, o.y + t)
        } else {
          ctx.moveTo(o.x + t, o.y)
          ctx.lineTo(o.x + t, o.y + o.h)
        }
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 0.85
    ctx.fillStyle = c.hi
    for (let i = 0; i < Math.max(4, (o.w + o.h) / 26); i++) {
      blob(ctx, o.x + R() * o.w, o.y + R() * o.h, 4 + R() * 6, 3 + R() * 4)
    }
  }
  ctx.globalAlpha = 1
  void kind
}

/** Nach der Outline (ausserhalb des Clips): Baumkronen im Dschungel. */
export function drawThemeWallOverlay(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  theme: ThemedMap,
  o: ObstacleRect,
  c: WallColors,
): void {
  if (theme !== 'jungle' || o.w !== o.h) return
  const cx = o.x + o.w / 2
  const cy = o.y + o.h / 2 - 6
  const r = o.w * 0.62
  ctx.lineWidth = 4
  ctx.strokeStyle = pal.ink
  const lobes: [number, number, number, string][] = [
    [-0.45, 0.1, 0.62, c.side],
    [0.45, 0.1, 0.62, c.side],
    [0, -0.4, 0.66, c.top],
    [0, 0.25, 0.7, c.top],
  ]
  for (const [dx, dy, k, col] of lobes) {
    ctx.fillStyle = col
    ctx.beginPath()
    ctx.arc(cx + dx * r, cy + dy * r, r * k, 0, TAU)
    ctx.fill()
    ctx.stroke()
  }
  // Glanzlichter
  ctx.fillStyle = c.hi
  ctx.globalAlpha = 0.7
  blob(ctx, cx - r * 0.2, cy - r * 0.5, r * 0.22, r * 0.14)
  blob(ctx, cx + r * 0.35, cy - r * 0.1, r * 0.14, r * 0.1)
  ctx.globalAlpha = 1
}

// ------------------------------------------------------------------------------------
// Animierte Umgebung (pro Frame, leicht; positionen sind reine Funktionen der Zeit)
// ------------------------------------------------------------------------------------
function wrap(v: number, max: number): number {
  return ((v % max) + max) % max
}

export function drawThemeAmbient(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  theme: ThemedMap,
  t: number,
): void {
  const dark = pal.theme === 'dark'
  if (theme === 'winter') {
    ctx.fillStyle = dark ? '#ffffff' : '#8fbde0'
    for (let i = 0; i < 110; i++) {
      const sp = 0.6 + (i % 5) * 0.18
      const x = wrap(i * 173.3 + t * (14 + (i % 4) * 5) + Math.sin(t * 0.8 + i) * 22, ARENA_WIDTH)
      const y = wrap(i * 97.1 + t * 46 * sp, ARENA_HEIGHT)
      const s = 2 + (i % 3)
      ctx.globalAlpha = 0.55 + (i % 4) * 0.12
      ctx.fillRect(x, y, s, s)
    }
    ctx.globalAlpha = 1
  } else if (theme === 'desert') {
    // Windboeen: lange, flache Sandstriche
    ctx.strokeStyle = dark ? 'rgba(255, 220, 160, 0.30)' : 'rgba(150, 90, 20, 0.25)'
    ctx.lineCap = 'round'
    for (let i = 0; i < 22; i++) {
      const sp = 340 + (i % 4) * 90
      const x = wrap(i * 311 + t * sp, ARENA_WIDTH + 500) - 250
      const y = wrap(i * 113.7, ARENA_HEIGHT) + Math.sin(t * 0.9 + i) * 14
      ctx.lineWidth = 2 + (i % 3)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + 70 + (i % 3) * 30, y + 6)
      ctx.stroke()
    }
    ctx.fillStyle = dark ? 'rgba(255, 220, 160, 0.45)' : 'rgba(150, 90, 20, 0.35)'
    for (let i = 0; i < 40; i++) {
      const x = wrap(i * 241 + t * (200 + (i % 5) * 40), ARENA_WIDTH)
      const y = wrap(i * 67.3 + Math.sin(t + i) * 30, ARENA_HEIGHT)
      ctx.fillRect(x, y, 3, 3)
    }
  } else {
    // Gluehwuermchen
    for (let i = 0; i < 26; i++) {
      const bx = wrap(i * 389.7, ARENA_WIDTH)
      const by = wrap(i * 211.3, ARENA_HEIGHT)
      const x = bx + Math.sin(t * 0.5 + i * 1.7) * 60
      const y = by + Math.cos(t * 0.43 + i * 2.3) * 40
      const on = 0.5 + 0.5 * Math.sin(t * 1.6 + i * 2.1)
      ctx.globalAlpha = (dark ? 0.16 : 0.1) * on
      ctx.fillStyle = dark ? '#d8ff6a' : '#fff59a'
      ctx.beginPath()
      ctx.arc(x, y, 14, 0, TAU)
      ctx.fill()
      ctx.globalAlpha = 0.35 + 0.65 * on
      ctx.fillStyle = dark ? '#eaff9a' : '#ffe14a'
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, TAU)
      ctx.fill()
    }
    // Fallende Blaetter
    ctx.fillStyle = dark ? '#5fd36e' : '#2f9a46'
    for (let i = 0; i < 12; i++) {
      const x = wrap(i * 263 + t * 18 + Math.sin(t * 0.9 + i) * 40, ARENA_WIDTH)
      const y = wrap(i * 151 + t * (26 + (i % 3) * 8), ARENA_HEIGHT)
      ctx.globalAlpha = 0.8
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(t * 1.2 + i)
      ctx.beginPath()
      ctx.ellipse(0, 0, 7, 3.5, 0, 0, TAU)
      ctx.fill()
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }
}
