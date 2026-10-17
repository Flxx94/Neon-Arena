import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  COLOR_COUNT,
  COLOR_NAMES,
  TICK_RATE,
  CLASSES,
  ROLE_LABELS,
  classDps,
  classOf,
  classRange,
  MODEL_COUNT,
  MODEL_NAMES,
  RESPAWN_SECONDS,
  makeSkin,
  skinColor,
  skinModel,
  ULT_MAX,
  effectiveSpeed,
  isFlying,
  ultTargetScore,
  MAP_COUNT,
  mapOf,
} from '@neon-arena/shared'
import { SoundFX } from './game/Audio.js'
import { CanvasRenderer, frameTime } from './game/CanvasRenderer.js'
import { Input } from './game/Input.js'
import { TouchControls } from './game/TouchControls.js'
import { UltControl, type UltRelease } from './game/UltControl.js'
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
import {
  AuthError,
  fetchMe,
  guestLogin,
  login,
  logout,
  register,
  saveSkin,
  type Identity,
} from './net/auth.js'
import { currentTheme, initTheme, toggleTheme } from './ui/theme.js'

initTheme()

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('game')
const debugEl = $<HTMLDivElement>('debug')
const joinEl = $<HTMLDivElement>('join')
const joinForm = $<HTMLFormElement>('join-card')
const authForm = $<HTMLFormElement>('auth-card')
const authTabs = $<HTMLDivElement>('auth-tabs')
const authEmail = $<HTMLInputElement>('auth-email')
const authNick = $<HTMLInputElement>('auth-nickname')
const authPass = $<HTMLInputElement>('auth-password')
const authHint = $<HTMLParagraphElement>('auth-hint')
const authError = $<HTMLParagraphElement>('auth-error')
const authSubmit = $<HTMLButtonElement>('auth-submit')
const authReload = $<HTMLButtonElement>('auth-reload')
const bootEl = $<HTMLParagraphElement>('boot')
const lobbyName = $<HTMLSpanElement>('lobby-name')
const lobbyBadge = $<HTMLSpanElement>('lobby-badge')
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
const deadPreview = new ModelPreview($<HTMLCanvasElement>('dead-preview'), 1)
const deadModelName = $<HTMLElement>('dead-model')
const deadRole = $<HTMLElement>('dead-role')
const deadUlt = $<HTMLElement>('dead-ult')
const ultBtn = $<HTMLButtonElement>('ult')
const ultNameEl = $<HTMLSpanElement>('ult-name')
const ultKeyEl = $<HTMLSpanElement>('ult-key')
const scoreEl = $<HTMLDivElement>('scoreboard')
const feedEl = $<HTMLDivElement>('killfeed')
const roundEl = $<HTMLDivElement>('round')
const toastEl = $<HTMLDivElement>('toast')
const debug = new URLSearchParams(location.search).has('debug')
debugEl.hidden = !debug

const renderer = new CanvasRenderer(canvas)
// Menue-Hintergrund zeigt eine zufaellige Karte; im Spiel bestimmt der Server die Karte.
renderer.setMap(Math.floor(Math.random() * MAP_COUNT))
const input = new Input()
const touch = new TouchControls(
  $<HTMLDivElement>('stick-zone'),
  $<HTMLDivElement>('stick-knob'),
  $<HTMLDivElement>('aim-zone'),
  $<HTMLDivElement>('aim-knob'),
)
const net = new NetClient()
const prediction = new Prediction()
const interp = new Interpolator()
const sfx = new SoundFX()

let players: ClientPlayer[] = []
let projectiles: ClientProjectile[] = []
let pickups: ClientPickup[] = []
let phase = 'play'
let mapId = 0
let mapAnnounced = false
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

const preview = new ModelPreview($<HTMLCanvasElement>('preview'))
const hudAvatar = new ModelPreview($<HTMLCanvasElement>('hud-avatar'), 1)
const swatchesEl = $<HTMLDivElement>('swatches')
const modelName = $<HTMLDivElement>('model-name')

function currentSkin(): number {
  return makeSkin(model, color)
}

