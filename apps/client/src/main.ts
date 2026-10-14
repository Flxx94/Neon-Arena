import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  COLOR_COUNT,
  COLOR_NAMES,
  FIRE_INTERVAL_MS,
  MODEL_COUNT,
  MODEL_NAMES,
  RESPAWN_SECONDS,
  makeSkin,
  skinColor,
  skinModel,
} from '@neon-arena/shared'
import { SoundFX } from './game/Audio.js'
import { CanvasRenderer } from './game/CanvasRenderer.js'
import { Input } from './game/Input.js'
import { TouchControls } from './game/TouchControls.js'
import { Interpolator } from './game/Interpolation.js'
import { PALETTES, SKIN_COLORS, skinTone } from './game/palette.js'
import { Prediction } from './game/Prediction.js'
import {
  NetClient,
  type ClientPickup,
  type ClientPlayer,
  type ClientProjectile,
} from './net/client.js'
import { ModelPreview } from './ui/preview.js'
import { loadProfile, saveProfile, settings, type ThemePref } from './ui/settings.js'
import { currentTheme, initTheme, toggleTheme } from './ui/theme.js'

initTheme()

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('game')
const debugEl = $<HTMLDivElement>('debug')
const joinEl = $<HTMLDivElement>('join')
const joinForm = $<HTMLFormElement>('join-card')
const nickInput = $<HTMLInputElement>('nickname')
const playBtn = $<HTMLButtonElement>('play')
const joinError = $<HTMLParagraphElement>('join-error')
const reloadBtn = $<HTMLButtonElement>('reload')
const hudEl = $<HTMLDivElement>('hud')
const vitalsEl = $<HTMLDivElement>('vitals')
const hpFill = $<HTMLDivElement>('hpfill')
const hpTrail = $<HTMLDivElement>('hptrail')
const hpNum = $<HTMLSpanElement>('hpnum')
const shieldRow = $<HTMLDivElement>('shieldrow')
const shieldFill = $<HTMLDivElement>('shieldfill')
const shieldNum = $<HTMLSpanElement>('shieldnum')
const timerBox = $<HTMLDivElement>('timerbox')
const timerEl = $<HTMLDivElement>('timer')
const muteBtn = $<HTMLButtonElement>('mute')
const themeBtn = $<HTMLButtonElement>('theme-toggle')
const settingsBtn = $<HTMLButtonElement>('settings-btn')
const settingsEl = $<HTMLDivElement>('settings')
const deadEl = $<HTMLDivElement>('dead')
const deadBy = $<HTMLParagraphElement>('dead-by')
const deadCount = $<HTMLDivElement>('dead-count')
const scoreEl = $<HTMLDivElement>('scoreboard')
const feedEl = $<HTMLDivElement>('killfeed')
const roundEl = $<HTMLDivElement>('round')
const toastEl = $<HTMLDivElement>('toast')
const debug = new URLSearchParams(location.search).has('debug')
debugEl.hidden = !debug

const renderer = new CanvasRenderer(canvas)
const input = new Input()
const touch = new TouchControls(
  $<HTMLDivElement>('stick-zone'),
  $<HTMLDivElement>('stick-knob'),
  $<HTMLDivElement>('fire-zone'),
  $<HTMLButtonElement>('fire-btn'),
)
const net = new NetClient()
const prediction = new Prediction()
const interp = new Interpolator()
const sfx = new SoundFX()

let players: ClientPlayer[] = []
let projectiles: ClientProjectile[] = []
let pickups: ClientPickup[] = []
let phase = 'play'
let winner = ''
let timeLeft = 180
let connected = false
let myNick = ''
let fps = 0
let frames = 0
let lastFpsAt = performance.now()
let lastScoreSig = ''
let streak = 0
let activity = 0
let deadAt = 0
let lastKiller = ''
let lastTimerShown = -1
let lastDeadCount = -1

