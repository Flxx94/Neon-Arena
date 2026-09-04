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

async function startEphemeral() {
  const started = await startGameServer(0)
  const port = (started.httpServer.address() as AddressInfo).port
  return { port, ...started }
}

async function joinPlayer(port: number, nickname: string): Promise<Room> {
  const client = new Client(`ws://127.0.0.1:${port}`)
  return client.joinOrCreate('arena', { nickname, protocolV: 1 })
}

function playersOf(room: Room): Map<string, { x: number }> {
  return room.state.players as Map<string, { x: number }>
}

async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('ArenaRoom (M1-02)', () => {
  it('2 Clients joinen, sehen einander, Bewegung erscheint gegenueber', async () => {
    const { port, httpServer, gameServer } = await startEphemeral()
    try {
      const roomA = await joinPlayer(port, 'Alpha')
      const roomB = await joinPlayer(port, 'Beta')

      await waitFor(() => playersOf(roomA).size === 2 && playersOf(roomB).size === 2)
      const idsA = [...playersOf(roomA).keys()]
      const ownA = roomA.sessionId
      const x0 = playersOf(roomB).get(ownA)?.x ?? NaN
      expect(Number.isFinite(x0)).toBe(true)

      roomA.send('input', { kind: 'input', seq: 0, dx: 1, dy: 0, aim: 0, fire: false })
      roomA.send('input', { kind: 'input', seq: 1, dx: 1, dy: 0, aim: 0, fire: false })
      await waitFor(() => {
        const x = playersOf(roomB).get(ownA)?.x ?? NaN
        return Number.isFinite(x) && x > x0
      })
      expect(idsA).toHaveLength(2)

      await roomA.leave()
      await roomB.leave()
    } finally {
      await gameServer.gracefullyShutdown(false)
      httpServer.close()
    }
  }, 30_000)

  it('ungueltiger Nickname wird abgewiesen', async () => {
    const { port, httpServer, gameServer } = await startEphemeral()
    try {
      await expect(joinPlayer(port, '<script>alert(1)</script>')).rejects.toThrow()
    } finally {
      await gameServer.gracefullyShutdown(false)
      httpServer.close()
    }
  }, 30_000)
})
