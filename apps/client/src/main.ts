import { ARENA_HEIGHT, ARENA_WIDTH, PLAYER_RADIUS } from '@neon-arena/shared'
import { INPUT_HZ, NetClient } from './net/client.js'
import type { ClientPlayer } from './net/client.js'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const debugEl = document.getElementById('debug') as HTMLDivElement
const joinEl = document.getElementById('join') as HTMLDivElement
const nickInput = document.getElementById('nickname') as HTMLInputElement
const playBtn = document.getElementById('play') as HTMLButtonElement
const joinError = document.getElementById('join-error') as HTMLParagraphElement
const debug = new URLSearchParams(location.search).has('debug')
debugEl.hidden = !debug

function resize() {
  canvas.width = innerWidth * devicePixelRatio
  canvas.height = innerHeight * devicePixelRatio
}
addEventListener('resize', resize)
resize()

const net = new NetClient()
let players: ClientPlayer[] = []
let connected = false
let fps = 0
let frames = 0
let lastFpsAt = performance.now()

// WASD-Status + Maus-Aim (M1: direkt als Input, Prediction erst M2).
const keys = new Set<string>()
addEventListener('keydown', (e) => keys.add(e.code))
addEventListener('keyup', (e) => keys.delete(e.code))
let mouseX = innerWidth / 2
let mouseY = innerHeight / 2
addEventListener('mousemove', (e) => {
  mouseX = e.clientX
  mouseY = e.clientY
})

function readMove(): { dx: number; dy: number } {
  const dx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
  const dy = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0)
  if (dx !== 0 && dy !== 0) return { dx: dx / Math.SQRT2, dy: dy / Math.SQRT2 }
  return { dx, dy }
}

playBtn.addEventListener('click', () => {
  const nickname = nickInput.value.trim()
  // Hinweis: Server validiert erneut (Zod); das hier ist nur Frueh-Feedback.
  if (!/^[a-zA-Z0-9_-]{1,16}$/.test(nickname)) {
    joinError.textContent = 'Nickname: 1–16 Zeichen, nur a-z 0-9 _ -'
    return
  }
  joinError.textContent = ''
  playBtn.disabled = true
  void net
    .join(nickname, {
      onPlayers: (p) => {
        players = p
      },
      onError: (msg) => {
        joinError.textContent = msg
        playBtn.disabled = false
        connected = false
        joinEl.hidden = false
      },
    })
    .then(() => {
      connected = true
      joinEl.hidden = true
    })
    .catch((err: unknown) => {
      joinError.textContent = err instanceof Error ? err.message : 'Join fehlgeschlagen'
      playBtn.disabled = false
    })
})

// Test-Hook fuer Playwright (M1-05): nur lesender Zugriff auf Spielerliste/Status.
window.__arena = {
  players: () => players,
  connected: () => connected,
}

declare global {
  interface Window {
    __arena: { players: () => ClientPlayer[]; connected: () => boolean }
  }
}

// Input-Loop 30 Hz.
setInterval(() => {
  if (!connected) return
  const { dx, dy } = readMove()
  const aim = Math.atan2(mouseY - innerHeight / 2, mouseX - innerWidth / 2)
  net.sendInput(dx, dy, aim, false)
}, 1000 / INPUT_HZ)

// Render-Loop 60 fps: Server-State direkt (Interpolation erst M3).
function frame() {
  frames++
  const now = performance.now()
  if (now - lastFpsAt >= 500) {
    fps = Math.round((frames * 1000) / (now - lastFpsAt))
    frames = 0
    lastFpsAt = now
    if (debug) debugEl.textContent = `fps ${fps} · spieler ${players.length} · ${ARENA_WIDTH}x${ARENA_HEIGHT}`
  }
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  ctx.fillStyle = '#050510'
  ctx.fillRect(0, 0, innerWidth, innerHeight)

  const scale = Math.min(innerWidth / ARENA_WIDTH, innerHeight / ARENA_HEIGHT)
  const ox = (innerWidth - ARENA_WIDTH * scale) / 2
  const oy = (innerHeight - ARENA_HEIGHT * scale) / 2
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)'
  ctx.lineWidth = 2
  ctx.shadowBlur = 18
  ctx.shadowColor = '#0ff'
  ctx.strokeRect(ox, oy, ARENA_WIDTH * scale, ARENA_HEIGHT * scale)
  ctx.shadowBlur = 0

  const ownId = net.sessionId
  for (const p of players) {
    const x = ox + p.x * scale
    const y = oy + p.y * scale
    const r = Math.max(3, PLAYER_RADIUS * scale)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = p.id === ownId ? '#0ff' : '#f0f'
    ctx.shadowBlur = 12
    ctx.shadowColor = p.id === ownId ? '#0ff' : '#f0f'
    ctx.fill()
    ctx.shadowBlur = 0
    // Nickname als Canvas-Text (sicher: fillText, kein HTML).
    ctx.fillStyle = '#fff'
    ctx.font = '12px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(p.nickname, x, y + r + 14)
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
