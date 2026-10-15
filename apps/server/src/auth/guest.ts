import { randomUUID } from 'crypto'
import { serialize } from 'cookie'
import { SignJWT, jwtVerify } from 'jose'
import { nicknameSchema } from '@neon-arena/shared'
import { getDb } from '../db/prisma.js'
import { getSessionStore } from './sessions.js'

export const GUEST_COOKIE = 'na_guest'
const TTL_SECONDS = 24 * 3600
/** Konten bleiben laenger angemeldet (kein taegliches Neu-Einloggen). */
export const ACCOUNT_TTL_SECONDS = 7 * 24 * 3600

let cachedSecret: Uint8Array | null = null

function secret(): Uint8Array {
  if (cachedSecret) return cachedSecret
  const s = process.env.JWT_SECRET
  if (!s && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET fehlt (production)')
  }
  if (!s) console.warn('[auth] JWT_SECRET nicht gesetzt – ephemeres Dev-Secret (Prozess-lokal)')
  cachedSecret = new TextEncoder().encode(s ?? `dev-${randomUUID()}`)
  return cachedSecret
}

export interface GuestIdentity {
  userId: string
  nickname: string
  /** true = Gast, false = Konto (Email + Passwort). */
  isGuest: boolean
  /** Zuletzt gewaehlter Look (Lobby). */
  skin: number
  /** Nur Konten. */
  email?: string
}

function cookieAttrs(maxAge: number) {
  const isProd = process.env.NODE_ENV === 'production'
  // Free-Hosting (Render + Cloudflare Pages): Frontend und Backend liegen auf
  // verschiedenen Domains (Cross-Site). Mit SameSite=Lax wuerde der Browser das
  // na_guest-Cookie bei fetch(credentials:include) nicht mitsenden -> /me und
  // Rejoin brechen. In Prod daher SameSite=None; Secure (Browser-Pflicht bei None).
  // Per COOKIE_SAMESITE=lax lokal wieder auf Lax stellbar.
  const sameSiteRaw = (process.env.COOKIE_SAMESITE ?? (isProd ? 'none' : 'lax')).toLowerCase()
  const sameSite = sameSiteRaw === 'none' ? ('none' as const) : ('lax' as const)
  const secure = isProd || sameSite === 'none'
  return { httpOnly: true, secure, sameSite, maxAge, path: '/' }
}

/** Session + JWT-Cookie fuer eine Identitaet ausstellen (Gast oder Konto). */
export async function issueSession(
  identity: GuestIdentity,
  ttlSeconds: number,
): Promise<{ identity: GuestIdentity; cookie: string }> {
  await getSessionStore().create({
    userId: identity.userId,
    nickname: identity.nickname,
    createdAt: Date.now(),
    isGuest: identity.isGuest,
    skin: identity.skin,
    ...(identity.email ? { email: identity.email } : {}),
    ttlSeconds,
  })
  const token = await new SignJWT({ nickname: identity.nickname })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(identity.userId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret())
  return { identity, cookie: serialize(GUEST_COOKIE, token, cookieAttrs(ttlSeconds)) }
}

/** Cookie loeschen (Logout). */
export function clearSessionCookie(): string {
  return serialize(GUEST_COOKIE, '', { ...cookieAttrs(0), expires: new Date(0) })
}

/** Gast-Identitaet ausstellen: JWT + Session + (wenn DB da) User-Zeile. */
export async function issueGuest(nickname: string): Promise<{ identity: GuestIdentity; cookie: string }> {
  const nick = nicknameSchema.parse(nickname)
  const userId = randomUUID()

  const db = getDb()
  if (db) {
    await db.user.upsert({
      where: { id: userId },
      update: { nickname: nick },
      create: { id: userId, nickname: nick, isGuest: true },
    })
  }
  return issueSession({ userId, nickname: nick, isGuest: true, skin: 0 }, TTL_SECONDS)
}

/** Cookie-Token pruefen + Session loesen. Null = abweisen. */
export async function verifyGuest(token: string): Promise<GuestIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    const userId = payload.sub
    if (!userId) return null
    const session = await getSessionStore().get(userId)
    if (!session) return null
    const identity: GuestIdentity = {
      userId,
      nickname: session.nickname,
      isGuest: session.isGuest ?? true,
      skin: session.skin ?? 0,
    }
    if (session.email) identity.email = session.email
    return identity
  } catch {
    return null
  }
}

/** Join-Validierung: bekannte Session (M4-02). Bots joinen nicht ueber Optionen. */
export async function checkGuestSession(userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  return (await getSessionStore().get(userId)) !== null
}
