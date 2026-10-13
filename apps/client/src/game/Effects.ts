import { FONT, type Palette } from './palette.js'

/**
 * Leichtgewichtiges Effektsystem (Weltkoordinaten): Funken, Splitter, Rauch, Konfetti,
 * Schockwellen-Ringe, schwebende Zahlen und Screenshake. Alles ohne shadowBlur (60 fps, M2-06);
 * Glow entsteht ueber additive Ueberlagerung (nur im dunklen Theme sichtbar/sinnvoll).
 */
type Kind = 'dot' | 'streak' | 'shard' | 'smoke' | 'flash' | 'confetti'

interface Particle {
  kind: Kind
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
  drag: number
  rot: number
  vr: number
}

interface Ring {
  x: number
  y: number
  life: number
  max: number
  r0: number
  r1: number
  color: string
  width: number
}

interface FloatText {
  x: number
  y: number
  life: number
  max: number
  text: string
  color: string
  size: number
}

const MAX_PARTICLES = 700

export class Effects {
  private particles: Particle[] = []
  private rings: Ring[] = []
  private texts: FloatText[] = []
  private trauma = 0
  /** Spieler-Einstellungen (Settings-Dialog). */
  quality: 'low' | 'high' = 'high'
  shakeEnabled = true

  private amount(n: number): number {
    return this.quality === 'low' ? Math.max(1, Math.round(n * 0.45)) : n
  }

  private add(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift()
    this.particles.push(p)
  }

  private rand(min: number, max: number): number {
    return min + Math.random() * (max - min)
  }

  /** Mündungsfeuer: Blitz + kurze Funken in Schussrichtung. */
  muzzle(x: number, y: number, angle: number, color: string): void {
    const tx = x + Math.cos(angle) * 8
    const ty = y + Math.sin(angle) * 8
    this.add({
      kind: 'flash',
      x: tx,
      y: ty,
      vx: 0,
      vy: 0,
      life: 0.07,
      max: 0.07,
      size: 13,
      color,
      drag: 0,
      rot: angle,
      vr: 0,
    })
    for (let i = 0; i < this.amount(5); i++) {
      const a = angle + this.rand(-0.45, 0.45)
      const sp = this.rand(120, 300)
      this.add({
        kind: 'streak',
        x: tx,
        y: ty,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: this.rand(0.1, 0.22),
        max: 0.22,
        size: this.rand(1.6, 2.6),
        color,
        drag: 5,
        rot: 0,
        vr: 0,
      })
    }
  }

  /** Projektil-Einschlag in Wand/Luft. */
  impact(x: number, y: number, color: string): void {
    for (let i = 0; i < this.amount(7); i++) {
      const a = Math.random() * Math.PI * 2
      const sp = this.rand(60, 230)
      this.add({
        kind: 'dot',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: this.rand(0.18, 0.4),
        max: 0.4,
        size: this.rand(1.5, 3.2),
        color,
        drag: 4,
        rot: 0,
        vr: 0,
      })
    }
    this.rings.push({ x, y, life: 0.22, max: 0.22, r0: 3, r1: 15, color, width: 2 })
  }

  /** Treffer auf einen Spieler (Funken in Spielerfarbe + weisse Spritzer). */
  hit(x: number, y: number, color: string): void {
    for (let i = 0; i < this.amount(11); i++) {
      const a = Math.random() * Math.PI * 2
      const sp = this.rand(90, 340)
      this.add({
        kind: i % 3 === 0 ? 'shard' : 'dot',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: this.rand(0.25, 0.5),
        max: 0.5,
        size: this.rand(2, 4.4),
        color: i % 4 === 0 ? '#ffffff' : color,
        drag: 3.5,
        rot: Math.random() * 6,
        vr: this.rand(-12, 12),
      })
    }
    this.rings.push({ x, y, life: 0.28, max: 0.28, r0: 6, r1: 30, color, width: 3 })
  }