// Lobby: Klassen-Info (Rolle, Attacke, Beschreibung, Wertebalken). Aufbau einmalig, Update je Wechsel.
const classInfo = $<HTMLDivElement>('class-info')
const roleBadge = $<HTMLSpanElement>('role-badge')
const attackName = $<HTMLSpanElement>('attack-name')
const classDesc = $<HTMLParagraphElement>('class-desc')
const classUlt = $<HTMLParagraphElement>('class-ult')
const statsEl = $<HTMLDListElement>('class-stats')
const STAT_DEFS: { label: string; get: (c: (typeof CLASSES)[number]) => number }[] = [
  { label: 'Leben', get: (c) => c.hp },
  { label: 'Tempo', get: (c) => c.speed },
  { label: 'Schaden/s', get: (c) => classDps(c) },
  { label: 'Reichweite', get: (c) => classRange(c) },
]
const statRows = STAT_DEFS.map((def) => {
  const row = document.createElement('div')
  row.className = 'stat'
  const dt = document.createElement('dt')
  dt.textContent = def.label
  const bar = document.createElement('dd')
  const fill = document.createElement('i')
  bar.appendChild(fill)
  const num = document.createElement('b')
  row.append(dt, bar, num)
  statsEl.appendChild(row)
  const max = Math.max(...CLASSES.map(def.get))
  return { def, fill, num, max }
})

function syncClassInfo(): void {
  const c = CLASSES[model]
  if (!c) return
  classInfo.dataset.role = c.role
  roleBadge.textContent = ROLE_LABELS[c.role]
  attackName.textContent = c.attack
  classDesc.textContent = c.description
  classUlt.textContent = `Ult · ${c.ult.name}: ${c.ult.description}`
  for (const { def, fill, num, max } of statRows) {
    const v = def.get(c)
    fill.style.setProperty('--v', String(Math.max(0.08, v / max)))
    num.textContent = String(Math.round(v))
  }
}

let skinSaveTimer: number | undefined
/** Lobby-Look nach kurzer Pause am Konto/der Session speichern (nicht bei jedem Klick). */
function persistLook(): void {
  if (!identity) return
  window.clearTimeout(skinSaveTimer)
  skinSaveTimer = window.setTimeout(() => {
    saveProfile(identity?.nickname ?? '', currentSkin())
    void saveSkin(currentSkin())
  }, 500)
}

function syncPicker(bump: boolean): void {
  if (bump) persistLook()
  preview.setSkin(currentSkin(), bump)
  modelName.textContent = MODEL_NAMES[model] ?? ''
  syncClassInfo()
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
authReload.addEventListener('click', () => location.reload())
joinForm.addEventListener('submit', (e) => e.preventDefault())

// ---------------------------------------------------------------------------------------
// Zugang: Anmelden / Registrieren / Gast  ->  Lobby
// ---------------------------------------------------------------------------------------
type AuthMode = 'login' | 'register' | 'guest'
let identity: Identity | null = null
let authMode: AuthMode = 'login'

const MODE_TEXT: Record<AuthMode, { submit: string; hint: string }> = {
  login: { submit: 'Anmelden', hint: '' },
  register: {
    submit: 'Konto erstellen',
    hint: 'Dein Look und dein Name werden an dein Konto gebunden.',
  },
  guest: {
    submit: 'Als Gast starten',
    hint: 'Ohne Konto: Dein Fortschritt wird nicht dauerhaft gespeichert.',
  },
}

function setAuthMode(mode: AuthMode): void {
  authMode = mode
  authTabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.mode === mode))
  })
  authForm.querySelectorAll<HTMLElement>('[data-for]').forEach((el) => {
    el.hidden = !(el.dataset.for ?? '').split(' ').includes(mode)
  })
  authSubmit.textContent = MODE_TEXT[mode].submit
  authHint.textContent = MODE_TEXT[mode].hint
  authPass.autocomplete = mode === 'register' ? 'new-password' : 'current-password'
  authError.textContent = ''
  authForm.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'))
}

function flagInvalid(el: HTMLInputElement, message: string): void {
  authError.textContent = message
  el.classList.remove('invalid')
  void el.offsetWidth
  el.classList.add('invalid')
  el.focus()
  sfx.unlock()
  sfx.uiError()
}