// ---------------------------------------------------------------------------------------
// Einstellungen (Theme, Sound, Effekte)
// ---------------------------------------------------------------------------------------
function syncSettingsUi(): void {
  const s = settings.get()
  muteBtn.classList.toggle('is-muted', s.muted)
  muteBtn.setAttribute('aria-pressed', String(s.muted))
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-theme-pref]')) {
    b.setAttribute('aria-checked', String(b.dataset.themePref === s.theme))
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-particles]')) {
    b.setAttribute('aria-checked', String(b.dataset.particles === s.particles))
  }
  const shake = $<HTMLButtonElement>('opt-shake')
  shake.setAttribute('aria-checked', String(s.shake))
  const sfxRange = $<HTMLInputElement>('vol-sfx')
  const musicRange = $<HTMLInputElement>('vol-music')
  sfxRange.value = String(Math.round(s.sfx * 100))
  musicRange.value = String(Math.round(s.music * 100))
  sfxRange.style.setProperty('--pct', `${sfxRange.value}%`)
  musicRange.style.setProperty('--pct', `${musicRange.value}%`)
  renderer.fx.quality = s.particles
  renderer.fx.shakeEnabled = s.shake
}
settings.subscribe(syncSettingsUi)
syncSettingsUi()

themeBtn.addEventListener('click', () => {
  sfx.unlock()
  sfx.uiToggle(toggleTheme() === 'dark')
})
muteBtn.addEventListener('click', () => {
  sfx.unlock()
  sfx.toggleMute()
})

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-theme-pref]')) {
  b.addEventListener('click', () => settings.set({ theme: b.dataset.themePref as ThemePref }))
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-particles]')) {
  b.addEventListener('click', () =>
    settings.set({ particles: b.dataset.particles === 'low' ? 'low' : 'high' }),
  )
}
$<HTMLButtonElement>('opt-shake').addEventListener('click', () => {
  settings.set({ shake: !settings.get().shake })
  sfx.uiToggle(settings.get().shake)
})
$<HTMLInputElement>('vol-sfx').addEventListener('input', (e) => {
  settings.set({ sfx: Number((e.target as HTMLInputElement).value) / 100 })
})
$<HTMLInputElement>('vol-sfx').addEventListener('change', () => sfx.hitmarker())
$<HTMLInputElement>('vol-music').addEventListener('input', (e) => {
  settings.set({ music: Number((e.target as HTMLInputElement).value) / 100 })
})

const settingsClosed = (): boolean => !!settingsEl.hidden
let settingsReturnFocus: HTMLElement | null = null
function openSettings(): void {
  sfx.unlock()
  settingsReturnFocus = document.activeElement as HTMLElement | null
  settingsEl.hidden = false
  $<HTMLButtonElement>('settings-close').focus()
}
function closeSettings(): void {
  settingsEl.hidden = true
  settingsReturnFocus?.focus?.()
}
settingsBtn.addEventListener('click', () => (settingsEl.hidden ? openSettings() : closeSettings()))
$<HTMLButtonElement>('settings-close').addEventListener('click', closeSettings)
settingsEl.addEventListener('mousedown', (e) => {
  if (e.target === settingsEl) closeSettings()
})
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!settingsEl.hidden) closeSettings()
    else if (!joinEl.hidden || connected) openSettings()
    return
  }
  // Einfacher Fokus-Fang im Dialog
  if (e.key === 'Tab' && !settingsEl.hidden) {
    const f = [...settingsEl.querySelectorAll<HTMLElement>('button, input')].filter(
      (x) => !x.hidden,
    )
    if (f.length === 0) return
    const first = f[0]!
    const last = f[f.length - 1]!
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
})

// UI-Sounds per Delegation (Hover/Klick), Audio erst nach erster Geste
addEventListener('pointerdown', () => sfx.unlock(), { once: true })
document.addEventListener('pointerover', (e) => {
  const t = (e.target as Element).closest?.(
    '.btn, .icon-btn, .swatch, .seg button, .link-btn, #toplink',
  )
  if (t && !(e.relatedTarget instanceof Node && t.contains(e.relatedTarget))) sfx.uiHover()
})
document.addEventListener('click', (e) => {
  const t = (e.target as Element).closest?.('.btn, .icon-btn, .swatch, .seg button, .link-btn')
  if (t && t.id !== 'theme-toggle' && t.id !== 'opt-shake' && t.id !== 'mute') sfx.uiClick()
})

