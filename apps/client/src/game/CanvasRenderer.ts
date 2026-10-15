import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  PICKUP_RADIUS,
  CLASSES,
  PLAYER_RADIUS,
  PROJECTILE_RADIUS,
  classOf,
  skinColor,
  skinModel,
} from '@neon-arena/shared'
import { Effects } from './Effects.js'
import {
  drawAmbient,
  buildBackdropLayer,
  buildWorldLayer,
  WORLD_PAD,
  type View,
} from './map.js'
import { drawModel } from './models.js'
import { FONT, PALETTES, alpha, skinTone, type Palette } from './palette.js'
import type { RenderHooks, RenderPlayer, RenderState, Renderer } from './Renderer.js'
import { currentTheme, onThemeChange } from '../ui/theme.js'

const TAU = Math.PI * 2
const MODEL_SCALE = 1.3

interface Anim {
  /** Geglaettete Zielrichtung. */
  aim: number
  px: number
  py: number
  /** 0..1 Bewegungsstaerke (geglaettet). */
  move: number
  /** Geschwindigkeit in Welt-px/s (fuer Squash/Stretch, Richtung). */
  vx: number
  vy: number
  flash: number
  recoil: number
  blink: number
  nextBlink: number
  /** Sekunden seit (Re-)Spawn, fuer Pop-in. */
  age: number
  phase: number
  hp: number
  shield: number
  alive: boolean
  seen: boolean
  hpTrail: number
}

interface ProjTrack {
  x: number
  y: number
  trail: { x: number; y: number }[]
  color: string
  seen: boolean
  shooterId: string | null
  kind: number
}

interface PickupTrack {
  x: number
  y: number
  kind: string
  age: number
  seen: boolean
}

function angleLerp(from: number, to: number, k: number): number {
  let d = to - from
  while (d > Math.PI) d -= TAU
  while (d < -Math.PI) d += TAU
  return from + d * k
}

/** Plain-Canvas-Renderer (ADR-001) im "Toy Arcade"-Look: Tinten-Outlines, Cel-Shading, 2.5D-Waende. */
/**
 * Zeitstempel des aktuellen Animationsframes (vsync-ausgerichtet, ohne Scheduling-Jitter von
 * performance.now() im rAF-Callback) -> gleichmaessigere Schrittweiten/Kamera.
 */
export function frameTime(): number {
  const t = document.timeline?.currentTime
  return typeof t === 'number' ? t : performance.now()
}

