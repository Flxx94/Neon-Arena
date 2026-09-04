import { ARENA_HEIGHT, ARENA_WIDTH, OBSTACLES, PLAYER_RADIUS, PROJECTILE_RADIUS } from '@neon-arena/shared'
import type { RenderState, Renderer } from './Renderer.js'

/** Plain-Canvas-Renderer im Neon-Look (ADR-001). ShadowBlur sparsam (M2-06: 60 fps). */
export class CanvasRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D
  private scale = 1
  private ox = 0
  private oy = 0

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
    const resize = () => {
      canvas.width = innerWidth * devicePixelRatio
      canvas.height = innerHeight * devicePixelRatio
      this.computeView()
    }
    addEventListener('resize', resize)
    resize()
  }

  private computeView(): void {
    this.scale = Math.min(innerWidth / ARENA_WIDTH, innerHeight / ARENA_HEIGHT)
    this.ox = (innerWidth - ARENA_WIDTH * this.scale) / 2
    this.oy = (innerHeight - ARENA_HEIGHT * this.scale) / 2
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.ox + x * this.scale, y: this.oy + y * this.scale }
  }

  render(state: RenderState): void {
    const { ctx } = this
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    ctx.fillStyle = '#050510'
    ctx.fillRect(0, 0, innerWidth, innerHeight)

    // Arena-Rahmen.
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)'
    ctx.lineWidth = 2
    ctx.shadowBlur = 18
    ctx.shadowColor = '#0ff'
    ctx.strokeRect(this.ox, this.oy, ARENA_WIDTH * this.scale, ARENA_HEIGHT * this.scale)
    ctx.shadowBlur = 0

    // Hindernisse.
    ctx.fillStyle = 'rgba(0, 255, 255, 0.08)'
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.6)'
    ctx.lineWidth = 1
    for (const o of OBSTACLES) {
      ctx.fillRect(this.ox + o.x * this.scale, this.oy + o.y * this.scale, o.w * this.scale, o.h * this.scale)
      ctx.strokeRect(this.ox + o.x * this.scale, this.oy + o.y * this.scale, o.w * this.scale, o.h * this.scale)
    }

    // Projektile.
    for (const pr of state.projectiles) {
      const s = this.worldToScreen(pr.x, pr.y)
      ctx.beginPath()
      ctx.arc(s.x, s.y, Math.max(2, PROJECTILE_RADIUS * this.scale), 0, Math.PI * 2)
      ctx.fillStyle = '#ff0'
      ctx.shadowBlur = 10
      ctx.shadowColor = '#ff0'
      ctx.fill()
      ctx.shadowBlur = 0
    }

    // Spieler.
    ctx.textAlign = 'center'
    for (const p of state.players) {
      if (!p.alive) continue
      const s = this.worldToScreen(p.x, p.y)
      const r = Math.max(3, PLAYER_RADIUS * this.scale)
      const own = p.id === state.ownId
      ctx.beginPath()
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
      ctx.fillStyle = own ? '#0ff' : '#f0f'
      ctx.shadowBlur = 12
      ctx.shadowColor = own ? '#0ff' : '#f0f'
      ctx.fill()
      ctx.shadowBlur = 0
      // Nickname als Canvas-Text (sicher: fillText, kein HTML).
      ctx.fillStyle = '#fff'
      ctx.font = '12px monospace'
      ctx.fillText(p.nickname, s.x, s.y + r + 14)
      // HP-Balken ueber Gegnern.
      if (p.hp < 100) {
        ctx.fillStyle = '#333'
        ctx.fillRect(s.x - r, s.y - r - 8, r * 2, 4)
        ctx.fillStyle = p.hp > 50 ? '#0f0' : '#f00'
        ctx.fillRect(s.x - r, s.y - r - 8, (r * 2 * p.hp) / 100, 4)
      }
    }
  }
}