// ---------------------------------------------------------------------------------------
// Startscreen: Logo, Figurenwahl
// ---------------------------------------------------------------------------------------
function buildLogo(): void {
  const lines: [string, string, string[]][] = [
    ['logo-a', 'NEON', ['#ff5fa2', '#26d0ff', '#8dea2f', '#ffcf2e']],
    ['logo-b', 'ARENA', ['#9a6bff', '#ff8a2b', '#ff5fa2', '#26d0ff', '#8dea2f']],
  ]
  let i = 0
  for (const [id, text, colors] of lines) {
    const el = $<HTMLSpanElement>(id)
    el.replaceChildren()
    ;[...text].forEach((ch, k) => {
      const s = document.createElement('span')
      s.className = 'ch'
      s.textContent = ch
      s.style.setProperty('--i', String(i++))
      s.style.setProperty('--c', colors[k % colors.length]!)
      el.appendChild(s)
    })
  }
}
buildLogo()

const profile = loadProfile()
let model = profile.skin >= 0 ? skinModel(profile.skin) : Math.floor(Math.random() * MODEL_COUNT)
let color = profile.skin >= 0 ? skinColor(profile.skin) : Math.floor(Math.random() * COLOR_COUNT)
if (profile.nickname) nickInput.value = profile.nickname

const preview = new ModelPreview($<HTMLCanvasElement>('preview'))
const hudAvatar = new ModelPreview($<HTMLCanvasElement>('hud-avatar'), 1)
const swatchesEl = $<HTMLDivElement>('swatches')
const modelName = $<HTMLDivElement>('model-name')

function currentSkin(): number {
  return makeSkin(model, color)
}

function syncPicker(bump: boolean): void {
  preview.setSkin(currentSkin(), bump)
  modelName.textContent = MODEL_NAMES[model] ?? ''
  if (bump) {
    modelName.classList.remove('bump')
    void modelName.offsetWidth
    modelName.classList.add('bump')
  }
  swatchesEl.querySelectorAll<HTMLButtonElement>('.swatch').forEach((el, i) => {
    el.setAttribute('aria-checked', String(i === color))
    el.tabIndex = i === color ? 0 : -1
  })
}

for (let i = 0; i < COLOR_COUNT; i++) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'swatch'
  b.setAttribute('role', 'radio')
  b.setAttribute('aria-label', COLOR_NAMES[i] ?? `Farbe ${i + 1}`)
  b.title = COLOR_NAMES[i] ?? ''
  b.style.setProperty('--c', SKIN_COLORS[i]!)
  b.addEventListener('click', () => {
    color = i
    syncPicker(true)
  })
  swatchesEl.appendChild(b)
}
$<HTMLButtonElement>('model-prev').addEventListener('click', () => {
  model = (model + MODEL_COUNT - 1) % MODEL_COUNT
  syncPicker(true)
})
$<HTMLButtonElement>('model-next').addEventListener('click', () => {
  model = (model + 1) % MODEL_COUNT
  syncPicker(true)
})
$<HTMLButtonElement>('randomize').addEventListener('click', () => {
  model = Math.floor(Math.random() * MODEL_COUNT)
  color = Math.floor(Math.random() * COLOR_COUNT)
  syncPicker(true)
})
swatchesEl.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    color = (color + (e.key === 'ArrowRight' ? 1 : COLOR_COUNT - 1)) % COLOR_COUNT
    syncPicker(true)
    swatchesEl.querySelectorAll<HTMLButtonElement>('.swatch')[color]?.focus()
  }
})
addEventListener('pointermove', (e) => preview.lookAt(e.clientX, e.clientY))
syncPicker(false)

reloadBtn.addEventListener('click', () => location.reload())
joinForm.addEventListener('submit', (e) => e.preventDefault())

// ---------------------------------------------------------------------------------------
// Hilfsfunktionen HUD
// ---------------------------------------------------------------------------------------
function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function showToast(text: string, c: string): void {
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = text
  t.style.setProperty('--c', c)
  toastEl.replaceChildren(t)
  setTimeout(() => t.remove(), 1750)
}

const STREAKS: Record<number, [string, string]> = {
  2: ['Doppelkill!', '#26d0ff'],
  3: ['Dreifach!', '#8dea2f'],
  4: ['Killing Spree!', '#ff8a2b'],
  5: ['Unaufhaltsam!', '#9a6bff'],
}

