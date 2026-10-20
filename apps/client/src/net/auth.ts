/**
 * Profil-API (ADR-014): Name pro IP waehlen/aendern, "Nicht du?", Skin merken.
 * Die Session lebt ausschliesslich im httpOnly-Cookie des Servers (hier nie ein Token speichern).
 */
export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:2567'

export interface Identity {
  userId: string
  nickname: string
  /** Zuletzt gewaehlter Look (Modell + Farbe). */
  skin: number
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AuthError('OFFLINE', 'Server nicht erreichbar – bitte später erneut versuchen.')
  }
  if (!res.ok) {
    const code = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'SERVER_ERROR'
    throw new AuthError(code, MESSAGES[code] ?? 'Das hat nicht geklappt.')
  }
  return (await res.json()) as Identity
}

export type MeResult =
  | { state: 'ok'; identity: Identity }
  | { state: 'anon' }
  | { state: 'banned' }
  | { state: 'offline' }

/**
 * Welches Profil gehoert zu mir? Cookie zuerst, sonst das Profil dieser IP.
 * `auto=false` (nach "Nicht du?") ueberspringt die IP-Zuordnung.
 */
export async function fetchMe(auto = true): Promise<MeResult> {
  try {
    const res = await fetch(`${SERVER_URL}/me${auto ? '' : '?auto=0'}`, { credentials: 'include' })
    if (res.ok) return { state: 'ok', identity: (await res.json()) as Identity }
    if (res.status === 401) return { state: 'anon' }
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
  await fetch(`${SERVER_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(
    () => undefined,
  )
}

/** Lobby-Look am Profil merken (best effort, Fehler sind egal). */
export async function saveSkin(skin: number): Promise<void> {
  await fetch(`${SERVER_URL}/me/skin`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skin }),
  }).catch(() => undefined)
}
