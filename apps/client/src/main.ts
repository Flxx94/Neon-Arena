import { ARENA_HEIGHT, ARENA_WIDTH } from '@neon-arena/shared'
import { SoundFX } from './game/Audio.js'
import { CanvasRenderer } from './game/CanvasRenderer.js'
import { Input } from './game/Input.js'
import { Prediction } from './game/Prediction.js'
import { NetClient, type ClientPlayer, type ClientProjectile } from './net/client.js'

const canvas = document.getElementById('game') as HTMLCanvasElement
const debugEl = document.getElementById('debug') as HTMLDivElement
const joinEl = document.getElementById('join') as HTMLDivElement
const nickInput = document.getElementById('nickname') as HTMLInputElement
const playBtn = document.getElementById('play') as HTMLButtonElement
const joinError = document.getElementById('join-error') as HTMLParagraphElement
const hudEl = document.getElementById('hud') as HTMLDivElement
const hpFill = document.getElementById('hpfill') as HTMLDivElement
const muteBtn = document.getElementById('mute') as HTMLButtonElement
const deadEl = document.getElementById('dead') as HTMLDivElement
const debug = new URLSearchParams(location.search).has('debug')
debugEl.hidden = !debug

const renderer = new CanvasRenderer(canvas)
const input = new Input()
const net = new NetClient()
const prediction = new Prediction()
const sfx = new SoundFX()

let players: ClientPlayer[] = []
let projectiles: ClientProjectile[] = []
let connected = false
let fps = 0
let frames = 0
let lastFpsAt = performance.now()
let lastHp = 100
let lastAlive = true
let lastHpShown = -1

muteBtn.addEventListener('click', () => {
  muteBtn.textContent = sfx.toggleMute() ? '🔇' : '🔊'
})

playBtn.addEventListener('click', () => {
  const nickname = nickInput.value.trim()
  // Hinweis: Server validiert erneut (Zod); das hier ist nur Frueh-Feedback.
  if (!/^[a-zA-Z0-9_-]{1,16}$/.test(nickname)) {
    joinError.textContent = 'Nickname: 1–16 Zeichen, nur a-z 0-9 _ -'
    return
  }
  joinError.textContent = ''
  playBtn.disabled = true
  sfx.unlock()
  void net
    .join(nickname, {
      onSnapshot: (snapshot) => {
        players = snapshot.players
        projectiles = snapshot.projectiles
        const own = players.find((p) => p.id === net.sessionId)
        if (own) {
          if (own.hp < lastHp) sfx.hit()
          if (lastAlive && !own.alive) sfx.death()
          lastHp = own.hp
          lastAlive = own.alive
          prediction.reconcile(own.x, own.y, own.ackSeq)
        }
      },
      onError: (msg) => {
        joinError.textContent = msg
        playBtn.disabled = false
        connected = false
        joinEl.hidden = false
        hudEl.hidden = true
      },
    })
    .then(() => {
      connected = true
      joinEl.hidden = true
      hudEl.hidden = false
      lastHp = 100
      lastAlive = true
    })
    .catch((err: unknown) => {
      joinError.textContent = err instanceof Error ? err.message : 'Join fehlgeschlagen'
      playBtn.disabled = false
    })
})

// Test-Hook fuer Playwright: nur lesender Zugriff.
window.__arena = {
  players: () => players,
  projectiles: () => projectiles,
  connected: () => connected,
}

declare global {
  interface Window {
    __arena: {
      players: () => ClientPlayer[]
      projectiles: () => ClientProjectile[]
      connected: () => boolean
    }
  }
}

// Input-Loop 30 Hz: senden + lokal vorhersagen.
let lastShootSfx = 0
setInterval(() => {
  if (!connected) return
  const { dx, dy } = input.readMove()
  const ownScreen = renderer.worldToScreen(prediction.predicted.x, prediction.predicted.y)
  const aim = Math.atan2(input.mouseY - ownScreen.y, input.mouseX - ownScreen.x)
  const seq = net.sendInput(dx, dy, aim, input.firing)
  if (seq >= 0) {
    const now = performance.now()
    if (input.firing && now - lastShootSfx > 240) {
      lastShootSfx = now
      sfx.shoot()
    }
    prediction.applyLocal({ seq, dx, dy })
  }
}, 1000 / 30)

// Render-Loop 60 fps.
function frame() {
  frames++
  const now = performance.now()
  if (now - lastFpsAt >= 500) {
    fps = Math.round((frames * 1000) / (now - lastFpsAt))
    frames = 0
    lastFpsAt = now
    if (debug) {
      debugEl.textContent = `fps ${fps} · spieler ${players.length} · pending ${prediction.pendingCount} · ${ARENA_WIDTH}x${ARENA_HEIGHT}`
    }
  }

  // Eigene Position aus Prediction ueberschreiben (M2-05).
  const ownId = net.sessionId
  const rendered = players.map((p) =>
    p.id === ownId ? { ...p, x: prediction.predicted.x, y: prediction.predicted.y } : p,
  )
  renderer.render({ players: rendered, projectiles, ownId })

  // HUD: HP + Tod.
  const own = players.find((p) => p.id === ownId)
  if (own) {
    if (own.hp !== lastHpShown) {
      lastHpShown = own.hp
      hpFill.style.width = `${own.hp}%`
      hpFill.style.background = own.hp > 50 ? '#0f0' : own.hp > 25 ? '#ff0' : '#f00'
    }
    deadEl.hidden = own.alive
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
