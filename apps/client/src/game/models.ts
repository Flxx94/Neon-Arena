import { MODEL_COUNT } from '@neon-arena/shared'
import { shade, type SkinTone } from './palette.js'

/**
 * Prozedurale Player-Modelle (kein Asset-Ladevorgang, ~0 KB): 6 Figuren im selben Stil
 * (dicke Tinten-Outline, Cel-Shading, Glanzpunkt). Gezeichnet um den Ursprung in Einheiten von `r`;
 * Position/Skalierung/Squash setzt der Aufrufer per ctx.translate/scale.
 */
export interface ModelPose {
  /** Radius in aktuellen Zeicheneinheiten. */
  r: number
  tone: SkinTone
  ink: string
  /** Zielrichtung in rad (Welt, y nach unten). */
  aim: number
  /** Animationsuhr in Sekunden (pro Figur phasenverschoben). */
  t: number
  /** Bewegung 0..1 (Flamme, Wackeln, Schweif). */
  move: number
  /** Rueckstoss 0..1 nach einem Schuss. */
  recoil: number
  /** Treffer-Blitz 0..1 (weiss + Schmerz-Gesicht). */
  flash: number
  /** Lidschlag 0..1 (1 = zu). */
  blink: number
}

export const MODEL_LABELS = ['Blobby', 'Cuby', 'Zappy', 'Hexo', 'Boo', 'Kitty'] as const

const TAU = Math.PI * 2

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rad: number,
): void {
  const r = Math.min(rad, w / 2, h / 2)
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/** Cel-Shading: Schattenton als Basis, Lichtellipse darueber, Glanzpunkt, optional Treffer-Blitz, Outline. */
function celFill(
  ctx: CanvasRenderingContext2D,
  path: () => void,
  tone: SkinTone,
  p: ModelPose,
  lw = p.r * 0.17,
): void {
  const r = p.r
  ctx.beginPath()
  path()
  ctx.fillStyle = tone.dark
  ctx.fill()
  ctx.save()
  ctx.beginPath()
  path()
  ctx.clip()
  ctx.fillStyle = tone.base
  ctx.beginPath()
  ctx.ellipse(-r * 0.12, -r * 0.2, r * 1.2, r * 1.05, 0, 0, TAU)
  ctx.fill()
  ctx.globalAlpha = 0.6
  ctx.fillStyle = tone.light
  ctx.beginPath()
  ctx.ellipse(-r * 0.38, -r * 0.5, r * 0.3, r * 0.16, -0.55, 0, TAU)
  ctx.fill()
  ctx.globalAlpha = 1
  if (p.flash > 0.02) {
    ctx.globalAlpha = Math.min(0.9, p.flash)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-r * 2, -r * 2, r * 4, r * 4)
    ctx.globalAlpha = 1
  }
  ctx.restore()
  ctx.beginPath()
  path()
  ctx.lineWidth = lw
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = p.ink
  ctx.stroke()
}

/** Auge mit Blick in Zielrichtung, Blinzeln und Schmerz-Chevron (`hurt`: -1 links, 1 rechts, 0 normal). */
function eye(
  ctx: CanvasRenderingContext2D,
  p: ModelPose,
  x: number,
  y: number,
  rw: number,
  rh: number,
  side: -1 | 1,
  pupil = p.ink,
): void {
  const lw = p.r * 0.1
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = p.ink
  if (p.flash > 0.25) {
    // Schmerz-Gesicht: > <
    const s = rw * 0.85
    ctx.beginPath()
    ctx.moveTo(x - side * s, y - s)
    ctx.lineTo(x + side * s * 0.7, y)
    ctx.lineTo(x - side * s, y + s)
    ctx.lineWidth = lw * 1.3
    ctx.stroke()
    return
  }
  if (p.blink > 0.6) {
    ctx.beginPath()
    ctx.moveTo(x - rw, y)
    ctx.quadraticCurveTo(x, y + rh * 0.45, x + rw, y)
    ctx.lineWidth = lw * 1.2
    ctx.stroke()
    return
  }
  ctx.beginPath()
  ctx.ellipse(x, y, rw, rh * (1 - p.blink * 0.7), 0, 0, TAU)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.lineWidth = lw * 0.75
  ctx.stroke()
  const lx = Math.cos(p.aim)
  const ly = Math.sin(p.aim)
  const px = x + lx * rw * 0.42
  const py = y + ly * rh * 0.38
  ctx.beginPath()
  ctx.ellipse(px, py, rw * 0.52, rh * 0.6, 0, 0, TAU)
  ctx.fillStyle = pupil
  ctx.fill()
  ctx.beginPath()
  ctx.arc(px - rw * 0.16, py - rh * 0.22, rw * 0.17, 0, TAU)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
}

