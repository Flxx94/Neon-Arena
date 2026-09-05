import { randomUUID } from 'crypto'
import { serialize } from 'cookie'
import { SignJWT, jwtVerify } from 'jose'
import { nicknameSchema } from '@neon-arena/shared'
import { getDb } from '../db/prisma.js'
import { getSessionStore } from './sessions.js'

export const GUEST_COOKIE = 'na_guest'
const TTL_SECONDS = 24 * 3600

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
}

/** Gast-Identitaet ausstellen: JWT + Session + (wenn DB da) User-Zeile. */
export async function issueGuest(nickname: string): Promise<{ identity: GuestIdentity; cookie: string }> {
  const nick = nicknameSchema.parse(nickname)
  const userId = randomUUID()
  const store = getSessionStore()
  await store.create({ userId, nickname: nick, createdAt: Date.now() })

  const db = getDb()
  if (db) {
    await db.user.upsert({
      where: { id: userId },
      update: { nickname: nick },
      create: { id: userId, nickname: nick, isGuest: true },
    })
  }

  const token = await new SignJWT({ nickname: nick })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret())

  const isProd = process.env.NODE_ENV === 'production'
  // Free-Hosting (Render + Cloudflare Pages): Frontend und Backend liegen auf
  // verschiedenen Domains (Cross-Site). Mit SameSite=Lax wuerde der Browser das
  // na_guest-Cookie bei fetch(credentials:include) nicht mitsenden -> /me und
  // Rejoin brechen. In Prod daher SameSite=None; Secure (Browser-Pflicht bei None).
  // Per COOKIE_SAMESITE=lax lokal wieder auf Lax stellbar.
  const sameSiteRaw = (process.env.COOKIE_SAMESITE ?? (isProd ? 'none' : 'lax')).toLowerCase()
  const sameSite = sameSiteRaw === 'none' ? 'none' : 'lax'
  const secure = isProd || sameSite === 'none'
  const cookie = serialize(GUEST_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: TTL_SECONDS,
    path: '/',
  })
  return { identity: { userId, nickname: nick }, cookie }
}

/** Cookie-Token pruefen + Session loesen. Null = abweisen. */
export async function verifyGuest(token: string): Promise<GuestIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    const userId = payload.sub
    if (!userId) return null
    const session = await getSessionStore().get(userId)
    if (!session) return null
    return { userId, nickname: session.nickname }
  } catch {
    return null
  }
}

/** Join-Validierung: bekannte Session (M4-02). Bots joinen nicht ueber Optionen. */
export async function checkGuestSession(userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  return (await getSessionStore().get(userId)) !== null
}