export class CanvasRenderer implements Renderer {
  readonly fx = new Effects()
  hooks: RenderHooks = {}

  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private view: View = { w: 1, h: 1, dpr: 1, scale: 1, ox: 0, oy: 0 }
  private backdrop: HTMLCanvasElement | null = null
  private world: HTMLCanvasElement | null = null
  private layerKey = ''
  /** Kamera (Weltkoordinaten der Bildschirmmitte), folgt dem eigenen Spieler weich. */
  private camX = ARENA_WIDTH / 2
  private camY = ARENA_HEIGHT / 2
  private camInit = false
  private pal: Palette = PALETTES[currentTheme()]
  private anims = new Map<string, Anim>()
  private projs = new Map<string, ProjTrack>()
  private pickups = new Map<string, PickupTrack>()
  private lastAt = frameTime()
  private clock = 0
  private lastOwnShotAt = -10
  private initialized = false
  private lowHpPulse = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    const resize = () => this.resize()
    addEventListener('resize', resize)
    this.resize()
    onThemeChange((t) => {
      this.pal = PALETTES[t]
      this.layerKey = ''
    })
  }

  private resize(): void {
    const dpr = Math.min(devicePixelRatio || 1, 2)
    this.canvas.width = Math.max(1, Math.round(innerWidth * dpr))
    this.canvas.height = Math.max(1, Math.round(innerHeight * dpr))
    // Kamera-Zoom: sichtbarer Ausschnitt ca. 1600x900 Welteinheiten (auf kleinen Handys etwas
    // enger, damit Figuren erkennbar bleiben); die Arena selbst ist deutlich groesser.
    let scale = Math.max(innerWidth / 1600, innerHeight / 900)
    if (Math.min(innerWidth, innerHeight) < 500) scale *= 1.25
    this.view = { w: innerWidth, h: innerHeight, dpr, scale, ox: 0, oy: 0 }
    this.layerKey = ''
    this.camInit = false
    this.applyCamera()
  }

  /** Setzt view.ox/oy aus der Kamera; erlaubt etwas Rand ueber die Arena hinaus (Sockel sichtbar). */
  private applyCamera(): void {
    const v = this.view
    const halfW = v.w / (2 * v.scale)
    const halfH = v.h / (2 * v.scale)
    const m = 48
    this.camX = Math.min(Math.max(this.camX, halfW - m), ARENA_WIDTH - halfW + m)
    this.camY = Math.min(Math.max(this.camY, halfH - m), ARENA_HEIGHT - halfH + m)
    v.ox = v.w / 2 - this.camX * v.scale
    v.oy = v.h / 2 - this.camY * v.scale
  }

  private followCamera(tx: number, ty: number, dt: number): void {
    if (!this.camInit) {
      this.camX = tx
      this.camY = ty
      this.camInit = true
    } else {
      const k = 1 - Math.exp(-dt * 10)
      this.camX += (tx - this.camX) * k
      this.camY += (ty - this.camY) * k
    }
    this.applyCamera()
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.view.ox + x * this.view.scale, y: this.view.oy + y * this.view.scale }
  }

  private ensureLayers(): { backdrop: HTMLCanvasElement; world: HTMLCanvasElement } {
    const v = this.view
    const ls = Math.min(1.25, Math.max(0.5, v.scale * v.dpr))
    const key = `${v.w}x${v.h}@${v.dpr}:${ls.toFixed(2)}:${this.pal.theme}`
    if (!this.backdrop || !this.world || key !== this.layerKey) {
      this.backdrop = buildBackdropLayer(this.pal, v)
      this.world = buildWorldLayer(this.pal, ls)
      this.layerKey = key
    }
    return { backdrop: this.backdrop, world: this.world }
  }

  /** Hintergrund + Arena mit Kamera-Transform zeichnen; setzt danach den Welt-Transform (inkl. Shake). */
  private drawWorld(shakeX = 0, shakeY = 0): void {
    const { ctx, view } = this
    const { backdrop, world } = this.ensureLayers()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(backdrop, 0, 0)
    const k = view.dpr * view.scale
    ctx.setTransform(
      k,
      0,
      0,
      k,
      view.dpr * view.ox + shakeX * k,
      view.dpr * view.oy + shakeY * k,
    )
    ctx.drawImage(
      world,
      -WORLD_PAD,
      -WORLD_PAD,
      ARENA_WIDTH + WORLD_PAD * 2,
      ARENA_HEIGHT + WORLD_PAD * 2,
    )
  }

  private tickClock(): number {
    const now = frameTime()
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastAt) / 1000))
    this.lastAt = now
    this.clock += dt
    return dt
  }

  renderIdle(): void {
    const dt = this.tickClock()
    this.fx.update(dt)
    // Menue-Hintergrund: Kamera driftet langsam ueber die Arena.
    const t = this.clock * 0.12
    this.camInit = true
    this.camX = ARENA_WIDTH / 2 + Math.sin(t) * 520
    this.camY = ARENA_HEIGHT / 2 + Math.sin(t * 1.7) * 220
    this.applyCamera()
    this.drawWorld()
    drawAmbient(this.ctx, this.pal, this.clock)
    this.fx.draw(this.ctx, this.pal)
    this.fx.drawTexts(this.ctx, this.pal)
    // Beim Spielstart soll die Kamera direkt auf den Spieler springen.
    this.camInit = false
  }

  // ------------------------------------------------------------------------------------
  // Zustandsdifferenzen -> Effekte
  // ------------------------------------------------------------------------------------
  private diff(state: RenderState, dt: number): void {
    const pal = this.pal
    const ownId = state.ownId
    for (const a of this.anims.values()) a.seen = false
    for (const p of state.players) {
      const own = p.id === ownId
      const tone = skinTone(skinColor(p.skin))
      let a = this.anims.get(p.id)
      if (!a) {
        a = {
          aim: p.aim,
          px: p.x,
          py: p.y,
          move: 0,
          vx: 0,
          vy: 0,
          flash: 0,
          recoil: 0,
          blink: 0,
          nextBlink: this.clock + 1 + Math.random() * 3,
          age: p.alive ? 0 : 99,
          phase: Math.random() * 10,
          hp: p.hp,
          shield: p.shield,
          alive: p.alive,
          seen: true,
          hpTrail: p.hp,
        }
        this.anims.set(p.id, a)
        if (p.alive && this.initialized) {
          this.fx.spawn(p.x, p.y, tone.base)
          this.hooks.onSpawn?.(own, p.x, p.y)
        }
      }
      a.seen = true
      // Bewegung/Geschwindigkeit aus Positionsdelta
      const ivx = (p.x - a.px) / dt
      const ivy = (p.y - a.py) / dt
      const teleport = Math.hypot(p.x - a.px, p.y - a.py) > 120
      a.vx = teleport ? 0 : a.vx + (ivx - a.vx) * Math.min(1, dt * 14)
      a.vy = teleport ? 0 : a.vy + (ivy - a.vy) * Math.min(1, dt * 14)
      a.px = p.x
      a.py = p.y
      const speed = Math.hypot(a.vx, a.vy)
      a.move += (Math.min(1, speed / 180) - a.move) * Math.min(1, dt * 10)
      a.aim = own ? p.aim : angleLerp(a.aim, p.aim, Math.min(1, dt * 18))
      a.flash = Math.max(0, a.flash - dt * 4.5)
      a.recoil = Math.max(0, a.recoil - dt * 9)
      a.age += dt
      // Blinzeln
      if (this.clock >= a.nextBlink) {
        a.blink = 1
        a.nextBlink = this.clock + 2 + Math.random() * 3.5
      }
      a.blink = Math.max(0, a.blink - dt * 7)
      a.hpTrail += (p.hp - a.hpTrail) * Math.min(1, dt * (p.hp < a.hpTrail ? 3 : 12))

      if (teleport && p.alive) {
        // Respawn/Rundenneustart: Position springt
        a.age = 0
      }
      // Tod / Spawn
      if (a.alive && !p.alive) {
        this.fx.explode(a.px, a.py, tone.base)
        this.fx.shake(own ? 14 : 4)
        this.hooks.onDeath?.(own, a.px, a.py)
        a.hpTrail = 0
      } else if (!a.alive && p.alive) {
        a.age = 0
        this.fx.spawn(p.x, p.y, tone.base)
        this.hooks.onSpawn?.(own, p.x, p.y)
        a.hpTrail = p.hp
      }
      // Schaden (HP + Shield)
      if (p.alive && a.alive) {
        const lost = a.hp + a.shield - (p.hp + p.shield)
        if (lost > 0 && p.hp + p.shield >= 0 && !teleport) {
          a.flash = 1
          this.fx.hit(p.x, p.y, p.shield < a.shield ? pal.shield : tone.base)
          this.fx.text(
            p.x,
            p.y - PLAYER_RADIUS - 18,
            `-${Math.round(lost)}`,
            own ? pal.hpLow : '#ffffff',
            own ? 20 : 16,
          )
          if (own) this.fx.shake(6)
          const byOwn = !own && this.clock - this.lastOwnShotAt < 0.8
          this.hooks.onHit?.(own, p.x, p.y, lost, byOwn)
        } else if (p.hp > a.hp && p.hp - a.hp >= 20) {
          this.fx.text(p.x, p.y - PLAYER_RADIUS - 18, `+${Math.round(p.hp - a.hp)}`, pal.hpGood, 17)
        }
      }
      a.hp = p.hp
      a.shield = p.shield
      a.alive = p.alive
    }
    for (const [id, a] of this.anims) if (!a.seen) this.anims.delete(id)

    // Projektile: Neue -> Muendungsfeuer (Schuetze = naechster Spieler), Verschwundene -> Einschlag
    for (const t of this.projs.values()) t.seen = false
    for (const pr of state.projectiles) {
      let t = this.projs.get(pr.id)
      if (!t) {
        let shooter: RenderPlayer | null = null
        let best = 60
        for (const pl of state.players) {
          if (!pl.alive) continue
          const d = Math.hypot(pl.x - pr.x, pl.y - pr.y)
          if (d < best) {
            best = d
            shooter = pl
          }
        }
        const tone = skinTone(shooter ? skinColor(shooter.skin) : 0)
        t = {
          x: pr.x,
          y: pr.y,
          trail: [],
          color: tone.base,
          seen: true,
          shooterId: shooter?.id ?? null,
          kind: pr.kind,
        }
        this.projs.set(pr.id, t)
        if (shooter && this.initialized) {
          const own = shooter.id === ownId
          const ang = Math.atan2(pr.y - shooter.y, pr.x - shooter.x)
          const an = this.anims.get(shooter.id)
          if (an) {
            an.recoil = 1
            if (!own) an.aim = ang
          }
          this.fx.muzzle(pr.x, pr.y, ang, tone.light)
          if (own) {
            this.lastOwnShotAt = this.clock
            this.fx.shake(1.6)
          }
          this.hooks.onShot?.(own, pr.x, pr.y, pr.kind)
        }
      }
      t.seen = true
      t.trail.push({ x: t.x, y: t.y })
      if (t.trail.length > 5) t.trail.shift()
      t.x = pr.x
      t.y = pr.y
    }
    for (const [id, t] of this.projs) {
      if (t.seen) continue
      this.projs.delete(id)
      // Nur Wand-/Zeit-Einschlag zeigen, wenn dort kein Spieler getroffen wurde (Treffer hat eigenen Effekt)
      const hitPlayer = state.players.some(
        (pl) =>
          pl.alive &&
          Math.hypot(pl.x - t.x, pl.y - t.y) <
            PLAYER_RADIUS + (CLASSES[t.kind]?.projectileRadius ?? PROJECTILE_RADIUS) + 24,
      )
      if (!hitPlayer) {
        this.fx.impact(t.x, t.y, t.color)
        this.hooks.onImpact?.(t.x, t.y)
      }
    }

    // Pickups: Neue -> Pop, Verschwundene -> Einsammel-Effekt
    for (const t of this.pickups.values()) t.seen = false
    for (const pu of state.pickups) {
      let t = this.pickups.get(pu.id)
      if (!t) {
        t = { x: pu.x, y: pu.y, kind: pu.kind, age: 0, seen: true }
        this.pickups.set(pu.id, t)
        if (this.initialized)
          this.fx.spawn(pu.x, pu.y, pu.kind === 'hp' ? pal.pickupHp : pal.pickupShield)
      }
      t.seen = true
      t.age += dt
    }
    for (const [id, t] of this.pickups) {
      if (t.seen) continue
      this.pickups.delete(id)
      const color = t.kind === 'hp' ? pal.pickupHp : pal.pickupShield
      const own = state.ownId
        ? state.players.some(
            (pl) =>
              pl.id === state.ownId &&
              Math.hypot(pl.x - t.x, pl.y - t.y) < PLAYER_RADIUS + PICKUP_RADIUS + 30,
          )
        : false
      this.fx.pickup(t.x, t.y, color)
      this.fx.text(t.x, t.y - 22, t.kind === 'hp' ? '+HP' : '+SHIELD', color, 15)
      this.hooks.onPickup?.(t.kind, own, t.x, t.y)
    }
    this.initialized = true
  }

  // ------------------------------------------------------------------------------------
  // Zeichnen
  // ------------------------------------------------------------------------------------
  render(state: RenderState): void {
    const dt = this.tickClock()
    this.diff(state, dt)
    this.fx.update(dt)
    const { ctx, view, pal } = this
    const t = this.clock

    const ownPlayer = state.players.find((p) => p.id === state.ownId)
    if (ownPlayer?.alive) this.followCamera(ownPlayer.x, ownPlayer.y, dt)
    const sh = this.fx.shakeOffset()
    this.drawWorld(sh.x, sh.y)
    drawAmbient(ctx, pal, t)

    this.drawPickups(ctx, t)
    const order = [...state.players].filter((p) => p.alive).sort((a, b) => a.y - b.y)
    this.drawShadows(ctx, order, t)
    this.drawProjectiles(ctx, t)
    this.drawBoostAuras(ctx, order, t, dt)
    for (const p of order) this.drawPlayer(ctx, p, p.id === state.ownId, t)
    this.fx.draw(ctx, pal)
    for (const p of order) this.drawNameplate(ctx, p, p.id === state.ownId)
    this.fx.drawTexts(ctx, pal)

    // Bildschirmraum: Vignette bei wenig Leben + Fadenkreuz
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
    const own = state.players.find((p) => p.id === state.ownId)
    if (own?.alive) this.drawLowHp(ctx, (own.hp / classOf(own.skin).hp) * 100, dt)
    if (state.crosshair && own?.alive)
      this.drawCrosshair(ctx, state.mouse, skinTone(skinColor(own.skin)).base, t)
  }

  private boostTrailAt = new Map<string, number>()

  /** Speed-Boost: pulsierende Aura unter der Figur + Nachleuchten (Punkte) hinter ihr. */
  private drawBoostAuras(
    ctx: CanvasRenderingContext2D,
    order: RenderPlayer[],
    t: number,
    _dt: number,
  ): void {
    for (const p of order) {
      if (p.boost <= 0) {
        this.boostTrailAt.delete(p.id)
        continue
      }
      const fade = Math.min(1, p.boost / 12) // letzte 0.4 s ausblenden
      const pulse = 0.5 + 0.5 * Math.sin(t * 16)
      ctx.globalAlpha = (0.35 + 0.25 * pulse) * fade
      ctx.beginPath()
      ctx.arc(p.x, p.y + 4, PLAYER_RADIUS + 8 + pulse * 4, 0, Math.PI * 2)
      ctx.fillStyle = this.pal.bullet
      ctx.fill()
      ctx.globalAlpha = fade
      ctx.lineWidth = 3
      ctx.strokeStyle = this.pal.bullet
      ctx.stroke()
      ctx.globalAlpha = 1
      const last = this.boostTrailAt.get(p.id) ?? 0
      if (t - last > 0.035) {
        this.boostTrailAt.set(p.id, t)
        this.fx.trail(p.x, p.y + 6, this.pal.bullet)
      }
    }
  }

  private drawPickups(ctx: CanvasRenderingContext2D, t: number): void {
    const pal = this.pal
    for (const [id, pu] of this.pickups) {
      const color = pu.kind === 'hp' ? pal.pickupHp : pal.pickupShield
      const pop = Math.min(1, pu.age * 4)
      const ease = 1 - Math.pow(1 - pop, 3)
      const bob = Math.sin(t * 3 + id.length + pu.x * 0.01) * 3
      const r = PICKUP_RADIUS * 1.35 * ease
      ctx.save()
      ctx.translate(pu.x, pu.y)
      // Bodenmarke
      ctx.fillStyle = pal.shadow
      ctx.beginPath()
      ctx.ellipse(0, r * 0.9 + 4, r * 0.9, r * 0.32, 0, 0, TAU)
      ctx.fill()
      // Pulsierender Ring
      const pulse = (t * 0.9 + pu.x * 0.003) % 1
      ctx.globalAlpha = (1 - pulse) * 0.6
      ctx.strokeStyle = color
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(0, 0, r + 4 + pulse * 20, 0, TAU)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.translate(0, bob - 4)
      // Glow
      if (pal.additive) {
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, r * 2.6)
        g.addColorStop(0, alpha(color, 0.5))
        g.addColorStop(1, alpha(color, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(0, 0, r * 2.6, 0, TAU)
        ctx.fill()
      }
      // Medaillon
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, TAU)
      ctx.fillStyle = color
      ctx.fill()
      ctx.lineWidth = 3.5
      ctx.strokeStyle = pal.ink
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(-r * 0.3, -r * 0.35, r * 0.28, 0, TAU)
      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = pal.ink
      ctx.lineWidth = 2.2
      ctx.lineJoin = 'round'
      ctx.beginPath()
      if (pu.kind === 'hp') {
        const a = r * 0.22
        const b = r * 0.62
        ctx.moveTo(-a, -b)
        ctx.lineTo(a, -b)
        ctx.lineTo(a, -a)
        ctx.lineTo(b, -a)
        ctx.lineTo(b, a)
        ctx.lineTo(a, a)
        ctx.lineTo(a, b)
        ctx.lineTo(-a, b)
        ctx.lineTo(-a, a)
        ctx.lineTo(-b, a)
        ctx.lineTo(-b, -a)
        ctx.lineTo(-a, -a)
        ctx.closePath()
      } else {
        ctx.moveTo(0, -r * 0.62)
        ctx.lineTo(r * 0.52, -r * 0.34)
        ctx.lineTo(r * 0.44, r * 0.16)
        ctx.quadraticCurveTo(r * 0.3, r * 0.5, 0, r * 0.68)
        ctx.quadraticCurveTo(-r * 0.3, r * 0.5, -r * 0.44, r * 0.16)
        ctx.lineTo(-r * 0.52, -r * 0.34)
        ctx.closePath()
      }
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
  }

  private drawShadows(ctx: CanvasRenderingContext2D, players: RenderPlayer[], t: number): void {
    ctx.fillStyle = this.pal.shadow
    for (const p of players) {
      const a = this.anims.get(p.id)
      const r = PLAYER_RADIUS * MODEL_SCALE
      const hover = skinModel(p.skin) === 4 ? 1.1 + Math.sin(t * 3 + (a?.phase ?? 0)) * 0.08 : 1
      ctx.beginPath()
      ctx.ellipse(p.x + 2, p.y + r * 0.95, r * 0.95 * hover, r * 0.38, 0, 0, TAU)
      ctx.fill()
    }
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D, t: number): void {
    const pal = this.pal
    for (const tr of this.projs.values()) {
      const pr = (CLASSES[tr.kind] ?? CLASSES[0]!).projectileRadius
      // Schweif
      const pts = [...tr.trail, { x: tr.x, y: tr.y }]
      const last = pts[pts.length - 2] ?? pts[0]!
      const ang = Math.atan2(tr.y - last.y, tr.x - last.x)
      if (pts.length > 1) {
        ctx.lineCap = 'round'
        for (let i = 1; i < pts.length; i++) {
          const f = i / pts.length
          ctx.globalAlpha = f * 0.7
          ctx.strokeStyle = tr.color
          ctx.lineWidth = pr * 2 * f
          ctx.beginPath()
          ctx.moveTo(pts[i - 1]!.x, pts[i - 1]!.y)
          ctx.lineTo(pts[i]!.x, pts[i]!.y)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      }
      const r = pr * 1.5
      if (pal.additive) {
        const g = ctx.createRadialGradient(tr.x, tr.y, 1, tr.x, tr.y, r * 4)
        g.addColorStop(0, alpha(tr.color, 0.55))
        g.addColorStop(1, alpha(tr.color, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(tr.x, tr.y, r * 4, 0, TAU)
        ctx.fill()
      }
      this.drawBullet(ctx, tr.kind, tr.x, tr.y, ang, r, tr.color, t)
    }
  }

  /** Geschoss-Form je Charakter: Blase, Klotz, Funke, Nadel, Wisp, Kralle. */
  private drawBullet(
    ctx: CanvasRenderingContext2D,
    kind: number,
    x: number,
    y: number,
    ang: number,
    r: number,
    color: string,
    t: number,
  ): void {
    const pal = this.pal
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(ang)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    switch (kind) {
      case 1: {
        // Klotz: Wuerfel
        ctx.fillStyle = color
        ctx.strokeStyle = pal.ink
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.roundRect(-r, -r, r * 2, r * 2, 3)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = pal.bulletCore
        ctx.fillRect(-r * 0.55, -r * 0.55, r * 0.5, r * 0.5)
        break
      }
      case 2: {
        // Funke: kurzer Zickzack-Blitz
        const l = r * 3.2
        ctx.strokeStyle = pal.ink
        ctx.lineWidth = r * 1.1 + 3
        ctx.beginPath()
        ctx.moveTo(-l, 0)
        ctx.lineTo(-l * 0.3, -r * 0.8)
        ctx.lineTo(l * 0.1, r * 0.8)
        ctx.lineTo(l, 0)
        ctx.stroke()
        ctx.strokeStyle = color
        ctx.lineWidth = r * 1.1
        ctx.stroke()
        ctx.strokeStyle = pal.bulletCore
        ctx.lineWidth = r * 0.4
        ctx.stroke()
        break
      }
      case 3: {
        // Nadel: lang und duenn
        const l = r * 5
        ctx.strokeStyle = pal.ink
        ctx.lineWidth = r * 0.9 + 3
        ctx.beginPath()
        ctx.moveTo(-l, 0)
        ctx.lineTo(l, 0)
        ctx.stroke()
        ctx.strokeStyle = color
        ctx.lineWidth = r * 0.9
        ctx.stroke()
        ctx.fillStyle = pal.bulletCore
        ctx.beginPath()
        ctx.arc(l, 0, r * 0.6, 0, TAU)
        ctx.fill()
        break
      }
      case 4: {
        // Wisp: weicher Geist mit Schwanz und zwei Augen
        const wob = Math.sin(t * 14) * r * 0.15
        ctx.fillStyle = color
        ctx.strokeStyle = pal.ink
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2)
        ctx.lineTo(-r * 1.9, r * 0.6 + wob)
        ctx.lineTo(-r * 1.3, 0)
        ctx.lineTo(-r * 1.9, -r * 0.6 - wob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = pal.ink
        ctx.beginPath()
        ctx.arc(r * 0.2, -r * 0.35, r * 0.17, 0, TAU)
        ctx.arc(r * 0.2, r * 0.35, r * 0.17, 0, TAU)
        ctx.fill()
        break
      }
      case 5: {
        // Kralle: Halbmond
        ctx.strokeStyle = pal.ink
        ctx.lineWidth = r * 0.9 + 3
        ctx.beginPath()
        ctx.arc(-r * 0.6, 0, r * 1.5, -1.1, 1.1)
        ctx.stroke()
        ctx.strokeStyle = color
        ctx.lineWidth = r * 0.9
        ctx.stroke()
        ctx.strokeStyle = pal.bulletCore
        ctx.lineWidth = r * 0.3
        ctx.stroke()
        break
      }
      default: {
        // Blase (Blobby)
        ctx.beginPath()
        ctx.arc(0, 0, r + 1.5, 0, TAU)
        ctx.fillStyle = pal.ink
        ctx.fill()
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, TAU)
        ctx.fillStyle = color
        ctx.fill()
        ctx.beginPath()
        ctx.arc(-r * 0.2, -r * 0.2, r * 0.45 + Math.sin(t * 30) * 0.2, 0, TAU)
        ctx.fillStyle = pal.bulletCore
        ctx.fill()
      }
    }
    ctx.restore()
  }

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    p: RenderPlayer,
    own: boolean,
    t: number,
  ): void {
    const a = this.anims.get(p.id)
    if (!a) return
    const pal = this.pal
    const tone = skinTone(skinColor(p.skin))
    const model = skinModel(p.skin)
    const r = PLAYER_RADIUS * MODEL_SCALE
    const clock = t + a.phase
    // Pop-in nach Spawn (Overshoot) + Squash/Stretch nach Bewegung
    const age = Math.min(1, a.age / 0.4)
    // easeOutBack: schnelles Aufpoppen mit leichtem Ueberschwingen (0 -> ~1.1 -> 1)
    const pop = age >= 1 ? 1 : 1 + 2.7 * Math.pow(age - 1, 3) + 1.7 * Math.pow(age - 1, 2)
    const sp = Math.hypot(a.vx, a.vy)
    const stretch = Math.min(0.18, sp / 1600)
    const dir = Math.atan2(a.vy, a.vx)
    const bob = model === 4 ? Math.sin(clock * 3) * 2.2 - 3.5 : Math.sin(clock * 14) * 1.1 * a.move
    ctx.save()
    ctx.translate(p.x, p.y + bob)
    ctx.scale(Math.max(0.05, pop), Math.max(0.05, pop))
    if (sp > 20) {
      ctx.rotate(dir)
      ctx.scale(1 + stretch, 1 - stretch * 0.8)
      ctx.rotate(-dir)
    }
    // Schild-Blase
    if (p.shield > 0) {
      const s = 0.8 + 0.2 * Math.sin(t * 5)
      ctx.beginPath()
      ctx.arc(0, 0, r * 1.5, 0, TAU)
      ctx.fillStyle = alpha(pal.shield, 0.16 + 0.06 * s)
      ctx.fill()
      ctx.lineWidth = 3
      ctx.strokeStyle = alpha(pal.shield, 0.8)
      ctx.setLineDash([10, 7])
      ctx.lineDashOffset = -t * 20
      ctx.stroke()
      ctx.setLineDash([])
    }
    // Eigener Spieler: Leuchtring zur Orientierung
    if (own) {
      ctx.beginPath()
      ctx.arc(0, 0, r * 1.28, 0, TAU)
      ctx.lineWidth = 2.5
      ctx.strokeStyle = alpha(tone.light, 0.8)
      ctx.setLineDash([5, 6])
      ctx.lineDashOffset = t * 14
      ctx.stroke()
      ctx.setLineDash([])
    }
    drawModel(ctx, model, {
      r,
      tone,
      ink: pal.ink,
      aim: a.aim,
      t: clock,
      move: a.move,
      recoil: a.recoil,
      flash: a.flash,
      blink: a.blink,
    })
    ctx.restore()
  }

  private drawNameplate(ctx: CanvasRenderingContext2D, p: RenderPlayer, own: boolean): void {
    const a = this.anims.get(p.id)
    if (!a) return
    const pal = this.pal
    const tone = skinTone(skinColor(p.skin))
    const r = PLAYER_RADIUS * MODEL_SCALE
    // Name
    const name = p.nickname
    ctx.font = `800 ${own ? 13 : 12}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const w = ctx.measureText(name).width + 14
    const x = p.x
    const y = p.y + r + 20
    ctx.beginPath()
    ctx.roundRect(x - w / 2, y - 9, w, 18, 9)
    ctx.fillStyle = own
      ? tone.base
      : pal.theme === 'dark'
        ? 'rgba(13, 8, 34, 0.78)'
        : 'rgba(255, 255, 255, 0.86)'
    ctx.fill()
    ctx.lineWidth = 2.5
    ctx.strokeStyle = pal.ink
    ctx.stroke()
    ctx.fillStyle = own ? '#ffffff' : pal.text
    if (own) {
      ctx.lineWidth = 3
      ctx.strokeStyle = pal.ink
      ctx.lineJoin = 'round'
      ctx.strokeText(name, x, y + 0.5)
    }
    ctx.fillText(name, x, y + 0.5)
    // Lebensbalken (nur wenn nicht voll oder Schild aktiv)
    const maxHp = classOf(p.skin).hp
    const pct = (p.hp / maxHp) * 100
    if (p.hp < maxHp || p.shield > 0) {
      const bw = 38
      const bx = p.x - bw / 2
      const by = p.y - r - 16
      ctx.beginPath()
      ctx.roundRect(bx - 2, by - 2, bw + 4, 9, 4.5)
      ctx.fillStyle = pal.ink
      ctx.fill()
      ctx.beginPath()
      ctx.roundRect(bx, by, bw, 5, 2.5)
      ctx.fillStyle = pal.hpBack
      ctx.fill()
      // Nachlaufender Verlust
      if (a.hpTrail > p.hp) {
        ctx.beginPath()
        ctx.roundRect(bx, by, Math.max(0, (bw * a.hpTrail) / maxHp), 5, 2.5)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
      }
      ctx.beginPath()
      ctx.roundRect(bx, by, Math.max(0, (bw * p.hp) / maxHp), 5, 2.5)
      ctx.fillStyle = pct > 50 ? pal.hpGood : pct > 25 ? pal.hpMid : pal.hpLow
      ctx.fill()
      if (p.shield > 0) {
        ctx.beginPath()
        ctx.roundRect(bx, by - 5, Math.max(0, (bw * p.shield) / 50), 3, 1.5)
        ctx.fillStyle = pal.shield
        ctx.fill()
      }
    }
  }

  private drawLowHp(ctx: CanvasRenderingContext2D, hp: number, dt: number): void {
    const danger = hp <= 35 ? 1 - hp / 35 : 0
    this.lowHpPulse += dt * (3 + danger * 4)
    if (danger <= 0) return
    const { w, h } = this.view
    const pulse = 0.65 + 0.35 * Math.sin(this.lowHpPulse * 2)
    const g = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.42,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.75,
    )
    g.addColorStop(0, 'rgba(255, 40, 70, 0)')
    g.addColorStop(1, `rgba(255, 40, 70, ${(0.15 + danger * 0.42) * pulse})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  private drawCrosshair(
    ctx: CanvasRenderingContext2D,
    m: { x: number; y: number },
    color: string,
    t: number,
  ): void {
    const pal = this.pal
    const recoil = Math.max(0, 1 - (this.clock - this.lastOwnShotAt) * 7)
    const gap = 9 + recoil * 7
    const len = 7
    ctx.save()
    ctx.translate(m.x, m.y)
    ctx.rotate(t * 0.6)
    for (const [lw, stroke] of [
      [5, pal.ink],
      [2.2, color],
    ] as const) {
      ctx.lineWidth = lw
      ctx.strokeStyle = stroke
      ctx.lineCap = 'round'
      ctx.beginPath()
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU
        ctx.moveTo(Math.cos(a) * gap, Math.sin(a) * gap)
        ctx.lineTo(Math.cos(a) * (gap + len), Math.sin(a) * (gap + len))
      }
      ctx.stroke()
    }
    ctx.restore()
    ctx.beginPath()
    ctx.arc(m.x, m.y, 2.4, 0, TAU)
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = pal.ink
    ctx.stroke()
  }
}