/** Blaster: sitzt vor dem Koerper, bei Blick nach oben dahinter (Tiefe). */
function blaster(ctx: CanvasRenderingContext2D, p: ModelPose, tone: SkinTone): void {
  const r = p.r
  const len = r * 0.95
  const thick = r * 0.46
  const x0 = r * 0.5 - p.recoil * r * 0.38
  ctx.save()
  ctx.rotate(p.aim)
  ctx.lineJoin = 'round'
  ctx.beginPath()
  roundRectPath(ctx, x0, -thick / 2, len, thick, thick * 0.4)
  ctx.fillStyle = '#eef1ff'
  ctx.fill()
  ctx.lineWidth = r * 0.14
  ctx.strokeStyle = p.ink
  ctx.stroke()
  ctx.beginPath()
  roundRectPath(ctx, x0 + len * 0.18, -thick * 0.2, len * 0.45, thick * 0.4, thick * 0.2)
  ctx.fillStyle = tone.base
  ctx.fill()
  ctx.beginPath()
  roundRectPath(ctx, x0 + len - r * 0.16, -thick * 0.5, r * 0.2, thick, r * 0.07)
  ctx.fillStyle = p.ink
  ctx.fill()
  if (p.recoil > 0.35) {
    ctx.beginPath()
    ctx.arc(x0 + len + r * 0.2, 0, r * 0.26 * p.recoil, 0, TAU)
    ctx.fillStyle = '#fff6b0'
    ctx.fill()
  }
  ctx.restore()
}

const gunInFront = (p: ModelPose): boolean => Math.sin(p.aim) >= -0.25

// ---------------------------------------------------------------------------
// 0 — Blobby: wackelnder Schleim mit grossen Augen
// ---------------------------------------------------------------------------
function drawBlobby(ctx: CanvasRenderingContext2D, p: ModelPose): void {
  const r = p.r
  const n = 18
  const pts: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU
    const wob =
      1 + 0.05 * Math.sin(p.t * 5 + i * 1.9) + p.move * 0.035 * Math.sin(p.t * 15 + i * 2.3)
    pts.push([Math.cos(a) * r * wob, Math.sin(a) * r * wob * 0.94 + r * 0.04])
  }
  const path = () => {
    const mid = (a: [number, number], b: [number, number]): [number, number] => [
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
    ]
    const first = mid(pts[n - 1]!, pts[0]!)
    ctx.moveTo(first[0], first[1])
    for (let i = 0; i < n; i++) {
      const c = pts[i]!
      const m = mid(c, pts[(i + 1) % n]!)
      ctx.quadraticCurveTo(c[0], c[1], m[0], m[1])
    }
    ctx.closePath()
  }
  if (!gunInFront(p)) blaster(ctx, p, p.tone)
  celFill(ctx, path, p.tone, p)
  eye(ctx, p, -r * 0.34, -r * 0.12, r * 0.25, r * 0.31, -1)
  eye(ctx, p, r * 0.34, -r * 0.12, r * 0.25, r * 0.31, 1)
  // Mund
  ctx.strokeStyle = p.ink
  ctx.lineWidth = r * 0.1
  ctx.lineCap = 'round'
  ctx.beginPath()
  if (p.flash > 0.25) ctx.ellipse(0, r * 0.38, r * 0.1, r * 0.13, 0, 0, TAU)
  else ctx.arc(0, r * 0.22, r * 0.2, 0.2, Math.PI - 0.2)
  ctx.stroke()
  // Bäckchen
  ctx.globalAlpha = 0.45
  ctx.fillStyle = '#ff7aa8'
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.ellipse(s * r * 0.62, r * 0.2, r * 0.13, r * 0.08, 0, 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  if (gunInFront(p)) blaster(ctx, p, p.tone)
}

