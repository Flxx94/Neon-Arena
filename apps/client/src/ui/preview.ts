import { skinColor, skinModel } from '@neon-arena/shared'
import { drawModel } from '../game/models.js'
import { PALETTES, skinTone } from '../game/palette.js'
import { currentTheme } from './theme.js'

/**
 * Kleine animierte Figuren-Vorschau (Startscreen + HUD-Avatar): die Figur schaut dem Mauszeiger nach,
 * wippt, blinzelt. Laeuft nur, solange ihr Canvas sichtbar ist (IntersectionObserver spart CPU im Spiel).
 */
export class ModelPreview {
  private ctx: CanvasRenderingContext2D
  private skin = 0
  private t = Math.random() * 10
  private aim = 0.4
  private target = 0.4
  private raf = 0
  private visible = true
  private last = performance.now()
  private blink = 0
  private nextBlink = 2
  private bumpT = 1
  private moving = 0

  constructor(
    private canvas: HTMLCanvasElement,
    private zoom = 1,
  ) {
    this.ctx = canvas.getContext('2d')!
    new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting)
    }).observe(canvas)
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
  }

  setSkin(skin: number, bump = false): void {
    this.skin = skin
    if (bump) this.bumpT = 0
  }

  /** Blickrichtung zum Mauszeiger (Bildschirmkoordinaten). */
  lookAt(x: number, y: number): void {
    const r = this.canvas.getBoundingClientRect()
    this.target = Math.atan2(y - (r.top + r.height / 2), x - (r.left + r.width / 2))
  }

  /** Kurz "laufen" lassen (z. B. beim Wechseln). */
  hop(): void {
    this.bumpT = 0
  }

  private loop(): void {
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    if (!this.visible || document.hidden) return
    this.t += dt
    let d = this.target - this.aim
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    this.aim += d * Math.min(1, dt * 10)
    this.bumpT = Math.min(1, this.bumpT + dt * 3.2)
    this.moving = Math.max(0, 1 - this.bumpT * 1.6)
    this.nextBlink -= dt
    if (this.nextBlink <= 0) {
      this.blink = 1
      this.nextBlink = 2 + Math.random() * 3
    }
    this.blink = Math.max(0, this.blink - dt * 7)

    const { canvas, ctx } = this
    const s = canvas.width
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, s, s)
    const pal = PALETTES[currentTheme()]
    const tone = skinTone(skinColor(this.skin))
    const r = s * 0.27 * this.zoom
    // Schatten
    ctx.fillStyle = pal.shadow
    ctx.beginPath()
    ctx.ellipse(s / 2, s * 0.77, r * 0.95, r * 0.28, 0, 0, Math.PI * 2)
    ctx.fill()
    // Hopser beim Wechseln: Squash/Stretch
    const k = this.bumpT
    const jump = Math.sin(Math.min(1, k * 1.6) * Math.PI) * s * 0.07
    const sq = 1 + Math.sin(Math.min(1, k * 1.6) * Math.PI) * 0.12
    ctx.save()
    ctx.translate(s / 2, s * 0.5 - jump + Math.sin(this.t * 3.1) * s * 0.012)
    ctx.scale(1 / sq, sq)
    drawModel(ctx, skinModel(this.skin), {
      r,
      tone,
      ink: pal.ink,
      aim: this.aim,
      t: this.t,
      move: this.moving,
      recoil: 0,
      flash: 0,
      blink: this.blink,
    })
    ctx.restore()
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
  }
}
