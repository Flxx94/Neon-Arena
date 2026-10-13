/**
 * Lokale Einstellungen (nur Kosmetik, nie Auth!): Theme, Lautstaerke, Effekte.
 * Persistenz in localStorage — darf scheitern (Privatmodus), dann gilt der Default pro Sitzung.
 * Hinweis: JWT/Session bleiben weiterhin ausschliesslich im httpOnly-Cookie (AGENTS.md).
 */
export type ThemePref = 'auto' | 'light' | 'dark'
export type ParticleQuality = 'low' | 'high'

export interface Settings {
  theme: ThemePref
  sfx: number
  music: number
  muted: boolean
  shake: boolean
  particles: ParticleQuality
}

const KEY = 'neon-arena:settings'

const DEFAULTS: Settings = {
  theme: 'auto',
  sfx: 0.8,
  music: 0.45,
  muted: false,
  shake: true,
  particles: 'high',
}

function clamp01(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback
}

function sanitize(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    theme:
      r.theme === 'light' || r.theme === 'dark' || r.theme === 'auto' ? r.theme : DEFAULTS.theme,
    sfx: clamp01(r.sfx, DEFAULTS.sfx),
    music: clamp01(r.music, DEFAULTS.music),
    muted: typeof r.muted === 'boolean' ? r.muted : DEFAULTS.muted,
    shake: typeof r.shake === 'boolean' ? r.shake : DEFAULTS.shake,
    particles: r.particles === 'low' || r.particles === 'high' ? r.particles : DEFAULTS.particles,
  }
}

type Listener = (s: Settings, changed: (keyof Settings)[]) => void

class SettingsStore {
  private value: Settings
  private listeners = new Set<Listener>()

  constructor() {
    let stored: unknown = null
    try {
      const text = localStorage.getItem(KEY)
      stored = text ? JSON.parse(text) : null
    } catch {
      stored = null
    }
    this.value = sanitize(stored)
  }

  get(): Readonly<Settings> {
    return this.value
  }

  set(patch: Partial<Settings>): void {
    const next = sanitize({ ...this.value, ...patch })
    const changed = (Object.keys(next) as (keyof Settings)[]).filter(
      (k) => next[k] !== this.value[k],
    )
    if (changed.length === 0) return
    this.value = next
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* Privatmodus / Quota: Einstellungen gelten nur fuer diese Sitzung. */
    }
    for (const fn of this.listeners) fn(next, changed)
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

export const settings = new SettingsStore()

/** Zusaetzliche Kleinigkeiten (Nickname/Skin merken): ebenfalls rein kosmetisch. */
export function loadProfile(): { nickname: string; skin: number } {
  try {
    const raw = JSON.parse(localStorage.getItem('neon-arena:profile') ?? 'null') as {
      nickname?: unknown
      skin?: unknown
    } | null
    const nickname =
      typeof raw?.nickname === 'string' && /^[a-zA-Z0-9_-]{1,16}$/.test(raw.nickname)
        ? raw.nickname
        : ''
    const skin = typeof raw?.skin === 'number' && Number.isInteger(raw.skin) ? raw.skin : -1
    return { nickname, skin }
  } catch {
    return { nickname: '', skin: -1 }
  }
}

export function saveProfile(nickname: string, skin: number): void {
  try {
    localStorage.setItem('neon-arena:profile', JSON.stringify({ nickname, skin }))
  } catch {
    /* ignorieren */
  }
}