// ---------------------------------------------------------------------------
// 1 — Cuby: Roboter-Wuerfel mit Visier und Antenne
// ---------------------------------------------------------------------------
function drawCuby(ctx: CanvasRenderingContext2D, p: ModelPose): void {
  const r = p.r
  const half = r * 0.92
  // Antenne (hinter dem Koerper)
  const wig = Math.sin(p.t * 6) * r * 0.1 * (0.4 + p.move)
  ctx.strokeStyle = p.ink
  ctx.lineWidth = r * 0.12
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, -half * 0.9)
  ctx.quadraticCurveTo(wig * 0.5, -r * 1.2, wig, -r * 1.45)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(wig, -r * 1.5, r * 0.17, 0, TAU)
  ctx.fillStyle = p.tone.light
  ctx.fill()
  ctx.lineWidth = r * 0.1
  ctx.stroke()
  // Fuesse
  ctx.fillStyle = p.ink
  for (const s of [-1, 1]) {
    ctx.beginPath()
    roundRectPath(ctx, s * r * 0.45 - r * 0.2, half * 0.8, r * 0.4, r * 0.28, r * 0.1)
    ctx.fill()
  }
  if (!gunInFront(p)) blaster(ctx, p, p.tone)
  const path = () => roundRectPath(ctx, -half, -half, half * 2, half * 2, r * 0.42)
  celFill(ctx, path, p.tone, p)
  // Visier
  ctx.beginPath()
  roundRectPath(ctx, -r * 0.66, -r * 0.42, r * 1.32, r * 0.62, r * 0.28)
  ctx.fillStyle = '#17123a'
  ctx.fill()
  ctx.lineWidth = r * 0.09
  ctx.strokeStyle = p.ink
  ctx.stroke()
  // LED-Augen (folgen dem Ziel)
  const lx = Math.cos(p.aim) * r * 0.1
  const ly = Math.sin(p.aim) * r * 0.06
  ctx.fillStyle = p.flash > 0.25 ? '#ff4b5c' : p.tone.light
  if (p.blink > 0.6) {
    for (const s of [-1, 1]) {
      ctx.fillRect(s * r * 0.3 - r * 0.15 + lx, -r * 0.13 + ly, r * 0.3, r * 0.06)
    }
  } else {
    for (const s of [-1, 1]) {
      ctx.beginPath()
      ctx.ellipse(s * r * 0.3 + lx, -r * 0.1 + ly, r * 0.13, r * 0.15, 0, 0, TAU)
      ctx.fill()
    }
  }
  // Brust-LEDs
  const blinkOn = Math.floor(p.t * 3) % 3
  for (let i = 0; i < 3; i++) {
    ctx.beginPath()
    ctx.arc((i - 1) * r * 0.32, r * 0.52, r * 0.075, 0, TAU)
    ctx.fillStyle = i === blinkOn ? '#ffffff' : p.tone.dark
    ctx.fill()
  }
  if (gunInFront(p)) blaster(ctx, p, p.tone)
}