type View = 'boot' | 'auth' | 'lobby'
function showView(view: View): void {
  bootEl.hidden = view !== 'boot'
  authForm.hidden = view !== 'auth'
  joinForm.hidden = view !== 'lobby'
  if (view === 'auth') (authMode === 'guest' ? authNick : authEmail).focus({ preventScroll: true })
}

/** Lobby mit der Identitaet befuellen (Name, Konto/Gast-Badge, gespeicherter Look). */
function enterLobby(who: Identity, restoreLook: boolean): void {
  identity = who
  lobbyName.textContent = who.nickname
  lobbyBadge.textContent = who.isGuest ? 'Gast' : 'Konto'
  lobbyBadge.classList.toggle('guest', who.isGuest)
  if (restoreLook && !who.isGuest) {
    model = skinModel(who.skin)
    color = skinColor(who.skin)
    syncPicker(false)
  }
  joinError.textContent = ''
  showView('lobby')
}

function backToAuth(message = ''): void {
  identity = null
  authPass.value = ''
  authError.textContent = message
  showView('auth')
}

authTabs.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]')
  if (b) setAuthMode(b.dataset.mode as AuthMode)
})

authForm.addEventListener('submit', (e) => {
  e.preventDefault()
  const email = authEmail.value.trim()
  const nickname = authNick.value.trim()
  const password = authPass.value
  // Fruehes Feedback; der Server validiert erneut (Zod).
  if (authMode !== 'guest') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      flagInvalid(authEmail, 'Bitte eine gültige E-Mail-Adresse eingeben.')
      return
    }
    if (password.length < (authMode === 'register' ? 8 : 1)) {
      flagInvalid(
        authPass,
        authMode === 'register' ? 'Das Passwort braucht mindestens 8 Zeichen.' : 'Bitte Passwort eingeben.',
      )
      return
    }
  }
  if (authMode !== 'login' && !/^[a-zA-Z0-9_-]{1,16}$/.test(nickname)) {
    flagInvalid(authNick, 'Spielername: 1–16 Zeichen, nur a-z 0-9 _ -')
    return
  }
  authError.textContent = ''
  authSubmit.disabled = true
  const label = authSubmit.textContent
  authSubmit.textContent = 'Einen Moment …'
  sfx.unlock()
  const request =
    authMode === 'login'
      ? login(email, password)
      : authMode === 'register'
        ? register(email, password, nickname)
        : guestLogin(nickname)
  void request
    .then((who) => {
      authPass.value = ''
      if (authMode === 'register') {
        // Neues Konto: mit zufaelligem Look starten und ihn gleich am Konto merken.
        model = Math.floor(Math.random() * MODEL_COUNT)
        color = Math.floor(Math.random() * COLOR_COUNT)
        syncPicker(false)
        void saveSkin(currentSkin())
        enterLobby(who, false)
      } else if (authMode === 'guest') {
        const saved = loadProfile().skin
        if (saved >= 0) {
          model = skinModel(saved)
          color = skinColor(saved)
          syncPicker(false)
        }
        enterLobby(who, false)
      } else {
        enterLobby(who, true)
      }
      sfx.uiStart()
    })
    .catch((err: unknown) => {
      const msg = err instanceof AuthError ? err.message : 'Anmeldung fehlgeschlagen.'
      authError.textContent = msg
      if (err instanceof AuthError && err.code === 'EMAIL_TAKEN') setAuthMode('login')
      authError.textContent = msg
      sfx.uiError()
    })
    .finally(() => {
      authSubmit.disabled = false
      authSubmit.textContent = authMode === 'login' ? MODE_TEXT.login.submit : label
    })
})

$<HTMLButtonElement>('logout').addEventListener('click', () => {
  window.clearTimeout(skinSaveTimer)
  void saveSkin(currentSkin()).then(() => logout())
  backToAuth()
})

