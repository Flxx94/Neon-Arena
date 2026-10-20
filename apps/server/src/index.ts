import { createServer, type Server as HttpServer } from 'http'
import { parse as parseCookie } from 'cookie'
import cors from 'cors'
import { Server as GameServer } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import express, { type Express, type Request } from 'express'
import helmet from 'helmet'
import { profileNameSchema, skinUpdateSchema } from '@neon-arena/shared'
import {
  GUEST_COOKIE,
  PROFILE_TTL_SECONDS,
  clearSessionCookie,
  issueSession,
  verifyGuest,
} from './auth/guest.js'
import { getProfileStore, type Profile } from './auth/profiles.js'
import { RedisSessionStore, getSessionStore, setSessionStore } from './auth/sessions.js'
import { getBanStore } from './db/bans.js'
import { buildBoard, parseSort, type StatRow } from './db/leaderboard.js'
import { getDb } from './db/prisma.js'
import { getRedis } from './db/redis.js'
import { RedisRateStore, checkLimit, getRateStore, setRateStore } from './ratelimit/limiter.js'
import { ArenaRoom } from './rooms/ArenaRoom.js'
import { tickMsP95 } from './sim/metrics.js'

const PORT = Number(process.env.PORT ?? 2567)
const APP_VERSION = process.env.APP_VERSION ?? '0.1.0'
const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173'

const startedAt = Date.now()
// M0-Stub: echte Werte kommen mit Sim (M2) + Redis (M3/M4).
const metrics = { rooms: 0, players: 0, tickMsP95: 0 }

/** Wie `clientIp` im Raum: hinter dem Proxy der LETZTE X-Forwarded-For-Eintrag (TRUST_PROXY=false: Socket). */
function httpIp(req: Request): string {
  if (process.env.TRUST_PROXY !== 'false') {
    const fwd = req.headers['x-forwarded-for']
    const raw = Array.isArray(fwd) ? fwd.join(',') : fwd
    const last = raw?.split(',').at(-1)?.trim()
    if (last) return last
  }
  return req.socket.remoteAddress ?? 'unknown'
}

async function sessionFor(p: Profile): Promise<string> {
  const { cookie } = await issueSession({ userId: p.id, nickname: p.nickname, skin: p.skin }, PROFILE_TTL_SECONDS)
  return cookie
}