  /** Abschuss: Splitterexplosion, Rauch, grosser Schockwellen-Ring. */
  explode(x: number, y: number, color: string): void {
    for (let i = 0; i < this.amount(34); i++) {
      const a = Math.random() * Math.PI * 2
      const sp = this.rand(60, 460)
      this.add({
        kind: i % 2 === 0 ? 'shard' : 'dot',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: this.rand(0.45, 1.0),
        max: 1.0,
        size: this.rand(2.5, 6.5),
        color: i % 5 === 0 ? '#ffffff' : color,
        drag: 2.6,
        rot: Math.random() * 6,
        vr: this.rand(-14, 14),
      })
    }
    for (let i = 0; i < this.amount(7); i++) {
      this.add({
        kind: 'smoke',
        x: x + this.rand(-8, 8),
        y: y + this.rand(-8, 8),
        vx: this.rand(-40, 40),
        vy: this.rand(-60, 10),
        life: this.rand(0.5, 0.9),
        max: 0.9,
        size: this.rand(8, 15),
        color,
        drag: 1.8,
        rot: 0,
        vr: 0,
      })
    }
    this.rings.push({ x, y, life: 0.5, max: 0.5, r0: 8, r1: 78, color, width: 5 })
    this.rings.push({ x, y, life: 0.32, max: 0.32, r0: 4, r1: 46, color: '#ffffff', width: 2.5 })
  }

  /** Pickup eingesammelt: aufsteigende Funken + Ring. */
  pickup(x: number, y: number, color: string): void {
    for (let i = 0; i < this.amount(16); i++) {
      const a = -Math.PI / 2 + this.rand(-1.2, 1.2)
      const sp = this.rand(70, 260)
      this.add({
        kind: 'dot',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: this.rand(0.4, 0.8),
        max: 0.8,
        size: this.rand(2, 4),
        color: i % 3 === 0 ? '#ffffff' : color,
        drag: 3,
        rot: 0,
        vr: 0,
      })
    }
    this.rings.push({ x, y, life: 0.42, max: 0.42, r0: 8, r1: 44, color, width: 4 })
  }

  /** Einspawnen: zwei sich weitende Ringe + Glitzer. */
  spawn(x: number, y: number, color: string): void {
    this.rings.push({ x, y, life: 0.55, max: 0.55, r0: 40, r1: 6, color, width: 4 })
    this.rings.push({ x, y, life: 0.7, max: 0.7, r0: 60, r1: 10, color: '#ffffff', width: 2 })
    for (let i = 0; i < this.amount(10); i++) {
      const a = (i / 10) * Math.PI * 2
      this.add({
        kind: 'dot',
        x: x + Math.cos(a) * 40,
        y: y + Math.sin(a) * 40,
        vx: -Math.cos(a) * 90,
        vy: -Math.sin(a) * 90,
        life: 0.5,
        max: 0.5,
        size: 2.6,
        color,
        drag: 1,
        rot: 0,
        vr: 0,
      })
    }
  }

  /** Konfetti-Regen (Rundensieg). */
  confetti(x: number, y: number, count = 70): void {
    const colors = ['#ff5fa2', '#26d0ff', '#8dea2f', '#ffcf2e', '#9a6bff', '#ff8a2b']
    for (let i = 0; i < this.amount(count); i++) {
      const a = -Math.PI / 2 + this.rand(-1.1, 1.1)
      const sp = this.rand(160, 620)
      this.add({
        kind: 'confetti',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: this.rand(1.4, 2.6),
        max: 2.6,
        size: this.rand(4, 8),
        color: colors[i % colors.length]!,
        drag: 1.4,
        rot: Math.random() * 6,
        vr: this.rand(-9, 9),
      })
    }
  }

  /** Schwebende Zahl/Text (Schaden, +100, Pickup). */
  text(x: number, y: number, text: string, color: string, size = 17): void {
    this.texts.push({ x, y, life: 0.95, max: 0.95, text, color, size })
    if (this.texts.length > 40) this.texts.shift()
  }

  /** Kamerawackeln (additiv, abklingend). `amount` in Weltpixeln ~ 2..14. */
  shake(amount: number): void {
    if (!this.shakeEnabled) return
    this.trauma = Math.min(18, this.trauma + amount)
  }

  /** Aktueller Shake-Versatz in Weltpixeln. */
  shakeOffset(): { x: number; y: number } {
    if (this.trauma < 0.15) return { x: 0, y: 0 }
    return {
      x: (Math.random() - 0.5) * 2 * this.trauma,
      y: (Math.random() - 0.5) * 2 * this.trauma,
    }
  }

