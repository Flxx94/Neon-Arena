import { createServer, type Server as HttpServer } from 'http'
import cors from 'cors'
import { Server as GameServer } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { ArenaRoom } from './rooms/ArenaRoom.js'
import { tickMsP95 } from './sim/metrics.js'

const PORT = Number(process.env.PORT ?? 2567)
const APP_VERSION = process.env.APP_VERSION ?? '0.1.0'
const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173'

const startedAt = Date.now()
// M0-Stub: echte Werte kommen mit Sim (M2) + Redis (M3/M4).
const metrics = { rooms: 0, players: 0, tickMsP95: 0 }

export function createApp(): Express {
  const app = express()
  app.use(helmet())
  app.use(cors({ origin: CLIENT_URL.split(',').map((s) => s.trim()) }))
  app.use(express.json({ limit: '64kb' }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: APP_VERSION, uptime_s: Math.floor((Date.now() - startedAt) / 1000) })
  })

  app.get('/metrics', (_req, res) => {
    res.json({ ...metrics, tickMsP95: tickMsP95() })
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
  await startGameServer(PORT)
  console.log(`[server] listening on :${PORT}`)
}