// Start: besteht noch eine Session (Cookie)? -> direkt in die Lobby, sonst Login.
setAuthMode('login')
showView('boot')
const slowBoot = window.setTimeout(() => {
  bootEl.textContent = 'Server wacht auf … das kann kurz dauern'
}, 3500)
void fetchMe().then((me) => {
  window.clearTimeout(slowBoot)
  if (me.state === 'ok') {
    enterLobby(me.identity, true)
  } else {
    showView('auth')
    if (me.state === 'offline') {
      authError.textContent = 'Server nicht erreichbar – bitte später erneut versuchen.'
    }
  }
})

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

/** Charakterwechsel waehrend man tot ist: wirkt ab dem naechsten Respawn (Server uebernimmt Klasse). */
function syncDeadPicker(): void {
  const c = CLASSES[model]
  if (!c) return
  deadPreview.setSkin(currentSkin(), true)
  deadModelName.textContent = MODEL_NAMES[model] ?? ''
  deadRole.textContent = ROLE_LABELS[c.role]
  deadRole.dataset.role = c.role
  deadUlt.textContent = `${c.attack} · Ult: ${c.ult.name}`
}
function changeCharacter(step: number): void {
  model = (model + step + MODEL_COUNT) % MODEL_COUNT
  net.changeSkin(currentSkin())
  hudAvatar.setSkin(currentSkin())
  syncPicker(true) // Lobby-Anzeige + Speichern am Konto
  syncDeadPicker()
  sfx.uiStart()
}
$<HTMLButtonElement>('dead-prev').addEventListener('click', () => changeCharacter(-1))
$<HTMLButtonElement>('dead-next').addEventListener('click', () => changeCharacter(1))

