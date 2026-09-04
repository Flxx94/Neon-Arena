import { Room } from 'colyseus.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'colyseus.js'
import type { AddressInfo } from 'net'
import { startGameServer } from '../index.js'

beforeEach(() => {
  process.env.BOTS_ENABLED = 'false'
})

afterEach(() => {
  delete process.env.BOTS_ENABLED
})

async function join(port: number, nickname: string): Promise<Room> {
  const client = new Client(`ws://127.0.0.1:${port}`)
  return client.joinOrCreate('arena', { nickname, protocolV: 1 })
}

describe('Matchmaking + Reconnect (M3-01/M3-02)', () => {
  it('8 Joins landen im selben Raum, der 13. in einem neuen', async () => {
    const started = await startGameServer(0)
    const port = (started.httpServer.address() as AddressInfo).port
    const rooms: Room[] = []
    try {
      for (let i = 0; i < 8; i++) {
        rooms.push(await join(port, `P${i}`))
      }
      const ids = new Set(rooms.map((r) => r.roomId))
      expect(ids.size).toBe(1)

      for (let i = 8; i < 13; i++) {
        rooms.push(await join(port, `P${i}`))
      }
      const allIds = rooms.map((r) => r.roomId)
      const firstRoom = allIds.slice(0, 12)
      expect(new Set(firstRoom).size).toBe(1)
      expect(allIds[12]).not.toBe(firstRoom[0])
    } finally {
      for (const r of rooms) await r.leave()
      await started.gameServer.gracefullyShutdown(false)
      started.httpServer.close()
    }
  }, 60_000)

  it('Reconnect innert 15 s behaelt Session + Spieler', async () => {
    const started = await startGameServer(0)
    const port = (started.httpServer.address() as AddressInfo).port
    try {
      const client = new Client(`ws://127.0.0.1:${port}`)
      const room = await client.joinOrCreate('arena', { nickname: 'Sticky', protocolV: 1 })
      const { sessionId, reconnectionToken } = room

      // Abrupter Abriss (unconsented) -> Grace-Fenster.
      await room.leave(false)

      // Server registriert die Grace asynchron -> Reconnect mit Retry.
      let room2: Room | null = null
      const start = Date.now()
      while (!room2 && Date.now() - start < 5000) {
        try {
          room2 = await client.reconnect(reconnectionToken)
        } catch {
          await new Promise((r) => setTimeout(r, 200))
        }
      }
      expect(room2).not.toBeNull()
      expect(room2!.sessionId).toBe(sessionId)
      await room2!.leave()
    } finally {
      await started.gameServer.gracefullyShutdown(false)
      started.httpServer.close()
    }
  }, 60_000)
})