// ---------------------------------------------------------------------------
// 2 — Zappy: Pfeil-Schiff, dreht sich komplett mit dem Ziel
// ---------------------------------------------------------------------------
function drawZappy(ctx: CanvasRenderingContext2D, p: ModelPose): void {
  const r = p.r
  ctx.save()
  ctx.rotate(p.aim)
  ctx.translate(-p.recoil * r * 0.3, 0)
  // Triebwerksflamme
  const flame = r * (0.45 + p.move * 0.7 + 0.12 * Math.sin(p.t * 38))
  ctx.beginPath()
  ctx.moveTo(-r * 0.7, -r * 0.3)
  ctx.lineTo(-r * 0.7 - flame, 0)
  ctx.lineTo(-r * 0.7, r * 0.3)
  ctx.closePath()
  ctx.fillStyle = '#ffb02e'
  ctx.fill()
  ctx.lineWidth = r * 0.1
  ctx.lineJoin = 'round'
  ctx.strokeStyle = p.ink
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-r * 0.7, -r * 0.14)
  ctx.lineTo(-r * 0.7 - flame * 0.55, 0)
  ctx.lineTo(-r * 0.7, r * 0.14)
  ctx.closePath()
  ctx.fillStyle = '#fff3a0'
  ctx.fill()
  const path = () => {
    ctx.moveTo(r * 1.28, 0)
    ctx.lineTo(r * 0.15, r * 0.55)
    ctx.lineTo(-r * 0.9, r * 1.08)
    ctx.lineTo(-r * 0.62, r * 0.36)
    ctx.lineTo(-r * 0.82, 0)
    ctx.lineTo(-r * 0.62, -r * 0.36)
    ctx.lineTo(-r * 0.9, -r * 1.08)
    ctx.lineTo(r * 0.15, -r * 0.55)
    ctx.closePath()
  }
  celFill(ctx, path, p.tone, p)
  // Fluegel-Streifen
  ctx.strokeStyle = p.tone.dark
  ctx.lineWidth = r * 0.1
  ctx.lineCap = 'round'
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(-r * 0.15, s * r * 0.5)
    ctx.lineTo(-r * 0.62, s * r * 0.86)
    ctx.stroke()
  }
  // Kanzel
  ctx.beginPath()
  ctx.ellipse(r * 0.18, 0, r * 0.46, r * 0.3, 0, 0, TAU)
  ctx.fillStyle = p.flash > 0.25 ? '#ffd0d6' : '#bfeaff'
  ctx.fill()
  ctx.lineWidth = r * 0.1
  ctx.strokeStyle = p.ink
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(r * 0.05, -r * 0.1, r * 0.17, r * 0.08, -0.3, 0, TAU)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fill()
  // Pilot-Auge
  ctx.beginPath()
  ctx.arc(r * 0.3, 0, r * 0.1, 0, TAU)
  ctx.fillStyle = p.ink
  ctx.fill()
  // Zwillings-Muendungen
  ctx.fillStyle = p.ink
  for (const s of [-1, 1]) {
    ctx.beginPath()
    roundRectPath(ctx, r * 0.78, s * r * 0.17 - r * 0.07, r * 0.5, r * 0.14, r * 0.05)
    ctx.fill()
  }
  if (p.recoil > 0.3) {
    ctx.beginPath()
    ctx.arc(r * 1.4, 0, r * 0.28 * p.recoil, 0, TAU)
    ctx.fillStyle = '#fff6b0'
    ctx.fill()
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// 3 — Hexo: Hexagon-Drohne mit Zyklopen-Auge und rotierendem Ring
// ---------------------------------------------------------------------------
function drawHexo(ctx: CanvasRenderingContext2D, p: ModelPose): void {
  const r = p.r
  // Ring (hinter dem Koerper)
  ctx.save()
  ctx.rotate(-p.t * 0.9)
  ctx.setLineDash([r * 0.5, r * 0.34])
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(0, 0, r * 1.28, 0, TAU)
  ctx.strokeStyle = p.ink
  ctx.lineWidth = r * 0.3
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 0, r * 1.28, 0, TAU)
  ctx.strokeStyle = p.tone.light
  ctx.lineWidth = r * 0.14
  ctx.stroke()
  ctx.restore()
  ctx.setLineDash([])
  if (!gunInFront(p)) blaster(ctx, p, p.tone)
  ctx.save()
  ctx.rotate(p.t * 0.35)
  const path = () => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU
      const x = Math.cos(a) * r * 1.02
      const y = Math.sin(a) * r * 1.02
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  }
  celFill(ctx, path, p.tone, p)
  // Nieten
  ctx.fillStyle = p.tone.dark
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU
    ctx.beginPath()
    ctx.arc(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78, r * 0.07, 0, TAU)
    ctx.fill()
  }
  ctx.restore()
  // Einzelauge
  const sy = 1 - p.blink * 0.85
  ctx.save()
  ctx.scale(1, sy)
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.5, 0, TAU)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.lineWidth = r * 0.1
  ctx.strokeStyle = p.ink
  ctx.stroke()
  const ix = Math.cos(p.aim) * r * 0.2
  const iy = Math.sin(p.aim) * r * 0.2
  ctx.beginPath()
  ctx.arc(ix, iy, r * 0.27, 0, TAU)
  ctx.fillStyle = p.flash > 0.25 ? '#ff4b5c' : p.tone.dark
  ctx.fill()
  ctx.beginPath()
  ctx.arc(ix, iy, r * 0.13, 0, TAU)
  ctx.fillStyle = p.ink
  ctx.fill()
  ctx.beginPath()
  ctx.arc(ix - r * 0.1, iy - r * 0.1, r * 0.06, 0, TAU)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()
  if (gunInFront(p)) blaster(ctx, p, p.tone)
}