function pushKill(by: string, victim: string): void {
  const line = document.createElement('div')
  line.className = 'kf'
  // Sicher: textContent, nie innerHTML (Nicknames!).
  const a = document.createElement('span')
  a.textContent = by
  const arrow = document.createElement('i')
  arrow.className = 'arrow'
  const v = document.createElement('span')
  v.textContent = victim
  line.append(a, arrow, v)
  const mine = by === myNick
  const died = victim === myNick
  if (mine) line.classList.add('mine')
  else if (died) line.classList.add('died')
  feedEl.prepend(line)
  while (feedEl.children.length > 5) feedEl.lastChild?.remove()
  setTimeout(() => {
    line.classList.add('out')
    setTimeout(() => line.remove(), 330)
  }, 5000)

  activity = Math.min(1, activity + 0.35)
  const victimPlayer = players.find((p) => p.nickname === victim)
  if (mine) {
    streak++
    sfx.killConfirm(streak)
    const pos = victimPlayer ? { x: victimPlayer.x, y: victimPlayer.y } : prediction.predicted
    renderer.fx.text(pos.x, pos.y - 34, '+100', '#ffd23f', 22)
    const s = STREAKS[Math.min(streak, 5)]
    if (s && streak >= 2) showToast(s[0], s[1])
  }
  if (died) {
    streak = 0
    lastKiller = by
  }
}

function updateDeadOverlay(own: ClientPlayer | undefined): void {
  const show = !!own && !own.alive && phase === 'play'
  if (show) {
    if (deadEl.hidden) {
      deadEl.hidden = false
      deadAt = performance.now()
      lastDeadCount = -1
      deadBy.textContent = lastKiller && lastKiller !== '?' ? `von ${lastKiller}` : ''
    }
    const left = Math.max(1, Math.ceil(RESPAWN_SECONDS - (performance.now() - deadAt) / 1000))
    if (left !== lastDeadCount) {
      lastDeadCount = left
      deadCount.textContent = String(left)
      deadCount.classList.remove('tick')
      void deadCount.offsetWidth
      deadCount.classList.add('tick')
    }
  } else if (!deadEl.hidden) {
    deadEl.hidden = true
    lastKiller = ''
  }
}

function showRoundEnd(): void {
  roundEl.hidden = false
  const card = document.createElement('div')
  card.className = 'round-card'
  const eyebrow = document.createElement('div')
  eyebrow.className = 'eyebrow'
  eyebrow.textContent = 'RUNDE VORBEI'
  const crown = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  crown.setAttribute('class', 'crown')
  crown.setAttribute('viewBox', '0 0 24 24')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z')
  crown.appendChild(path)
  const name = document.createElement('div')
  name.className = 'winner'
  name.textContent = winner || '—'
  const next = document.createElement('div')
  next.className = 'next'
  const b = document.createElement('b')
  b.id = 'next-in'
  b.textContent = String(timeLeft)
  next.append('Neue Runde in ', b, ' s')
  card.append(eyebrow, crown, name, next)
  roundEl.replaceChildren(card)
}

function onPhaseChange(prev: string, next: string): void {
  if (next === 'end') {
    showRoundEnd()
    const won = winner === myNick
    sfx.fanfare(won)
    sfx.setIntensity(0.1)
    if (won) {
      renderer.fx.confetti(ARENA_WIDTH * 0.3, ARENA_HEIGHT * 0.9, 80)
      renderer.fx.confetti(ARENA_WIDTH * 0.7, ARENA_HEIGHT * 0.9, 80)
    } else {
      renderer.fx.confetti(ARENA_WIDTH / 2, ARENA_HEIGHT * 0.95, 40)
    }
  } else if (prev === 'end') {
    roundEl.hidden = true
    showToast('Los geht’s!', '#ff5fa2')
    sfx.roundStart()
    streak = 0
  }
}