function updateDeadOverlay(own: ClientPlayer | undefined): void {
  const show = !!own && !own.alive && phase === 'play'
  if (show) {
    if (deadEl.hidden) {
      deadEl.hidden = false
      deadAt = performance.now()
      lastDeadCount = -1
      if (own) {
        model = skinModel(own.skin)
        color = skinColor(own.skin)
      }
      syncDeadPicker()
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
    // Konfetti am unteren Bildschirmrand (Kamera folgt dem Spieler, Arena ist groesser als der Ausschnitt).
    const { x: px, y: py } = prediction.predicted
    const low = py + 320
    if (won) {
      renderer.fx.confetti(px - 420, low, 80)
      renderer.fx.confetti(px + 420, low, 80)
    } else {
      renderer.fx.confetti(px, low, 40)
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
  onShot: (own, x, y, kind) => {
    if (own) return // eigener Schuss wird sofort im Input-Loop vertont (kein Netz-Lag)
    const sp = sfx.spatial(x - prediction.predicted.x, y - prediction.predicted.y)
    if (sp.gain > 0.15) sfx.shoot(sp, false, kind)
  },
  onUltFx: (kind, own, x, y) => {
    const sp = sfx.spatial(x - prediction.predicted.x, y - prediction.predicted.y)
    if (kind.endsWith('-boom')) sfx.explosion(sp)
    else if (!own && sp.gain > 0.15) sfx.ult()
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
  if (!identity) {
    backToAuth('Bitte zuerst anmelden.')
    return
  }
  const who = identity
  joinError.textContent = ''
  playBtn.disabled = true
  playBtn.textContent = 'Verbinde …'
  sfx.unlock()
  const skin = currentSkin()
  saveProfile(who.nickname, skin)
  void net
    .join(who, skin, {
      onSnapshot: (snapshot) => {
        players = snapshot.players
        projectiles = snapshot.projectiles
        pickups = snapshot.pickups
        const prevPhase = phase
        phase = snapshot.phase
        winner = snapshot.winner
        if (snapshot.map !== mapId) {
          mapId = snapshot.map
          prediction.map = mapOf(mapId)
          prediction.reset(prediction.serverPos.x, prediction.serverPos.y)
          if (mapAnnounced) showToast(`Karte: ${mapOf(mapId).name}`, '#26d0ff')
        }
        mapAnnounced = true
        timeLeft = snapshot.timeLeft
        interp.push(snapshot.at, players)
        if (phase !== prevPhase) onPhaseChange(prevPhase, phase)
        if (phase === 'end') {
          const n = document.getElementById('next-in')
          if (n) n.textContent = String(snapshot.timeLeft)
        }
        const own = players.find((p) => p.id === net.sessionId)
        if (own) {
          const flying = isFlying(classOf(own.skin), own.ultTicks)
          prediction.speed = effectiveSpeed(classOf(own.skin), own.ultTicks, flying ? 0 : own.slow)
          // Rakete: gleiche Lenk-Schrittfunktion wie der Server (weiche Kurven, keine Wartezeit).
          prediction.setRocket(flying, own.ultAim)
          prediction.reconcile(own.x, own.y, own.ackSeq, own.boost)
        }
      },
      onKill: (by, victim) => pushKill(by, victim),
      onError: (msg) => {
        if (!connected && joinEl.hidden === false) {
          joinError.textContent = msg
          playBtn.disabled = false
          playBtn.textContent = 'Match beitreten'
          return
        }
        enterIdle()
        joinError.textContent = msg
        playBtn.disabled = false
        playBtn.textContent = 'Match beitreten'
      },
    })
    .then(() => {
      connected = true
      myNick = who.nickname
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
      playBtn.textContent = 'Match beitreten'
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
      } else if (msg.includes('INVALID_GUEST')) {
        // Session abgelaufen (z. B. Server-Neustart): zurueck zur Anmeldung.
        backToAuth('Deine Sitzung ist abgelaufen – bitte erneut anmelden.')
      } else {
        joinError.textContent = msg
      }
      sfx.uiError()
      playBtn.disabled = false
      playBtn.textContent = 'Match beitreten'
    })
})

// Test-Hook fuer Playwright: nur lesender Zugriff.
let lastOwnRender = { x: 0, y: 0 }
window.__arena = {
  players: () => players,
  projectiles: () => projectiles,
  connected: () => connected,
  /** Zuletzt gerenderte Position des eigenen Spielers (Debug/Tests). */
  ownRender: () => lastOwnRender,
}

declare global {
  interface Window {
    __arena: {
      players: () => ClientPlayer[]
      projectiles: () => ClientProjectile[]
      connected: () => boolean
      ownRender: () => { x: number; y: number }
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

/** Zielrichtung: Touch = Ziel-Stick (zuletzt gezielte Richtung bleibt), sonst Laufrichtung; sonst Maus. */
function currentAim(): number {
  const pos = prediction.predicted
  if (touchMode) return touch.aimAngle ?? touch.facing
  const s = renderer.worldToScreen(pos.x, pos.y)
  return Math.atan2(input.mouseY - s.y, input.mouseX - s.x)
}

// Input-Tick 30 Hz: senden + lokal vorhersagen. Wird aus dem Render-Loop per Akkumulator getaktet
// (gleichmaessig, keine setInterval-Jitter -> fluessige Bewegung); nur bei verstecktem Tab (rAF pausiert)
// uebernimmt ein Timer, damit die Verbindung nicht ausduennt.
const TICK_MS = 1000 / TICK_RATE
let tickAcc = 0
let lastShootSfx = 0
/** Ult-Wunsch (Joystick/Q): wird ~350 ms lang mitgesendet, bis der Server die Ult gestartet hat (idempotent). */
let ultReq: (UltRelease & { until: number }) | null = null
let lastUlt = 0
function ownPlayer(): ClientPlayer | undefined {
  return players.find((p) => p.id === net.sessionId)
}
/** Skalierung Welt -> Bildschirm (px je Welt-px) fuer das Q-Zielen. */
function worldScale(): number {
  const a = renderer.worldToScreen(0, 0)
  const b = renderer.worldToScreen(100, 0)
  return (b.x - a.x) / 100
}
const ultCtl = new UltControl($<HTMLElement>('ult'), $<HTMLElement>('ult-knob'), {
  ready: () => {
    const o = ownPlayer()
    return !!o && o.alive && o.ult >= ULT_MAX && o.ultTicks === 0 && o.stun === 0
  },
  defaultAim: () => currentAim(),
  mouseAim: () => {
    const o = ownPlayer()
    const pos = prediction.predicted
    const s = renderer.worldToScreen(pos.x, pos.y)
    const dx = input.mouseX - s.x
    const dy = input.mouseY - s.y
    const range = (o ? classOf(o.skin).ult.range : 0) || 600
    return {
      angle: Math.atan2(dy, dx),
      dist: Math.min(1, Math.hypot(dx, dy) / worldScale() / Math.min(range, 900)),
    }
  },
})
function inputTick(): void {
  if (!connected) return
  const { dx, dy } = touchMode && touch.moving ? touch.move : input.readMove()
  const aim = currentAim()
  const own = players.find((p) => p.id === net.sessionId)
  const stunned = !!own && own.stun > 0
  const firing = (input.firing || touch.firing) && settingsClosed() && !stunned
  const rel = ultCtl.take()
  if (rel) ultReq = { ...rel, until: performance.now() + 350 }
  const ultNow =
    ultReq !== null &&
    performance.now() < ultReq.until &&
    !!own?.alive &&
    own.ult >= ULT_MAX &&
    own.ultTicks === 0 &&
    own.stun === 0
  const seq = net.sendInput(dx, dy, aim, firing, ultNow && ultReq ? { ua: ultReq.ua, ud: ultReq.ud } : null)
  if (seq >= 0) {
    const now = performance.now()
    if (own) {
      const fl = isFlying(classOf(own.skin), own.ultTicks)
      prediction.speed = effectiveSpeed(classOf(own.skin), own.ultTicks, fl ? 0 : own.slow)
    }
    const cooldownMs = own ? (classOf(own.skin).cooldownTicks / TICK_RATE) * 1000 : 250
    if (firing && own?.alive && now - lastShootSfx > cooldownMs) {
      lastShootSfx = now
      activity = Math.min(1, activity + 0.04)
      sfx.shoot(undefined, true, own.skin % MODEL_COUNT)
    }
    const boostBefore = prediction.boostLeft
    // Betaeubt/festgewurzelt: der Server bewegt nicht, also sagt die Prediction auch keine Bewegung voraus.
    const held = !!own && (own.stun > 0 || own.hidden > 0)
    prediction.applyLocal({ seq, dx: held ? 0 : dx, dy: held ? 0 : dy })
    if (boostBefore <= 0 && prediction.boostLeft > 0 && own?.alive) {
      sfx.boost()
      renderer.fx.text(prediction.predicted.x, prediction.predicted.y - 34, 'BOOST!', '#ffd23f', 20)
    }
  }
}
setInterval(() => {
  if (document.hidden) inputTick()
}, TICK_MS)

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

function updateUlt(own: ClientPlayer | undefined): void {
  ultBtn.hidden = !own || !connected
  if (!own) return
  const c = classOf(own.skin)
  ultBtn.style.setProperty('--p', String(Math.min(100, (own.ult / ULT_MAX) * 100)))
  ultBtn.dataset.role = c.role
  const ready = own.alive && own.ult >= ULT_MAX && own.ultTicks === 0
  ultBtn.classList.toggle('ready', ready)
  ultBtn.classList.toggle('active', own.ultTicks > 0)
  ultNameEl.textContent = c.ult.name
  ultKeyEl.textContent = touchMode ? '★' : 'Q'
  const requested = ultReq !== null
  if (own.ult >= ULT_MAX && lastUlt < ULT_MAX) {
    sfx.ultReady()
    showToast('ULT bereit!', '#ffd23f')
  }
  if (lastUlt >= ULT_MAX && own.ult < ULT_MAX && requested && own.alive) {
    sfx.ult()
    const pos = prediction.predicted
    renderer.fx.text(pos.x, pos.y - 40, c.ult.name.toUpperCase() + '!', '#ffd23f', 24)
    renderer.fx.confetti(pos.x, pos.y, 50)
    renderer.fx.shake(5)
    activity = Math.min(1, activity + 0.5)
  }
  if (own.ultTicks > 0 || own.ult < ULT_MAX) ultReq = null
  lastUlt = own.ult
}

function updateHud(own: ClientPlayer | undefined): void {
  updateUlt(own)
  if (own) {
    const hp = Math.max(0, Math.round(own.hp))
    hpNum.textContent = String(hp)
    const hpPct = Math.min(100, (hp / classOf(own.skin).hp) * 100)
    hpFill.style.width = `${hpPct}%`
    hpTrail.style.width = `${hpPct}%`
    hpFill.style.setProperty(
      '--hp',
      hpPct > 50 ? 'var(--good)' : hpPct > 25 ? 'var(--warn)' : 'var(--bad)',
    )
    vitalsEl.classList.toggle('low', hpPct <= 25 && own.alive)
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
let lastFrameAt = frameTime()
function frame() {
  frames++
  const now = performance.now()
  const frameStamp = frameTime()
  const frameDt = Math.min(0.1, Math.max(0, (frameStamp - lastFrameAt) / 1000))
  lastFrameAt = frameStamp
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

  // Eingabe-Takt (30 Hz) aus dem Render-Loop; max. 2 Ticks pro Frame, Rest verfaellt (kein Burst nach Hitch).
  if (!document.hidden) {
    tickAcc += frameDt * 1000
    let ticks = 0
    while (tickAcc >= TICK_MS && ticks < 2) {
      inputTick()
      tickAcc -= TICK_MS
      ticks++
    }
    if (tickAcc >= TICK_MS) tickAcc %= TICK_MS
  }
  prediction.decay(frameDt)

  // Eigene Position predicted + zwischen den 30-Hz-Schritten interpoliert (M2-05), Gegner interpoliert (M3-05).
  const ownId = net.sessionId
  const liveAim = currentAim()
  const ownPos = prediction.renderPos(tickAcc / TICK_MS)
  lastOwnRender = ownPos
  const ownNow = players.find((p) => p.id === ownId)
  const ownRealm = ownNow?.realm ?? 0
  ultCtl.update()
  const rendered = players
    .filter((p) => p.id === ownId || p.realm === ownRealm) // Geisterwelt: nur Mitspieler derselben Welt sichtbar
    .map((p) => {
    if (p.id === ownId)
      return { ...p, x: ownPos.x, y: ownPos.y, aim: liveAim, boost: prediction.boostLeft }
    const interpPos = interp.sample(p.id, now)
    return interpPos ? { ...p, x: interpPos.x, y: interpPos.y } : p
  })
  const realmOf = new Map(players.map((p) => [p.id, p.realm]))
  // Ziel-Markierung fuer Ults mit Zielauswahl (gleiche Bewertung wie der Server).
  let ultTargetId: string | null = null
  if (ownNow?.alive && ownNow.ult >= ULT_MAX && ownNow.ultTicks === 0) {
    const udef = classOf(ownNow.skin).ult
    const range = udef.aim === 'target' ? udef.range : 0
    const tAim = ultCtl.aiming ? ultCtl.angle : liveAim
    if (range > 0) {
      let best = Infinity
      for (const p of rendered) {
        if (p.id === ownId || !p.alive || p.realm !== 0) continue
        const sc = ultTargetScore(ownPos.x, ownPos.y, tAim, range, p.x, p.y)
        if (sc < best) {
          best = sc
          ultTargetId = p.id
        }
      }
    }
  }
  renderer.render({
    players: rendered,
    projectiles: projectiles.filter((pr) => (realmOf.get(pr.owner) ?? 0) === ownRealm),
    pickups: ownRealm === 0 ? pickups : [],
    ownId,
    mouse: { x: input.mouseX, y: input.mouseY },
    crosshair: settingsClosed() && !touchMode,
    ghost: ownRealm !== 0,
    ultTargetId,
    ultPreview: ultCtl.aiming ? { angle: ultCtl.angle, dist: ultCtl.dist } : null,
    map: mapId,
  })
  renderScoreboard()

  const own = players.find((p) => p.id === ownId)
  updateHud(own)
  updateDeadOverlay(own)

  // Musik-Intensitaet: Aktivitaet klingt ab, letzte 30 s + Gefahr treiben hoch.
  activity = Math.max(0, activity - 0.0045)
  const endgame = phase === 'play' && timeLeft <= 30 ? 0.25 : 0
  const danger = own && own.alive && own.hp / classOf(own.skin).hp <= 0.35 ? 0.2 : 0
  sfx.setIntensity(phase === 'end' ? 0.1 : 0.25 + activity * 0.5 + endgame + danger)

  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