// ---------------------------------------------------------------------------
// 4 — Boo: schwebender Geist mit wehendem Saum
// ---------------------------------------------------------------------------
function drawBoo(ctx: CanvasRenderingContext2D, p: ModelPose): void {
  const r = p.r
  const ghost: SkinTone = { base: shade(p.tone.base, 0.5), dark: p.tone.base, light: '#ffffff' }
  const hem = r * 0.82
  const path = () => {
    ctx.arc(0, -r * 0.05, r, Math.PI, 0)
    ctx.lineTo(r, hem)
    const bumps = 4
    const w = (r * 2) / bumps
    for (let k = 0; k < bumps; k++) {
      const x1 = r - (k + 0.5) * w
      const x2 = r - (k + 1) * w
      const dip = (k % 2 === 0 ? 1 : -1) * r * 0.3 * (1 + 0.3 * Math.sin(p.t * 6 + k * 1.3))
      ctx.quadraticCurveTo(x1, hem + dip, x2, hem)
    }
    ctx.closePath()
  }
  if (!gunInFront(p)) blaster(ctx, p, ghost)
  celFill(ctx, path, ghost, p)
  // Augen: Ovale mit Glanz, folgen dem Ziel
  const lx = Math.cos(p.aim) * r * 0.07
  const ly = Math.sin(p.aim) * r * 0.06
  for (const s of [-1, 1] as const) {
    if (p.flash > 0.25) {
      eye(ctx, p, s * r * 0.34, -r * 0.1, r * 0.22, r * 0.26, s)
      continue
    }
    if (p.blink > 0.6) {
      eye(ctx, p, s * r * 0.34, -r * 0.1, r * 0.2, r * 0.26, s)
      continue
    }
    ctx.beginPath()
    ctx.ellipse(s * r * 0.34 + lx, -r * 0.12 + ly, r * 0.15, r * 0.26, 0, 0, TAU)
    ctx.fillStyle = p.ink
    ctx.fill()
    ctx.beginPath()
    ctx.arc(s * r * 0.34 + lx - r * 0.04, -r * 0.2 + ly, r * 0.05, 0, TAU)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  }
  // "Oh"-Mund + Bäckchen
  ctx.beginPath()
  ctx.ellipse(0, r * 0.24, r * 0.1, r * (p.flash > 0.25 ? 0.2 : 0.13), 0, 0, TAU)
  ctx.fillStyle = p.ink
  ctx.fill()
  ctx.globalAlpha = 0.5
  ctx.fillStyle = '#ff7aa8'
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.ellipse(s * r * 0.62, r * 0.14, r * 0.13, r * 0.08, 0, 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  if (gunInFront(p)) blaster(ctx, p, ghost)
}

// ---------------------------------------------------------------------------
// 5 — Kitty: Katzen-Bot mit Ohren, Schnurrhaaren und Schweif
// ---------------------------------------------------------------------------
function drawKitty(ctx: CanvasRenderingContext2D, p: ModelPose): void {
  const r = p.r
  // Schweif (entgegen der Blickrichtung, wedelt)
  const back = p.aim + Math.PI
  const wag = Math.sin(p.t * (4 + p.move * 8)) * 0.55
  const bx = Math.cos(back) * r * 0.85
  const by = Math.sin(back) * r * 0.85
  const tx = Math.cos(back + wag) * r * 1.75
  const ty = Math.sin(back + wag) * r * 1.75
  const cx = Math.cos(back + wag * 0.4 + 0.6) * r * 1.4
  const cy = Math.sin(back + wag * 0.4 + 0.6) * r * 1.4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(bx, by)
  ctx.quadraticCurveTo(cx, cy, tx, ty)
  ctx.strokeStyle = p.ink
  ctx.lineWidth = r * 0.46
  ctx.stroke()
  ctx.strokeStyle = p.tone.base
  ctx.lineWidth = r * 0.26
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(tx, ty, r * 0.13, 0, TAU)
  ctx.fillStyle = p.tone.light
  ctx.fill()
  if (!gunInFront(p)) blaster(ctx, p, p.tone)
  // Ohren
  for (const s of [-1, 1] as const) {
    const earPath = () => {
      ctx.moveTo(s * r * 0.95, -r * 0.1)
      ctx.lineTo(s * r * 0.78, -r * 1.1)
      ctx.lineTo(s * r * 0.15, -r * 0.7)
      ctx.closePath()
    }
    celFill(ctx, earPath, p.tone, p, r * 0.15)
    ctx.beginPath()
    ctx.moveTo(s * r * 0.8, -r * 0.3)
    ctx.lineTo(s * r * 0.72, -r * 0.82)
    ctx.lineTo(s * r * 0.34, -r * 0.62)
    ctx.closePath()
    ctx.fillStyle = '#ff9fc0'
    ctx.fill()
  }
  // Kopf
  const head = () => {
    ctx.ellipse(0, r * 0.02, r * 1.08, r * 0.93, 0, 0, TAU)
  }
  celFill(ctx, head, p.tone, p)
  for (const s of [-1, 1] as const) {
    // Katzenaugen mit Schlitz-Pupille
    const ex = s * r * 0.4
    const ey = -r * 0.06
    if (p.flash > 0.25 || p.blink > 0.6) {
      eye(ctx, p, ex, ey, r * 0.2, r * 0.26, s)
    } else {
      ctx.beginPath()
      ctx.ellipse(ex, ey, r * 0.2, r * 0.27, 0, 0, TAU)
      ctx.fillStyle = '#f4ff9a'
      ctx.fill()
      ctx.lineWidth = r * 0.08
      ctx.strokeStyle = p.ink
      ctx.stroke()
      const px = ex + Math.cos(p.aim) * r * 0.06
      const py = ey + Math.sin(p.aim) * r * 0.07
      ctx.beginPath()
      ctx.ellipse(px, py, r * 0.065, r * 0.2, 0, 0, TAU)
      ctx.fillStyle = p.ink
      ctx.fill()
    }
  }
  // Nase + Mund
  ctx.beginPath()
  ctx.moveTo(-r * 0.09, r * 0.2)
  ctx.lineTo(r * 0.09, r * 0.2)
  ctx.lineTo(0, r * 0.3)
  ctx.closePath()
  ctx.fillStyle = '#ff7aa8'
  ctx.fill()
  ctx.strokeStyle = p.ink
  ctx.lineWidth = r * 0.07
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, r * 0.3)
  ctx.quadraticCurveTo(-r * 0.05, r * 0.46, -r * 0.2, r * 0.4)
  ctx.moveTo(0, r * 0.3)
  ctx.quadraticCurveTo(r * 0.05, r * 0.46, r * 0.2, r * 0.4)
  ctx.stroke()
  // Schnurrhaare
  ctx.lineWidth = r * 0.05
  for (const s of [-1, 1]) {
    for (const k of [-1, 0, 1]) {
      ctx.beginPath()
      ctx.moveTo(s * r * 0.62, r * 0.3 + k * r * 0.07)
      ctx.lineTo(s * r * 1.22, r * 0.3 + k * r * 0.2)
      ctx.stroke()
    }
  }
  if (gunInFront(p)) blaster(ctx, p, p.tone)
}

const DRAWERS = [drawBlobby, drawCuby, drawZappy, drawHexo, drawBoo, drawKitty] as const

/** Zeichnet Modell `model` (0..MODEL_COUNT-1) um den aktuellen Ursprung. */
export function drawModel(ctx: CanvasRenderingContext2D, model: number, pose: ModelPose): void {
  const i = ((Math.trunc(model) % MODEL_COUNT) + MODEL_COUNT) % MODEL_COUNT
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  DRAWERS[i]!(ctx, pose)
  ctx.restore()
}