// ---------------------------------------------------------------------------------------
// Renderer-Hooks -> Sound
// ---------------------------------------------------------------------------------------
let lastImpactSfx = 0
renderer.hooks = {
  onShot: (own, x, y) => {
    if (own) return // eigener Schuss wird sofort im Input-Loop vertont (kein Netz-Lag)
    const sp = sfx.spatial(x - prediction.predicted.x, y - prediction.predicted.y)
    if (sp.gain > 0.15) sfx.shoot(sp, false)
  },
  onImpact: (x, y) => {
    const now = performance.now()
    if (now - lastImpactSfx < 45) return
    lastImpactSfx = now
    const sp = sfx.spatial(x - prediction.predicted.x, y - prediction.predicted.y)
    if (sp.gain > 0.3) sfx.impact(sp)
  },
  onHit: (own, _x, _y, _amount, byOwn) => {
    activity = Math.min(1, activity + 0.12)
    if (own) {
      sfx.hit()
      vitalsEl.classList.remove('hurt')
      void vitalsEl.offsetWidth
      vitalsEl.classList.add('hurt')
    } else if (byOwn) sfx.hitmarker()
  },
  onDeath: (own, x, y) => {
    if (own) sfx.death()
    else sfx.explosion(sfx.spatial(x - prediction.predicted.x, y - prediction.predicted.y))
  },
  onSpawn: (own) => {
    if (own) sfx.spawn()
  },
  onPickup: (kind, own) => {
    if (own) sfx.pickup(kind)
  },
}

// ---------------------------------------------------------------------------------------
// Beitreten
// ---------------------------------------------------------------------------------------
function enterIdle(): void {
  connected = false
  document.body.classList.remove('playing')
  touch.reset()
  hudEl.hidden = true
  timerBox.hidden = true
  scoreEl.hidden = true
  roundEl.hidden = true
  deadEl.hidden = true
  feedEl.replaceChildren()
  sfx.setMusic(false)
  joinEl.classList.remove('leaving')
  joinEl.hidden = false
  players = []
  projectiles = []
  pickups = []
}

