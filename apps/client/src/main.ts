import { ARENA_HEIGHT, ARENA_WIDTH } from '@neon-arena/shared'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const debugEl = document.getElementById('debug') as HTMLDivElement
const debug = new URLSearchParams(location.search).has('debug')
debugEl.hidden = !debug

function resize() {
  canvas.width = innerWidth * devicePixelRatio
  canvas.height = innerHeight * devicePixelRatio
}
addEventListener('resize', resize)
resize()

let frames = 0
let lastFpsAt = performance.now()
let fps = 0

// M0-Platzhalter: pulsierendes Arena-Rechteck, bis M2 Renderer/Entities landen.
function frame(t: number) {
  frames++
  const now = performance.now()
  if (now - lastFpsAt >= 500) {
    fps = Math.round((frames * 1000) / (now - lastFpsAt))
    frames = 0
    lastFpsAt = now
    if (debug) debugEl.textContent = `fps ${fps} · rtt - · tick - · ${ARENA_WIDTH}x${ARENA_HEIGHT}`
  }
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  ctx.fillStyle = '#050510'
  ctx.fillRect(0, 0, innerWidth, innerHeight)
  const pulse = 0.5 + 0.5 * Math.sin(t / 500)
  ctx.strokeStyle = `rgba(0, 255, 255, ${0.4 + 0.4 * pulse})`
  ctx.lineWidth = 2
  ctx.shadowBlur = 18
  ctx.shadowColor = '#0ff'
  const w = Math.min(innerWidth - 40, (ARENA_WIDTH / ARENA_HEIGHT) * (innerHeight - 40))
  const h = (w * ARENA_HEIGHT) / ARENA_WIDTH
  ctx.strokeRect((innerWidth - w) / 2, (innerHeight - h) / 2, w, h)
  ctx.shadowBlur = 0
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