  update(dt: number): void {
    this.trauma *= Math.exp(-dt * 9)
    const gravity = 520
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!
      p.life -= dt
      if (p.life <= 0) {
        this.particles.splice(i, 1)
        continue
      }
      const k = Math.exp(-p.drag * dt)
      p.vx *= k
      p.vy *= k
      if (p.kind === 'confetti') p.vy += gravity * 0.5 * dt
      if (p.kind === 'smoke') p.vy -= 18 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.vr * dt
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!
      r.life -= dt
      if (r.life <= 0) this.rings.splice(i, 1)
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]!
      t.life -= dt
      t.y -= 34 * dt
      if (t.life <= 0) this.texts.splice(i, 1)
    }
  }

  get count(): number {
    return this.particles.length + this.rings.length + this.texts.length
  }

  /** Partikel + Ringe (unter den Namensschildern). */
  draw(ctx: CanvasRenderingContext2D, pal: Palette): void {
    const additive = pal.additive
    for (const r of this.rings) {
      const k = 1 - r.life / r.max
      const e = 1 - (1 - k) * (1 - k)
      ctx.globalAlpha = Math.max(0, (1 - k) * 0.9)
      ctx.beginPath()
      ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, 0, Math.PI * 2)
      ctx.strokeStyle = r.color
      ctx.lineWidth = Math.max(0.5, r.width * (1 - k * 0.7))
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    for (const p of this.particles) {
      const k = Math.max(0, p.life / p.max)
      switch (p.kind) {
        case 'smoke': {
          ctx.globalAlpha = k * 0.35
          ctx.fillStyle = pal.theme === 'dark' ? '#cfc6ff' : '#5a4a7a'
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size * (1.6 - k * 0.7), 0, Math.PI * 2)
          ctx.fill()
          break
        }
        case 'flash': {
          ctx.globalAlpha = k
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.rotate(p.rot)
          ctx.fillStyle = '#fffbe0'
          ctx.beginPath()
          const s = p.size * (0.6 + (1 - k) * 0.6)
          ctx.moveTo(s, 0)
          ctx.lineTo(0, s * 0.32)
          ctx.lineTo(-s * 0.35, 0)
          ctx.lineTo(0, -s * 0.32)
          ctx.closePath()
          ctx.fill()
          ctx.fillStyle = p.color
          ctx.beginPath()
          ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
          break
        }
        case 'streak': {
          ctx.globalAlpha = k
          ctx.strokeStyle = p.color
          ctx.lineWidth = p.size
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04)
          ctx.stroke()
          break
        }
        case 'shard':
        case 'confetti': {
          ctx.globalAlpha = p.kind === 'confetti' ? Math.min(1, k * 2) : k
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.rotate(p.rot)
          ctx.fillStyle = p.color
          const s = p.size * (p.kind === 'confetti' ? 1 : 0.6 + k * 0.4)
          if (p.kind === 'confetti') {
            ctx.scale(1, Math.abs(Math.cos(p.rot * 1.7)) * 0.9 + 0.1)
            ctx.fillRect(-s / 2, -s / 3, s, (s * 2) / 3)
          } else {
            ctx.beginPath()
            ctx.moveTo(s, 0)
            ctx.lineTo(-s * 0.6, s * 0.7)
            ctx.lineTo(-s * 0.6, -s * 0.7)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = pal.ink
            ctx.lineWidth = 1
            ctx.stroke()
          }
          ctx.restore()
          break
        }
        default: {
          // 'dot': additiv im dunklen Theme = Leuchtfunke
          if (additive) ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = k
          ctx.fillStyle = p.color
          ctx.beginPath()
          ctx.arc(p.x, p.y, Math.max(0.4, p.size * (0.4 + k * 0.6)), 0, Math.PI * 2)
          ctx.fill()
          ctx.globalCompositeOperation = 'source-over'
        }
      }
    }
    ctx.globalAlpha = 1
  }

  /** Schwebende Texte (ueber allem). */
  drawTexts(ctx: CanvasRenderingContext2D, pal: Palette): void {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    for (const t of this.texts) {
      const k = t.life / t.max
      const pop = k > 0.82 ? 1 + (k - 0.82) * 4 : 1
      ctx.globalAlpha = Math.min(1, k * 2.2)
      ctx.font = `800 ${t.size * pop}px ${FONT}`
      ctx.lineWidth = 4.5
      ctx.strokeStyle = pal.ink
      ctx.strokeText(t.text, t.x, t.y)
      ctx.fillStyle = t.color
      ctx.fillText(t.text, t.x, t.y)
    }
    ctx.globalAlpha = 1
  }
}
