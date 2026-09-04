import { ARENA_HEIGHT, ARENA_WIDTH } from '@neon-arena/shared'
import { SoundFX } from './game/Audio.js'
import { CanvasRenderer } from './game/CanvasRenderer.js'
import { Input } from './game/Input.js'
import { Interpolator } from './game/Interpolation.js'
import { Prediction } from './game/Prediction.js'
import { NetClient, type ClientPickup, type ClientPlayer, type ClientProjectile } from './net/client.js'

const canvas = document.getElementById('game') as HTMLCanvasElement
const debugEl = document.getElementById('debug') as HTMLDivElement
const joinEl = document.getElementById('join') as HTMLDivElement
const nickInput = document.getElementById('nickname') as HTMLInputElement
const playBtn = document.getElementById('play') as HTMLButtonElement
const joinError = document.getElementById('join-error') as HTMLParagraphElement
const hudEl = document.getElementById('hud') as HTMLDivElement
const hpFill = document.getElementById('hpfill') as HTMLDivElement
const timerEl = document.getElementById('timer') as HTMLDivElement
const muteBtn = document.getElementById('mute') as HTMLButtonElement
const deadEl = document.getElementById('dead') as HTMLDivElement
const scoreEl = document.getElementById('scoreboard') as HTMLDivElement
const feedEl = document.getElementById('killfeed') as HTMLDivElement
const roundEl = document.getElementById('round') as HTMLDivElement
const debug = new URLSearchParams(location.search).has('debug')
debugEl.hidden = !debug

const renderer = new CanvasRenderer(canvas)
const input = new Input()
const net = new NetClient()
const prediction = new Prediction()
const interp = new Interpolator()
const sfx = new SoundFX()

let players: ClientPlayer[] = []
let projectiles: ClientProjectile[] = []
let pickups: ClientPickup[] = []
let phase = 'play'
let winner = ''
let connected = false
let fps = 0
let frames = 0
let lastFpsAt = performance.now()
let lastHp = 100
let lastAlive = true
let lastHpShown = -1
let lastScoreSig = ''
let lastTimerShown = ''

muteBtn.addEventListener('click', () => {
  muteBtn.textContent = sfx.toggleMute() ? '🔇' : '🔊'
})

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function pushKill(by: string, victim: string): void {
  const line = document.createElement('div')
  // Sicher: textContent, nie innerHTML (Nicknames!).
  line.textContent = `${by} ▸ ${victim}`
  feedEl.prepend(line)
  while (feedEl.children.length > 5) feedEl.lastChild?.remove()
  setTimeout(() => line.remove(), 5000)
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
  sfx.unlock()
  void net
    .join(nickname, {
      onSnapshot: (snapshot) => {
        players = snapshot.players
        projectiles = snapshot.projectiles
        pickups = snapshot.pickups
        phase = snapshot.phase
        winner = snapshot.winner
        timerEl.textContent = fmtTime(snapshot.timeLeft)
        interp.push(snapshot.at, players)
        const own = players.find((p) => p.id === net.sessionId)
        if (own) {
          if (own.hp < lastHp) sfx.hit()
          if (lastAlive && !own.alive) sfx.death()
          lastHp = own.hp
          lastAlive = own.alive
          prediction.reconcile(own.x, own.y, own.ackSeq)
        }
      },
      onKill: (by, victim) => pushKill(by, victim),
      onError: (msg) => {
        joinError.textContent = msg
        playBtn.disabled = false
        connected = false
        joinEl.hidden = false
        hudEl.hidden = true
        scoreEl.hidden = true
      },
    })
    .then(() => {
      connected = true
      joinEl.hidden = true
      hudEl.hidden = false
      scoreEl.hidden = false
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

function renderScoreboard(): void {
  const sorted = [...players].sort((a, b) => b.score - a.score || b.kills - a.kills)
  const sig = sorted.map((p) => `${p.id}:${p.score}:${p.kills}:${p.deaths}`).join('|')
  if (sig === lastScoreSig) return
  lastScoreSig = sig
  scoreEl.replaceChildren()
  for (const p of sorted.slice(0, 12)) {
    const row = document.createElement('div')
    row.textContent = `${p.nickname} ${p.score} (${p.kills}/${p.deaths})`
    if (p.id === net.sessionId) row.style.fontWeight = 'bold'
    scoreEl.appendChild(row)
  }
}

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

  // Eigene Position predicted (M2-05), Gegner interpoliert (M3-05).
  const ownId = net.sessionId
  const rendered = players.map((p) => {
    if (p.id === ownId) return { ...p, x: prediction.predicted.x, y: prediction.predicted.y }
    const interpPos = interp.sample(p.id, now)
    return interpPos ? { ...p, x: interpPos.x, y: interpPos.y } : p
  })
  renderer.render({ players: rendered, projectiles, pickups, ownId })
  renderScoreboard()

  // HUD: HP + Tod + Runde.
  const own = players.find((p) => p.id === ownId)
  if (own) {
    if (own.hp !== lastHpShown) {
      lastHpShown = own.hp
      hpFill.style.width = `${own.hp}%`
      hpFill.style.background = own.hp > 50 ? '#0f0' : own.hp > 25 ? '#ff0' : '#f00'
    }
    deadEl.hidden = own.alive || phase !== 'play'
  }
  const timerText = phase === 'play' ? null : `🏆 ${winner}`
  if (timerText && lastTimerShown !== timerText) {
    lastTimerShown = timerText
    roundEl.textContent = timerText
    roundEl.hidden = false
  } else if (!timerText && !roundEl.hidden) {
    lastTimerShown = ''
    roundEl.hidden = true
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
