/**
 * Profil-API (ADR-014): Name waehlen/aendern, "Nicht du?", Skin merken.
 * Identitaet = httpOnly-Cookie des Servers. Fallback fuer Browser, die Cross-Site-Cookies blockieren
 * (Safari/Firefox): das Profil-Token liegt zusaetzlich in localStorage und geht als Bearer mit.
 * Es ist nur ein zufaelliger Profilschluessel (kein Passwort, kein Geld) – XSS-Risiko entsprechend gering.
 */
export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:2567'

export interface Identity {
  userId: string
  nickname: string
  /** Zuletzt gewaehlter Look (Modell + Farbe). */
  skin: number
}

const TOKEN_KEY = 'neon-arena:token'

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignorieren (privater Modus) */
  }
}

function headers(json = false): Record<string, string> {
  const h: Record<string, string> = {}
  if (json) h['content-type'] = 'application/json'
  const t = getToken()
  if (t) h.authorization = `Bearer ${t}`
  return h
}

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

const MESSAGES: Record<string, string> = {
  INVALID_NICKNAME: 'Spielername: 1–16 Zeichen, nur a-z 0-9 _ -',
  RATE_LIMITED: 'Zu viele Versuche – bitte kurz warten.',
  BANNED: 'Du wurdest von diesem Server gesperrt.',
  NO_SESSION: 'Sitzung abgelaufen – bitte Seite neu laden.',
  SERVER_ERROR: 'Serverfehler – bitte später erneut versuchen.',
}

async function send(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<Identity> {
  let res: Response
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method,
      credentials: 'include',
      headers: headers(true),
      body: JSON.stringify(body),
    })
  } catch {
    throw new AuthError('OFFLINE', 'Server nicht erreichbar – bitte später erneut versuchen.')
  }
  if (!res.ok) {
    const code = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'SERVER_ERROR'
    throw new AuthError(code, MESSAGES[code] ?? 'Das hat nicht geklappt.')
  }
  const data = (await res.json()) as Identity & { token?: string }
  if (data.token) setToken(data.token)
  const { token: _t, ...identity } = data
  return identity
}

export type MeResult =
  | { state: 'ok'; identity: Identity }
  | { state: 'anon' }
  | { state: 'banned' }
  | { state: 'offline' }

/** Welches Profil gehoert zu diesem Browser (Cookie/Token)? */
export async function fetchMe(): Promise<MeResult> {
  try {
    const res = await fetch(`${SERVER_URL}/me`, { credentials: 'include', headers: headers() })
    if (res.ok) return { state: 'ok', identity: (await res.json()) as Identity }
    if (res.status === 401) {
      setToken(null) // abgelaufen/unbekannt
      return { state: 'anon' }
    }
    if (res.status === 403) return { state: 'banned' }
    return { state: 'offline' }
  } catch {
    return { state: 'offline' }
  }
}

/** Erste Namenswahl (legt das Profil dieser IP an). */
export const createProfile = (nickname: string) => send('POST', '/me', { nickname })

/** Anzeigename aendern (gilt ab dem naechsten Beitritt). */
export const renameProfile = (nickname: string) => send('PATCH', '/me/name', { nickname })

/** "Nicht du?": Session verwerfen, danach neuen Namen waehlen. */
export async function logout(): Promise<void> {
  const h = headers()
  setToken(null)
  await fetch(`${SERVER_URL}/auth/logout`, { method: 'POST', credentials: 'include', headers: h }).catch(
    () => undefined,
  )
}

/** Lobby-Look am Profil merken (best effort, Fehler sind egal). */
export async function saveSkin(skin: number): Promise<void> {
  await fetch(`${SERVER_URL}/me/skin`, {
    method: 'PATCH',
    credentials: 'include',
    headers: headers(true),
    body: JSON.stringify({ skin }),
  }).catch(() => undefined)
}
