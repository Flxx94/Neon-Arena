import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  PICKUP_RADIUS,
  CLASSES,
  mapOf,
  type MapDef,
  PLAYER_RADIUS,
  PROJECTILE_RADIUS,
  classOf,
  classRange,
  isFlying,
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
import { FONT, PALETTES, alpha, paletteFor, skinTone, type Palette } from './palette.js'
import type { RenderHooks, RenderPlayer, RenderState, Renderer } from './Renderer.js'
import { currentTheme, onThemeChange, type Theme } from '../ui/theme.js'

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
  private baseTheme: Theme = currentTheme()
  private map: MapDef = mapOf(0)
  private pal: Palette = PALETTES[this.baseTheme]
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
      this.baseTheme = t
      this.pal = paletteFor(t, this.map.theme)
      this.layerKey = ''
    })
  }

  /** Aktive Karte (Optik + Strahltest); Layer werden beim naechsten Frame neu gebaut. */
  setMap(id: number): void {
    if (id === this.map.id) return
    this.map = mapOf(id)
    this.pal = paletteFor(this.baseTheme, this.map.theme)
    this.layerKey = ''
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
    const key = `${v.w}x${v.h}@${v.dpr}:${ls.toFixed(2)}:${this.pal.theme}:${this.map.id}`
    if (!this.backdrop || !this.world || key !== this.layerKey) {
      this.backdrop = buildBackdropLayer(this.pal, v)
      this.world = buildWorldLayer(this.pal, ls, this.map)
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
    drawAmbient(this.ctx, this.pal, this.clock, this.map)
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
      // Ult-Start/-Ende (Rakete explodiert, Wuerfel schlaegt ein, ...)
      const prevUlt = this.prevUlt.get(p.id) ?? 0
      const kind = classOf(p.skin).ult.kind
      if (isFlying(classOf(p.skin), p.ultTicks)) this.rocketPos.set(p.id, { x: p.x, y: p.y })
      if (this.initialized && prevUlt === 0 && p.ultTicks > 0) {
        this.hooks.onUltFx?.(kind, own, p.x, p.y)
      } else if (this.initialized && prevUlt > 0 && p.ultTicks === 0 && p.alive) {
        if (kind === 'rocket') {
          const rp = this.rocketPos.get(p.id) ?? { x: p.x, y: p.y }
          this.burst(rp.x, rp.y, classOf(p.skin).ult.radius * 1.6, '#ffb02e', state)
          this.hooks.onUltFx?.('rocket-boom', own, rp.x, rp.y)
        } else if (kind === 'slam') {
          const d = classOf(p.skin).ult
          this.burst(p.ultX, p.ultY, d.shockRadius, '#ff7a3f', state)
          this.hooks.onUltFx?.('slam-boom', own, p.ultX, p.ultY)
        }
      }
      this.prevUlt.set(p.id, p.ultTicks)
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
    this.setMap(state.map)
    const dt = this.tickClock()
    this.diff(state, dt)
    this.fx.update(dt)
    const { ctx, view, pal } = this
    const t = this.clock

    const ownPlayer = state.players.find((p) => p.id === state.ownId)
    if (ownPlayer?.alive) this.followCamera(ownPlayer.x, ownPlayer.y, dt)
    const sh = this.fx.shakeOffset()
    this.drawWorld(sh.x, sh.y)
    drawAmbient(ctx, pal, t, this.map)
    if (state.ghost) this.drawGhostWorld(ctx, t)

    this.drawPickups(ctx, t)
    const order = [...state.players].filter((p) => p.alive).sort((a, b) => a.y - b.y)
    this.drawShadows(ctx, order, t)
    if (ownPlayer?.alive) this.drawAimBeam(ctx, ownPlayer, t)
    this.drawProjectiles(ctx, t)
    this.drawBoostAuras(ctx, order, t, dt)
    this.drawStatusAuras(ctx, order, state.ultTargetId, t)
    if (state.ultPreview && ownPlayer?.alive) this.drawUltPreview(ctx, ownPlayer, state.ultPreview, t)
    this.drawBursts(ctx, dt)
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

  // ------------------------------------------------------------------------------------
  // Ziel-Balken, Ult-/Status-Auren, Geisterwelt
  // ------------------------------------------------------------------------------------
  /** Laenge eines Strahls bis zum ersten Hindernis (Slab-Test gegen die Rechtecke), max `maxLen`. */
  private rayLength(x: number, y: number, dx: number, dy: number, maxLen: number): number {
    let best = maxLen
    for (const o of this.map.obstacles) {
      let t0 = 0
      let t1 = best
      for (const [p, d, lo, hi] of [
        [x, dx, o.x, o.x + o.w],
        [y, dy, o.y, o.y + o.h],
      ] as const) {
        if (Math.abs(d) < 1e-9) {
          if (p < lo || p > hi) {
            t1 = -1
            break
          }
        } else {
          let a = (lo - p) / d
          let b = (hi - p) / d
          if (a > b) [a, b] = [b, a]
          t0 = Math.max(t0, a)
          t1 = Math.min(t1, b)
          if (t0 > t1) break
        }
      }
      if (t0 <= t1 && t1 >= 0) best = Math.min(best, Math.max(0, t0))
    }
    return best
  }

  /** Transparenter Balken vom eigenen Charakter in Zielrichtung (Laenge = Waffenreichweite, an Waenden gekappt). */
  private drawAimBeam(ctx: CanvasRenderingContext2D, p: RenderPlayer, t: number): void {
    const cls = classOf(p.skin)
    const maxLen = Math.min(820, Math.max(280, classRange(cls)))
    const len = this.rayLength(p.x, p.y, Math.cos(p.aim), Math.sin(p.aim), maxLen)
    if (len < PLAYER_RADIUS + 8) return
    const tone = skinTone(skinColor(p.skin))
    const w = Math.max(9, cls.projectileRadius * 3.2)
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.aim)
    const g = ctx.createLinearGradient(0, 0, len, 0)
    g.addColorStop(0, alpha(tone.base, 0.32))
    g.addColorStop(1, alpha(tone.base, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.roundRect(PLAYER_RADIUS, -w / 2, len - PLAYER_RADIUS, w, w / 2)
    ctx.fill()
    // feine Mittellinie, leicht laufend
    ctx.strokeStyle = alpha(tone.light, 0.34)
    ctx.lineWidth = 1.5
    ctx.setLineDash([10, 12])
    ctx.lineDashOffset = -t * 40
    ctx.beginPath()
    ctx.moveTo(PLAYER_RADIUS + 4, 0)
    ctx.lineTo(len, 0)
    ctx.stroke()
    ctx.restore()
  }

  /** Aktive Ult (Ring), Betaeubung (Sterne), Wurzel (Kette) und Ziel-Markierung der Ziel-Ult. */
  private drawStatusAuras(
    ctx: CanvasRenderingContext2D,
    order: RenderPlayer[],
    targetId: string | null,
    t: number,
  ): void {
    const r = PLAYER_RADIUS * MODEL_SCALE
    for (const p of order) {
      if (p.ultTicks > 0) {
        const def = classOf(p.skin).ult
        if (def.kind === 'field') this.drawField(ctx, p, def.radius, t)
        else if (def.kind === 'beam') this.drawBeamFx(ctx, p, def)
        else if (def.kind === 'slam') this.drawSlamFx(ctx, p, def)
        else if (def.kind === 'ghost') {
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.lineWidth = 4
          ctx.strokeStyle = alpha('#b57bff', 0.9)
          ctx.fillStyle = alpha('#b57bff', 0.14)
          ctx.setLineDash([14, 8])
          ctx.lineDashOffset = -t * 60
          ctx.beginPath()
          ctx.arc(0, 0, r * 2 * (1 + Math.sin(t * 10) * 0.07), 0, TAU)
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        }
      }
      if (p.slow > 0) {
        ctx.save()
        ctx.translate(p.x, p.y + r * 0.7)
        ctx.strokeStyle = alpha('#9ff0ff', 0.9)
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.ellipse(0, 0, r * 1.3, r * 0.5, 0, 0, TAU)
        ctx.stroke()
        ctx.restore()
      }
      if (p.root > 0) {
        ctx.save()
        ctx.translate(p.x, p.y + r * 0.6)
        ctx.strokeStyle = alpha('#b57bff', 0.9)
        ctx.lineWidth = 3
        ctx.setLineDash([6, 5])
        ctx.beginPath()
        ctx.ellipse(0, 0, r * 1.5, r * 0.6, 0, 0, TAU)
        ctx.stroke()
        ctx.restore()
      }
      if (p.stun > 0) {
        ctx.save()
        ctx.translate(p.x, p.y - r - 18)
        ctx.font = `900 16px ${FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for (let i = 0; i < 3; i++) {
          const a = t * 5 + (i * TAU) / 3
          ctx.fillStyle = '#ffd23f'
          ctx.strokeStyle = this.pal.ink
          ctx.lineWidth = 3
          const sx = Math.cos(a) * 15
          const sy = Math.sin(a) * 5
          ctx.strokeText('★', sx, sy)
          ctx.fillText('★', sx, sy)
        }
        ctx.restore()
      }
      if (p.id === targetId) {
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(t * 2)
        ctx.strokeStyle = '#ff4b5c'
        ctx.lineWidth = 3.5
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 2)
          ctx.beginPath()
          ctx.arc(0, 0, r * 1.9, -0.35, 0.35)
          ctx.stroke()
        }
        ctx.restore()
      }
    }
  }

  /** Geisterwelt: dunkles Violett ueber der Welt + driftende Geister-Partikel (Bildschirmraum). */
  private drawGhostWorld(ctx: CanvasRenderingContext2D, t: number): void {
    const { w, h, dpr } = this.view
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = 'rgba(14, 4, 34, 0.7)'
    ctx.fillRect(0, 0, w, h)
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75)
    g.addColorStop(0, 'rgba(120, 60, 200, 0)')
    g.addColorStop(1, 'rgba(60, 10, 110, 0.55)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 38; i++) {
      const sp = 0.25 + ((i * 37) % 10) / 20
      const x = ((((i * 97) % 100) / 100) * w + Math.sin(t * sp + i) * 40 + w) % w
      const y = (((((i * 53) % 100) / 100) * h - t * 28 * sp) % h + h) % h
      const s = 2 + ((i * 7) % 5)
      ctx.fillStyle = `rgba(${190 + ((i * 11) % 60)}, ${150 + ((i * 5) % 60)}, 255, ${0.25 + 0.2 * Math.sin(t * 2 + i)})`
      ctx.beginPath()
      ctx.arc(x, y, s, 0, TAU)
      ctx.fill()
      if (i % 6 === 0) {
        // kleine Geister
        ctx.fillStyle = 'rgba(235, 225, 255, 0.16)'
        ctx.beginPath()
        ctx.arc(x, y, 14, Math.PI, 0)
        ctx.lineTo(x + 14, y + 16)
        ctx.lineTo(x + 7, y + 11)
        ctx.lineTo(x, y + 16)
        ctx.lineTo(x - 7, y + 11)
        ctx.lineTo(x - 14, y + 16)
        ctx.closePath()
        ctx.fill()
      }
    }
    ctx.restore()
  }

  private boostTrailAt = new Map<string, number>()
  private prevUlt = new Map<string, number>()
  private rocketPos = new Map<string, { x: number; y: number }>()
  private bursts: { x: number; y: number; r: number; t: number; color: string }[] = []

  /** Explosion/Schockwelle: expandierender Ring + Konfetti + Kamera-Wackeln (wenn nah am eigenen Spieler). */
  private burst(x: number, y: number, r: number, color: string, state: RenderState): void {
    this.bursts.push({ x, y, r, t: 0, color })
    this.fx.confetti(x, y, 60)
    const own = state.players.find((q) => q.id === state.ownId)
    if (own && Math.hypot(own.x - x, own.y - y) < 900) this.fx.shake(8)
  }

  private drawBursts(ctx: CanvasRenderingContext2D, dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!
      b.t += dt
      const k = b.t / 0.65
      if (k >= 1) {
        this.bursts.splice(i, 1)
        continue
      }
      const e = 1 - Math.pow(1 - k, 3)
      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.fillStyle = alpha(b.color, 0.4 * (1 - k))
      ctx.beginPath()
      ctx.arc(0, 0, b.r * (0.25 + 0.75 * e), 0, TAU)
      ctx.fill()
      ctx.lineWidth = 8 * (1 - k) + 2
      ctx.strokeStyle = alpha('#ffffff', 0.85 * (1 - k))
      ctx.beginPath()
      ctx.arc(0, 0, b.r * e, 0, TAU)
      ctx.stroke()
      ctx.restore()
    }
  }

  /** Pre-Aim der Ult (Ult-Joystick gezogen / Q gehalten): zeigt Richtung, Zielpunkt bzw. Wirkbereich. */
  private drawUltPreview(
    ctx: CanvasRenderingContext2D,
    p: RenderPlayer,
    pv: { angle: number; dist: number },
    t: number,
  ): void {
    const def = classOf(p.skin).ult
    const ux = Math.cos(pv.angle)
    const uy = Math.sin(pv.angle)
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.lineWidth = 3
    ctx.setLineDash([14, 10])
    ctx.lineDashOffset = -t * 50
    switch (def.kind) {
      case 'beam': {
        ctx.rotate(pv.angle)
        ctx.fillStyle = alpha('#ff4b5c', 0.16)
        ctx.fillRect(PLAYER_RADIUS, -def.width / 2, def.range, def.width)
        ctx.strokeStyle = alpha('#ff4b5c', 0.7)
        ctx.strokeRect(PLAYER_RADIUS, -def.width / 2, def.range, def.width)
        break
      }
      case 'field': {
        ctx.fillStyle = alpha('#3fd8ff', 0.14)
        ctx.strokeStyle = alpha('#3fd8ff', 0.85)
        ctx.beginPath()
        ctx.arc(0, 0, def.radius, 0, TAU)
        ctx.fill()
        ctx.stroke()
        break
      }
      case 'slam': {
        const d = Math.min(def.range, Math.max(120, def.range * pv.dist))
        const tx = ux * d
        const ty = uy * d
        ctx.strokeStyle = alpha('#ffffff', 0.6)
        ctx.beginPath()
        ctx.moveTo(ux * PLAYER_RADIUS, uy * PLAYER_RADIUS)
        ctx.lineTo(tx, ty)
        ctx.stroke()
        ctx.strokeStyle = alpha('#ff7a3f', 0.8)
        ctx.beginPath()
        ctx.arc(tx, ty, def.shockRadius, 0, TAU)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = alpha('#ff4b5c', 0.3)
        ctx.strokeStyle = alpha('#ff4b5c', 0.95)
        ctx.beginPath()
        ctx.arc(tx, ty, def.radius, 0, TAU)
        ctx.fill()
        ctx.stroke()
        break
      }
      case 'rocket': {
        ctx.rotate(pv.angle)
        ctx.fillStyle = alpha('#ffd23f', 0.14)
        ctx.fillRect(PLAYER_RADIUS, -def.width, 620, def.width * 2)
        ctx.setLineDash([])
        ctx.strokeStyle = alpha('#ffd23f', 0.9)
        ctx.lineWidth = 4
        for (let i = 0; i < 5; i++) {
          const x = 90 + i * 100 + ((t * 120) % 100)
          ctx.globalAlpha = 1 - i / 6
          ctx.beginPath()
          ctx.moveTo(x - 10, -12)
          ctx.lineTo(x + 6, 0)
          ctx.lineTo(x - 10, 12)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
        break
      }
      default: {
        // ghost / pounce: Zielkegel
        ctx.fillStyle = alpha('#b57bff', 0.12)
        ctx.strokeStyle = alpha('#b57bff', 0.7)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.arc(0, 0, def.range, pv.angle - 0.55, pv.angle + 0.55)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  /** Rakete (Blobby-Ult) statt Figur. */
  private drawRocket(ctx: CanvasRenderingContext2D, p: RenderPlayer, t: number): void {
    const tone = skinTone(skinColor(p.skin))
    const pal = this.pal
    this.fx.trail(p.x - Math.cos(p.ultAim) * 24, p.y - Math.sin(p.ultAim) * 24, '#ffb02e')
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.ultAim)
    ctx.lineJoin = 'round'
    const fl = 14 + Math.sin(t * 50) * 5
    ctx.fillStyle = '#ffb02e'
    ctx.beginPath()
    ctx.moveTo(-22, 0)
    ctx.lineTo(-30 - fl, -8)
    ctx.lineTo(-24 - fl * 1.7, 0)
    ctx.lineTo(-30 - fl, 8)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#fff3b0'
    ctx.beginPath()
    ctx.moveTo(-22, 0)
    ctx.lineTo(-26 - fl * 0.6, -4)
    ctx.lineTo(-24 - fl, 0)
    ctx.lineTo(-26 - fl * 0.6, 4)
    ctx.closePath()
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = pal.ink
    ctx.fillStyle = tone.dark
    for (const s of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(-24, s * 8)
      ctx.lineTo(-6, s * 10)
      ctx.lineTo(-24, s * 24)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    ctx.fillStyle = tone.base
    ctx.beginPath()
    ctx.ellipse(0, 0, 26, 12, 0, 0, TAU)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#ff4b5c'
    ctx.beginPath()
    ctx.moveTo(14, -10)
    ctx.quadraticCurveTo(34, -6, 38, 0)
    ctx.quadraticCurveTo(34, 6, 14, 10)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = pal.bulletCore
    ctx.beginPath()
    ctx.arc(2, 0, 5, 0, TAU)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  /** Elektrofeld (Zappy): pulsierender Kreis mit zuckenden Blitzbogen. */
  private drawField(ctx: CanvasRenderingContext2D, p: RenderPlayer, radius: number, t: number): void {
    ctx.save()
    ctx.translate(p.x, p.y)
    const pulse = 1 + Math.sin(t * 8) * 0.03
    ctx.fillStyle = alpha('#3fd8ff', 0.12)
    ctx.strokeStyle = alpha('#9ff0ff', 0.85)
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(0, 0, radius * pulse, 0, TAU)
    ctx.fill()
    ctx.stroke()
    ctx.lineWidth = 2.5
    ctx.strokeStyle = alpha('#ffffff', 0.9)
    const seed = Math.floor(t * 14)
    for (let i = 0; i < 6; i++) {
      const a0 = ((i + (seed % 3) * 0.37) / 6) * TAU
      ctx.beginPath()
      let rr = 24
      ctx.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr)
      for (let k = 1; k <= 6; k++) {
        rr = 24 + (radius - 30) * (k / 6)
        const j = (((seed * 31 + i * 17 + k * 13) % 11) - 5) * 0.022
        ctx.lineTo(Math.cos(a0 + j) * rr, Math.sin(a0 + j) * rr)
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  /** Weltenstrahl (Hexo): breiter Strahl ueber die ganze Map, blendet in 14 Ticks aus. */
  private drawBeamFx(ctx: CanvasRenderingContext2D, p: RenderPlayer, def: { range: number; width: number; durationTicks: number }): void {
    const k = p.ultTicks / def.durationTicks
    ctx.save()
    ctx.translate(p.ultX, p.ultY)
    ctx.rotate(p.ultAim)
    const w = def.width * (0.35 + 0.65 * k)
    const g = ctx.createLinearGradient(0, 0, def.range, 0)
    g.addColorStop(0, alpha('#ff4b5c', 0.85 * k))
    g.addColorStop(1, alpha('#ff4b5c', 0.55 * k))
    ctx.fillStyle = g
    ctx.fillRect(0, -w / 2, def.range, w)
    ctx.fillStyle = alpha('#ffffff', 0.95 * k)
    ctx.fillRect(0, -w * 0.18, def.range, w * 0.36)
    ctx.restore()
  }

  /** Riesenwuerfel (Cuby) im Anflug: Schatten am Ziel waechst, Wuerfel faellt von oben. */
  private drawSlamFx(ctx: CanvasRenderingContext2D, p: RenderPlayer, def: { radius: number; durationTicks: number }): void {
    const f = Math.min(1, Math.max(0, 1 - p.ultTicks / def.durationTicks))
    ctx.save()
    ctx.translate(p.ultX, p.ultY)
    ctx.fillStyle = alpha('#000000', 0.18 + 0.25 * f)
    ctx.beginPath()
    ctx.ellipse(0, 0, def.radius * (0.4 + 0.6 * f), def.radius * (0.4 + 0.6 * f) * 0.7, 0, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = alpha('#ff4b5c', 0.9)
    ctx.lineWidth = 4
    ctx.setLineDash([12, 8])
    ctx.beginPath()
    ctx.arc(0, 0, def.radius, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
    const size = def.radius * (1.5 - 0.5 * f)
    const y = -(1 - f) * (1 - f) * 380
    const tone = skinTone(skinColor(p.skin))
    ctx.translate(0, y)
    ctx.rotate((1 - f) * 1.2)
    ctx.fillStyle = tone.base
    ctx.strokeStyle = this.pal.ink
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.roundRect(-size / 2, -size / 2, size, size, 10)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = this.pal.bulletCore
    ctx.fillRect(-size * 0.3, -size * 0.3, size * 0.22, size * 0.22)
    ctx.restore()
  }

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
    if (isFlying(classOf(p.skin), p.ultTicks)) {
      this.drawRocket(ctx, p, t)
      return
    }
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
