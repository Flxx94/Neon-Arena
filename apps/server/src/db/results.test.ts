import { describe, expect, it, vi } from 'vitest'
import { persistMatch, type ResultsDb } from './results.js'

function mockDb() {
  return {
    match: {
      create: vi.fn(
        async (args: {
          data: {
            roomId: string
            startedAt: Date
            endedAt: Date
            winnerId: string | null
            players: { create: { userId: string; kills: number; deaths: number; score: number }[] }
          }
        }) => ({ id: 'm1', roomId: args.data.roomId }),
      ),
    },
    user: { upsert: vi.fn(async (args: unknown) => ({ ok: args !== null })) },
  }
}

describe('persistMatch (M4-03)', () => {
  it('schreibt Match + Spieler, upserted User', async () => {
    const db = mockDb()
    await persistMatch(db as unknown as ResultsDb, {
      roomId: 'room-1',
      startedAt: new Date('2026-09-04T10:00:00Z'),
      endedAt: new Date('2026-09-04T10:03:00Z'),
      winnerId: 'u1',
      players: [
        { userId: 'u1', nickname: 'A', kills: 5, deaths: 1, score: 500 },
        { userId: 'u2', nickname: 'B', kills: 1, deaths: 5, score: 100 },
      ],
    })
    expect(db.user.upsert).toHaveBeenCalledTimes(2)
    expect(db.match.create).toHaveBeenCalledOnce()
    const call = db.match.create.mock.calls[0]
    expect(call).toBeDefined()
    const arg = call![0]
    expect(arg.data.roomId).toBe('room-1')
    expect(arg.data.winnerId).toBe('u1')
    expect(arg.data.players.create).toHaveLength(2)
  })

  it('ohne DB oder ohne Spieler: No-Op', async () => {
    await persistMatch(null, {
      roomId: 'r',
      startedAt: new Date(),
      endedAt: new Date(),
      winnerId: null,
      players: [{ userId: 'u', nickname: 'A', kills: 0, deaths: 0, score: 0 }],
    })
    const db = mockDb()
    await persistMatch(db as unknown as ResultsDb, {
      roomId: 'r',
      startedAt: new Date(),
      endedAt: new Date(),
      winnerId: null,
      players: [],
    })
    expect(db.match.create).not.toHaveBeenCalled()
  })
})
