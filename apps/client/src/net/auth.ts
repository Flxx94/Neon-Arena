/**
 * Account-API (ADR-005): Registrierung, Login, Gast, Logout, Skin merken.
 * Die Session lebt ausschliesslich im httpOnly-Cookie des Servers (hier nie ein Token/Passwort speichern).
 */
export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:2567'

export interface Identity {
  userId: string
  nickname: string
  /** true = Gast, false = Konto. */
  isGuest: boolean
  /** Zuletzt gewaehlter Look (Modell + Farbe). */
  skin: number
  email?: string
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
  INVALID_EMAIL: 'Bitte eine gültige E-Mail-Adresse eingeben.',
  INVALID_PASSWORD: 'Das Passwort braucht mindestens 8 Zeichen.',
  INVALID_NICKNAME: 'Spielername: 1–16 Zeichen, nur a-z 0-9 _ -',
  INVALID_INPUT: 'Bitte alle Felder ausfüllen.',
  EMAIL_TAKEN: 'Diese E-Mail ist bereits registriert – melde dich an.',
  INVALID_CREDENTIALS: 'E-Mail oder Passwort stimmt nicht.',
  RATE_LIMITED: 'Zu viele Versuche – bitte kurz warten.',
  SERVER_ERROR: 'Serverfehler – bitte später erneut versuchen.',
}

async function post(path: string, body: unknown): Promise<Identity> {
  let res: Response
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AuthError('OFFLINE', 'Server nicht erreichbar – bitte später erneut versuchen.')
  }
  if (!res.ok) {
    const code = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'SERVER_ERROR'
    throw new AuthError(code, MESSAGES[code] ?? 'Anmeldung fehlgeschlagen.')
  }
  return (await res.json()) as Identity
}

export type MeResult =
  | { state: 'ok'; identity: Identity }
  | { state: 'anon' }
  | { state: 'offline' }

/** Besteht schon eine Session (Cookie)? Entscheidet zwischen Login-Seite und Lobby. */
export async function fetchMe(): Promise<MeResult> {
  try {
    const res = await fetch(`${SERVER_URL}/me`, { credentials: 'include' })
    if (res.ok) return { state: 'ok', identity: (await res.json()) as Identity }
    return res.status === 401 ? { state: 'anon' } : { state: 'offline' }
  } catch {
    return { state: 'offline' }
  }
}

export const register = (email: string, password: string, nickname: string) =>
  post('/auth/register', { email, password, nickname })

export const login = (email: string, password: string) => post('/auth/login', { email, password })

export const guestLogin = (nickname: string) => post('/auth/guest', { nickname })

export async function logout(): Promise<void> {
  await fetch(`${SERVER_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(
    () => undefined,
  )
}

/** Lobby-Look am Konto/der Session merken (best effort, Fehler sind egal). */
export async function saveSkin(skin: number): Promise<void> {
  await fetch(`${SERVER_URL}/me/skin`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skin }),
  }).catch(() => undefined)
}