playBtn.addEventListener('click', () => {
  const nickname = nickInput.value.trim()
  // Hinweis: Server validiert erneut (Zod); das hier ist nur Frueh-Feedback.
  if (!/^[a-zA-Z0-9_-]{1,16}$/.test(nickname)) {
    joinError.textContent = 'Nickname: 1–16 Zeichen, nur a-z 0-9 _ -'
    nickInput.classList.remove('invalid')
    void nickInput.offsetWidth
    nickInput.classList.add('invalid')
    sfx.unlock()
    sfx.uiError()
    return
  }
  nickInput.classList.remove('invalid')
  joinError.textContent = ''
  playBtn.disabled = true
  playBtn.textContent = 'Verbinde …'
  sfx.unlock()
  saveProfile(nickname, currentSkin())
  const skin = currentSkin()
  void net
    .join(nickname, skin, {
      onSnapshot: (snapshot) => {
        players = snapshot.players
        projectiles = snapshot.projectiles
        pickups = snapshot.pickups
        const prevPhase = phase
        phase = snapshot.phase
        winner = snapshot.winner
        timeLeft = snapshot.timeLeft
        interp.push(snapshot.at, players)
        if (phase !== prevPhase) onPhaseChange(prevPhase, phase)
        if (phase === 'end') {
          const n = document.getElementById('next-in')
          if (n) n.textContent = String(snapshot.timeLeft)
        }
        const own = players.find((p) => p.id === net.sessionId)
        if (own) prediction.reconcile(own.x, own.y, own.ackSeq)
      },
      onKill: (by, victim) => pushKill(by, victim),
      onError: (msg) => {
        if (!connected && joinEl.hidden === false) {
          joinError.textContent = msg
          playBtn.disabled = false
          playBtn.textContent = 'Spielen'
          return
        }
        enterIdle()
        joinError.textContent = msg
        playBtn.disabled = false
        playBtn.textContent = 'Spielen'
      },
    })
    .then(() => {
      connected = true
      myNick = nickname
      streak = 0
      activity = 0
      phase = 'play'
      document.body.classList.add('playing')
      joinEl.classList.add('leaving')
      setTimeout(() => {
        if (connected) joinEl.hidden = true
      }, 380)
      hudEl.hidden = false
      timerBox.hidden = false
      scoreEl.hidden = false
      hudAvatar.setSkin(skin)
      playBtn.textContent = 'Spielen'
      sfx.uiStart()
      sfx.setMusic(true)
      showToast('Viel Erfolg!', skinTone(skinColor(skin)).base)
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Join fehlgeschlagen'
      // M5-01: Version-Gate mit Reload-Hinweis.
      if (msg.includes('PROTOCOL_MISMATCH')) {
        joinError.textContent = 'Neue Version verfügbar – bitte neu laden.'
        reloadBtn.hidden = false
      } else {
        joinError.textContent = msg
      }
      sfx.uiError()
      playBtn.disabled = false
      playBtn.textContent = 'Spielen'
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

// ---------------------------------------------------------------------------------------
// Touch-Modus: automatisch auf Geraeten mit grobem Zeiger oder nach der ersten Beruehrung;
// eine echte Maus schaltet ihn auf Hybrid-Geraeten wieder ab.
// ---------------------------------------------------------------------------------------
let touchMode = false
function setTouchMode(on: boolean): void {
  if (on === touchMode) return
  touchMode = on
  document.body.classList.toggle('touch', on)
  if (!on) touch.reset()
}
const coarsePrimary = matchMedia('(pointer: coarse)')
if (coarsePrimary.matches) setTouchMode(true)
addEventListener(
  'pointerdown',
  (e) => {
    if (e.pointerType === 'touch') setTouchMode(true)
    else if (e.pointerType === 'mouse' && !coarsePrimary.matches) setTouchMode(false)
  },
  { capture: true },
)

/** Naechster lebender Gegner im Umkreis (Welt-px) fuer das Auto-Aim, sonst null. */
function nearestEnemy(from: { x: number; y: number }): ClientPlayer | null {
  let best: ClientPlayer | null = null
  let bestD = 800
  for (const p of players) {
    if (p.id === net.sessionId || !p.alive) continue
    const d = Math.hypot(p.x - from.x, p.y - from.y)
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

/** Zielrichtung: Touch = manuell (Button ziehen) > Auto-Aim > Laufrichtung; sonst Maus. */
function currentAim(): number {
  const pos = prediction.predicted
  if (touchMode) {
    if (touch.aimOverride !== null) return touch.aimOverride
    const target = nearestEnemy(pos)
    return target ? Math.atan2(target.y - pos.y, target.x - pos.x) : touch.facing
  }
  const s = renderer.worldToScreen(pos.x, pos.y)
  return Math.atan2(input.mouseY - s.y, input.mouseX - s.x)
}

// Input-Loop 30 Hz: senden + lokal vorhersagen.
let lastShootSfx = 0
setInterval(() => {
  if (!connected) return
  const { dx, dy } = touchMode && touch.moving ? touch.move : input.readMove()
  const aim = currentAim()
  const firing = (input.firing || touch.firing) && settingsClosed()
  const seq = net.sendInput(dx, dy, aim, firing)
  if (seq >= 0) {
    const now = performance.now()
    const own = players.find((p) => p.id === net.sessionId)
    if (firing && own?.alive && now - lastShootSfx > FIRE_INTERVAL_MS) {
      lastShootSfx = now
      activity = Math.min(1, activity + 0.04)
      sfx.shoot()
    }
    prediction.applyLocal({ seq, dx, dy })
  }
}, 1000 / 30)

// ---------------------------------------------------------------------------------------
// Rangliste + HUD
// ---------------------------------------------------------------------------------------
function renderScoreboard(): void {
  const sorted = [...players].sort((a, b) => b.score - a.score || b.kills - a.kills)
  const sig =
    `${net.sessionId}|` +
    sorted.map((p) => `${p.id}:${p.score}:${p.kills}:${p.deaths}:${p.skin}`).join('|')
  if (sig === lastScoreSig) return
  lastScoreSig = sig
  scoreEl.replaceChildren()
  const top = sorted.slice(0, 8)
  const ownIdx = sorted.findIndex((p) => p.id === net.sessionId)
  const rows = ownIdx >= 8 ? [...top, sorted[ownIdx]!] : top
  rows.forEach((p) => {
    const rank = sorted.indexOf(p) + 1
    const row = document.createElement('div')
    row.className = 'sb-row'
    if (p.id === net.sessionId) row.classList.add('me')
    const r = document.createElement('span')
    r.className = 'sb-rank'
    r.textContent = String(rank)
    const dot = document.createElement('span')
    dot.className = 'sb-dot'
    dot.style.setProperty('--c', SKIN_COLORS[skinColor(p.skin)]!)
    const name = document.createElement('span')
    name.className = 'sb-name'
    name.textContent = p.nickname
    if (p.isBot) {
      const tag = document.createElement('small')
      tag.textContent = 'BOT'
      name.appendChild(tag)
    }
    const score = document.createElement('span')
    score.className = 'sb-score'
    score.textContent = String(p.score)
    row.append(r, dot, name, score)
    scoreEl.appendChild(row)
  })
}

function updateHud(own: ClientPlayer | undefined): void {
  if (own) {
    const hp = Math.max(0, Math.round(own.hp))
    hpNum.textContent = String(hp)
    hpFill.style.width = `${hp}%`
    hpTrail.style.width = `${hp}%`
    hpFill.style.setProperty(
      '--hp',
      hp > 50 ? 'var(--good)' : hp > 25 ? 'var(--warn)' : 'var(--bad)',
    )
    vitalsEl.classList.toggle('low', hp <= 25 && own.alive)
    const sh = Math.round(own.shield)
    shieldFill.style.width = `${Math.min(100, (sh / 50) * 100)}%`
    shieldNum.textContent = String(sh)
    shieldRow.classList.toggle('empty', sh <= 0)
  }
  const shown = Math.max(0, Math.floor(timeLeft))
  if (shown !== lastTimerShown) {
    lastTimerShown = shown
    timerEl.textContent = fmtTime(shown)
    const urgent = phase === 'play' && shown <= 10 && shown > 0
    timerBox.classList.toggle('urgent', urgent)
    if (urgent) sfx.tick(shown <= 3)
  }
}

// ---------------------------------------------------------------------------------------
// Render-Loop 60 fps
// ---------------------------------------------------------------------------------------
let idleSparkAt = 0
function frame() {
  frames++
  const now = performance.now()
  if (now - lastFpsAt >= 500) {
    fps = Math.round((frames * 1000) / (now - lastFpsAt))
    frames = 0
    lastFpsAt = now
    if (debug) {
      debugEl.textContent = `fps ${fps} · spieler ${players.length} · pending ${prediction.pendingCount} · fx ${renderer.fx.count} · ${ARENA_WIDTH}x${ARENA_HEIGHT}`
    }
  }

  if (!connected) {
    // Menue-Hintergrund: leere Arena mit gelegentlichem Funkeln.
    if (now - idleSparkAt > 1100) {
      idleSparkAt = now
      const pal = PALETTES[currentTheme()]
      const cols = [
        pal.walls.bunker.top,
        pal.walls.wall.top,
        pal.walls.pillar.top,
        pal.walls.barricade.top,
      ]
      renderer.fx.spawn(
        120 + Math.random() * (ARENA_WIDTH - 240),
        120 + Math.random() * (ARENA_HEIGHT - 240),
        cols[Math.floor(Math.random() * cols.length)]!,
      )
    }
    renderer.renderIdle()
    requestAnimationFrame(frame)
    return
  }

  // Eigene Position predicted (M2-05), Gegner interpoliert (M3-05).
  const ownId = net.sessionId
  const liveAim = currentAim()
  const rendered = players.map((p) => {
    if (p.id === ownId)
      return { ...p, x: prediction.predicted.x, y: prediction.predicted.y, aim: liveAim }
    const interpPos = interp.sample(p.id, now)
    return interpPos ? { ...p, x: interpPos.x, y: interpPos.y } : p
  })
  renderer.render({
    players: rendered,
    projectiles,
    pickups,
    ownId,
    mouse: { x: input.mouseX, y: input.mouseY },
    crosshair: settingsClosed() && !touchMode,
  })
  renderScoreboard()

  const own = players.find((p) => p.id === ownId)
  updateHud(own)
  updateDeadOverlay(own)

  // Musik-Intensitaet: Aktivitaet klingt ab, letzte 30 s + Gefahr treiben hoch.
  activity = Math.max(0, activity - 0.0045)
  const endgame = phase === 'play' && timeLeft <= 30 ? 0.25 : 0
  const danger = own && own.alive && own.hp <= 35 ? 0.2 : 0
  sfx.setIntensity(phase === 'end' ? 0.1 : 0.25 + activity * 0.5 + endgame + danger)

  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