export function createApp(): Express {
  const app = express()
  app.use(helmet())
  app.use(cors({ origin: CLIENT_URL.split(',').map((s) => s.trim()), credentials: true }))
  app.use(express.json({ limit: '64kb' }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: APP_VERSION, uptime_s: Math.floor((Date.now() - startedAt) / 1000) })
  })

  app.get('/metrics', (_req, res) => {
    res.json({ ...metrics, tickMsP95: tickMsP95() })
  })

  // Profil pro IP (ADR-014): Reload/Neustart behaelt die Identitaet.
  // Cookie gilt zuerst; ohne Cookie wird (wenn `?auto=0` fehlt) das neueste Profil dieser IP geladen.
  app.get('/me', async (req, res) => {
    const ip = httpIp(req)
    if (await (await getBanStore()).isBanned(ip)) {
      res.status(403).json({ error: 'BANNED' })
      return
    }
    const token = parseCookie(req.headers.cookie ?? '')[GUEST_COOKIE]
    const identity = token ? await verifyGuest(token) : null
    if (identity) {
      res.json(identity)
      return
    }
    if (req.query.auto !== '0') {
      const profile = await getProfileStore().findByIp(ip)
      if (profile) {
        res.setHeader('Set-Cookie', await sessionFor(profile))
        res.json({ userId: profile.id, nickname: profile.nickname, skin: profile.skin })
        return
      }
    }
    res.status(401).json({ error: token ? 'INVALID_SESSION' : 'NO_SESSION' })
  })

  // Erste Namenswahl dieser IP (oder "Nicht du?" -> neues Profil). Limit 5/min/IP.
  app.post('/me', async (req, res) => {
    const ip = httpIp(req)
    if (await (await getBanStore()).isBanned(ip)) {
      res.status(403).json({ error: 'BANNED' })
      return
    }
    if (!(await checkLimit(getRateStore(), `http:profile:${ip}`, 5, 60_000))) {
      res.status(429).json({ error: 'RATE_LIMITED' })
      return
    }
    const parsed = profileNameSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'INVALID_NICKNAME' })
      return
    }
    try {
      const profile = await getProfileStore().create(parsed.data.nickname, ip)
      res.setHeader('Set-Cookie', await sessionFor(profile))
      res.status(201).json({ userId: profile.id, nickname: profile.nickname, skin: profile.skin })
    } catch (err) {
      console.error('[profile] create failed:', err)
      res.status(500).json({ error: 'SERVER_ERROR' })
    }
  })

  // Umbenennen in der Lobby (gilt ab dem naechsten Beitritt; Leaderboard zeigt sofort den neuen Namen).
  app.patch('/me/name', async (req, res) => {
    const token = parseCookie(req.headers.cookie ?? '')[GUEST_COOKIE]
    const identity = token ? await verifyGuest(token) : null
    if (!identity) {
      res.status(401).json({ error: 'NO_SESSION' })
      return
    }
    if (!(await checkLimit(getRateStore(), `http:rename:${identity.userId}`, 10, 60_000))) {
      res.status(429).json({ error: 'RATE_LIMITED' })
      return
    }
    const parsed = profileNameSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'INVALID_NICKNAME' })
      return
    }
    const nickname = parsed.data.nickname
    await getProfileStore().rename(identity.userId, nickname)
    const sessions = getSessionStore()
    const session = await sessions.get(identity.userId)
    if (session) await sessions.create({ ...session, nickname })
    res.json({ ...identity, nickname })
  })

  // "Nicht du?": Session verwerfen + Cookie loeschen (immer 204, auch ohne Session).
  app.post('/auth/logout', async (req, res) => {
    const token = parseCookie(req.headers.cookie ?? '')[GUEST_COOKIE]
    if (token) {
      const identity = await verifyGuest(token)
      if (identity) await getSessionStore().delete(identity.userId)
    }
    res.setHeader('Set-Cookie', clearSessionCookie())
    res.status(204).end()
  })

  // Lobby: gewaehlten Look (Modell + Farbe) am Profil merken.
  app.patch('/me/skin', async (req, res) => {
    const token = parseCookie(req.headers.cookie ?? '')[GUEST_COOKIE]
    const identity = token ? await verifyGuest(token) : null
    if (!identity) {
      res.status(401).json({ error: 'NO_SESSION' })
      return
    }
    const parsed = skinUpdateSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'INVALID_SKIN' })
      return
    }
    const sessions = getSessionStore()
    const session = await sessions.get(identity.userId)
    if (session) await sessions.create({ ...session, skin: parsed.data.skin })
    await getProfileStore().setSkin(identity.userId, parsed.data.skin)
    res.json({ ...identity, skin: parsed.data.skin })
  })

  // Bestenliste Top 100, sortierbar: ?sort=kills|kd|deaths|matches|wins. Nur Anzeigename + Zahlen.
  app.get('/leaderboard', async (req, res) => {
    const db = getDb()
    if (!db) {
      res.status(503).json({ error: 'DB_UNAVAILABLE' })
      return
    }
    const [grouped, wonBy] = await Promise.all([
      db.matchPlayer.groupBy({ by: ['userId'], _sum: { kills: true, deaths: true }, _count: { _all: true } }),
      db.match.groupBy({ by: ['winnerId'], where: { winnerId: { not: null } }, _count: { _all: true } }),
    ])
    const users = await db.user.findMany({
      where: { id: { in: grouped.map((g) => g.userId) } },
      select: { id: true, nickname: true },
    })
    const names = new Map(users.map((u) => [u.id, u.nickname]))
    const wins = new Map(wonBy.map((w) => [w.winnerId, w._count._all]))
    const rows: StatRow[] = grouped.map((g) => ({
      nickname: names.get(g.userId) ?? '?',
      kills: g._sum.kills ?? 0,
      deaths: g._sum.deaths ?? 0,
      matches: g._count._all,
      wins: wins.get(g.userId) ?? 0,
    }))
    res.json(buildBoard(rows, parseSort(req.query.sort)))
  })

  return app
}

export async function startGameServer(
  port: number,
): Promise<{ httpServer: HttpServer; gameServer: GameServer }> {
  const httpServer = createServer(createApp())
  const gameServer = new GameServer({
    transport: new WebSocketTransport({ server: httpServer }),
  })
  gameServer.define('arena', ArenaRoom)
  await gameServer.listen(port)
  return { httpServer, gameServer }
}

const entry = process.argv[1] ?? ''
const isMain = entry.endsWith('index.ts') || entry.endsWith('index.js')
if (isMain) {
  // Redis-backed Stores, wenn verfuegbar (sonst Memory-Fallback).
  const redis = await getRedis().catch(() => null)
  if (redis) {
    setSessionStore(new RedisSessionStore(redis))
    setRateStore(
      new RedisRateStore({
        incr: (key) => redis.incr(key),
        pExpire: (key, ms) => redis.pExpire(key, ms),
      }),
    )
    console.log('[server] redis connected')
  }
  await startGameServer(PORT)
  console.log(`[server] listening on :${PORT}`)
}
