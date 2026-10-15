import { createServer, type Server as HttpServer } from 'http'
import { parse as parseCookie } from 'cookie'
import cors from 'cors'
import { Server as GameServer } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import express, { type Express, type Request, type Response } from 'express'
import helmet from 'helmet'
import { skinUpdateSchema } from '@neon-arena/shared'
import { getAccountStore } from './auth/accounts.js'
import {
  ACCOUNT_TTL_SECONDS,
  GUEST_COOKIE,
  clearSessionCookie,
  issueGuest,
  issueSession,
  verifyGuest,
} from './auth/guest.js'
import { loginAccount, registerAccount } from './auth/service.js'
import { RedisSessionStore, getSessionStore, setSessionStore } from './auth/sessions.js'
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

function httpIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for']
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0]?.trim()
  return first ?? req.socket.remoteAddress ?? 'unknown'
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

  // M4-02: Gast-Identitaet (JWT in httpOnly-Cookie). Limit 5/min/IP (M4-05).
  app.post('/auth/guest', async (req, res) => {
    if (!(await checkLimit(getRateStore(), `http:guest:${httpIp(req)}`, 5, 60_000))) {
      res.status(429).json({ error: 'RATE_LIMITED' })
      return
    }
    try {
      const { identity, cookie } = await issueGuest(String(req.body?.nickname ?? ''))
      res.setHeader('Set-Cookie', cookie)
      res.json(identity)
    } catch {
      res.status(400).json({ error: 'INVALID_NICKNAME' })
    }
  })

  // ADR-005: Konto registrieren (Email + Passwort + Spielername) -> Cookie-Session.
  app.post('/auth/register', async (req, res) => {
    if (!(await checkLimit(getRateStore(), `http:register:${httpIp(req)}`, 10, 10 * 60_000))) {
      res.status(429).json({ error: 'RATE_LIMITED' })
      return
    }
    try {
      const result = await registerAccount(req.body, getAccountStore())
      if (!result.ok) {
        res.status(result.status).json({ error: result.error })
        return
      }
      const a = result.account
      const { identity, cookie } = await issueSession(
        { userId: a.id, nickname: a.nickname, isGuest: false, skin: a.skin, email: a.email },
        ACCOUNT_TTL_SECONDS,
      )
      res.setHeader('Set-Cookie', cookie)
      res.status(201).json(identity)
    } catch (err) {
      console.error('[auth] register failed:', err)
      res.status(500).json({ error: 'SERVER_ERROR' })
    }
  })

  // ADR-005: Login. Limit pro IP (20/min) UND pro Email (8 / 5 min) gegen Passwort-Raten.
  app.post('/auth/login', async (req, res) => {
    const store = getRateStore()
    const email =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : ''
    if (
      !(await checkLimit(store, `http:login:${httpIp(req)}`, 20, 60_000)) ||
      (email && !(await checkLimit(store, `http:login:email:${email}`, 8, 5 * 60_000)))
    ) {
      res.status(429).json({ error: 'RATE_LIMITED' })
      return
    }
    try {
      const result = await loginAccount(req.body, getAccountStore())
      if (!result.ok) {
        res.status(result.status).json({ error: result.error })
        return
      }
      const a = result.account
      const { identity, cookie } = await issueSession(
        { userId: a.id, nickname: a.nickname, isGuest: false, skin: a.skin, email: a.email },
        ACCOUNT_TTL_SECONDS,
      )
      res.setHeader('Set-Cookie', cookie)
      res.json(identity)
    } catch (err) {
      console.error('[auth] login failed:', err)
      res.status(500).json({ error: 'SERVER_ERROR' })
    }
  })

  // ADR-005: Logout: Session verwerfen + Cookie loeschen (immer 204, auch ohne Session).
  app.post('/auth/logout', async (req, res) => {
    const token = parseCookie(req.headers.cookie ?? '')[GUEST_COOKIE]
    if (token) {
      const identity = await verifyGuest(token)
      if (identity) await getSessionStore().delete(identity.userId)
    }
    res.setHeader('Set-Cookie', clearSessionCookie())
    res.status(204).end()
  })

  // Lobby: gewaehlten Look (Modell + Farbe) merken (Konto: dauerhaft, Gast: nur Session).
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
    if (!identity.isGuest) await getAccountStore().setSkin(identity.userId, parsed.data.skin)
    res.json({ ...identity, skin: parsed.data.skin })
  })

  // M4-02: Reload behaelt Identitaet (Cookie -> Session).
  app.get('/me', async (req, res) => {
    const token = parseCookie(req.headers.cookie ?? '')[GUEST_COOKIE]
    if (!token) {
      res.status(401).json({ error: 'NO_SESSION' })
      return
    }
    const identity = await verifyGuest(token)
    if (!identity) {
      res.status(401).json({ error: 'INVALID_SESSION' })
      return
    }
    res.json(identity)
  })

  // M4-04: Leaderboard Top 100 (summierte Scores).
  app.get('/leaderboard', async (_req, res) => {
    const db = getDb()
    if (!db) {
      res.status(503).json({ error: 'DB_UNAVAILABLE' })
      return
    }
    const grouped = await db.matchPlayer.groupBy({
      by: ['userId'],
      _sum: { score: true, kills: true },
      _count: { _all: true },
      orderBy: { _sum: { score: 'desc' } },
      take: 100,
    })
    const users = await db.user.findMany({ where: { id: { in: grouped.map((g) => g.userId) } } })
    const nicknames = new Map(users.map((u) => [u.id, u.nickname]))
    res.json(
      grouped.map((g, i) => ({
        rank: i + 1,
        userId: g.userId,
        nickname: nicknames.get(g.userId) ?? '?',
        score: g._sum.score ?? 0,
        kills: g._sum.kills ?? 0,
        matches: g._count._all,
      })),
    )
  })

  // M4-04: Match-Historie pro Spieler (letzte 20).
  app.get('/history/:userId', async (req: Request<{ userId: string }>, res: Response) => {
    const db = getDb()
    if (!db) {
      res.status(503).json({ error: 'DB_UNAVAILABLE' })
      return
    }
    const matches = await db.match.findMany({
      where: { players: { some: { userId: req.params.userId } } },
      orderBy: { endedAt: 'desc' },
      take: 20,
      include: { players: true },
    })
    res.json(
      matches.map((m) => ({
        id: m.id,
        endedAt: m.endedAt,
        winnerId: m.winnerId,
        players: m.players.map((p) => ({ userId: p.userId, kills: p.kills, deaths: p.deaths, score: p.score })),
      })),
    )
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
