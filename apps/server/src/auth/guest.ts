import { randomUUID } from 'crypto'
import { serialize } from 'cookie'
import { SignJWT, jwtVerify } from 'jose'
import { nicknameSchema } from '@neon-arena/shared'
import { getProfileStore } from './profiles.js'
import { getSessionStore } from './sessions.js'

export const GUEST_COOKIE = 'na_guest'
const TTL_SECONDS = 24 * 3600
/** Profile bleiben lange angemeldet (kein taegliches Neu-Anmelden). */
export const PROFILE_TTL_SECONDS = 180 * 24 * 3600

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
  /** Zuletzt gewaehlter Look (Lobby). */
  skin: number
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

/** Session + JWT-Cookie fuer ein Profil ausstellen. */
export async function issueSession(
  identity: GuestIdentity,
  ttlSeconds: number,
): Promise<{ identity: GuestIdentity; cookie: string; token: string }> {
  await getSessionStore().create({
    userId: identity.userId,
    nickname: identity.nickname,
    createdAt: Date.now(),
    skin: identity.skin,
    ttlSeconds,
  })
  const token = await new SignJWT({ nickname: identity.nickname })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(identity.userId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret())
  return { identity, token, cookie: serialize(GUEST_COOKIE, token, cookieAttrs(ttlSeconds)) }
}

/** Cookie loeschen (Logout). */
export function clearSessionCookie(): string {
  return serialize(GUEST_COOKIE, '', { ...cookieAttrs(0), expires: new Date(0) })
}

/** Fluechtige Identitaet ohne Profil (Tests/Dev-Helfer; Produktion nutzt Profile pro IP). */
export async function issueGuest(nickname: string): Promise<{ identity: GuestIdentity; cookie: string; token: string }> {
  const nick = nicknameSchema.parse(nickname)
  return issueSession({ userId: randomUUID(), nickname: nick, skin: 0 }, TTL_SECONDS)
}

/** Cookie-Token pruefen + Session loesen. Null = abweisen. */
export async function verifyGuest(token: string): Promise<GuestIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    const userId = payload.sub
    if (!userId) return null
    const session = await getSessionStore().get(userId)
    if (session) return { userId, nickname: session.nickname, skin: session.skin ?? 0 }
    // Session weg (Server-Neustart/Free-Tier-Schlaf ohne Redis): gueltiges Token + Profil in der DB
    // -> Session neu aufbauen, damit niemand seinen Namen neu waehlen muss.
    const profile = await getProfileStore().findById(userId)
    if (!profile) return null
    await getSessionStore().create({
      userId,
      nickname: profile.nickname,
      createdAt: Date.now(),
      skin: profile.skin,
      ttlSeconds: PROFILE_TTL_SECONDS,
    })
    return { userId, nickname: profile.nickname, skin: profile.skin }
  } catch {
    return null
  }
}

/** Join-Validierung: bekannte Session (M4-02). Bots joinen nicht ueber Optionen. */
export async function checkGuestSession(userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  return (await getSessionStore().get(userId)) !== null
}
