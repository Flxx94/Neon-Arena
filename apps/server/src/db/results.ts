/** Rundenende async nach Postgres (M4-03): non-blocking, null-sicher ohne DB. */

export interface MatchRow {
  userId: string
  nickname: string
  kills: number
  deaths: number
  score: number
}

export interface PersistInput {
  roomId: string
  startedAt: Date
  endedAt: Date
  winnerId: string | null
  players: MatchRow[]
}

/** Minimale Prisma-Form (mockbar in Tests). */
export interface ResultsDb {
  match: {
    create: (args: {
      data: {
        roomId: string
        startedAt: Date
        endedAt: Date
        winnerId: string | null
        players: { create: Omit<MatchRow, 'nickname'>[] }
      }
    }) => Promise<unknown>
  }
  user: {
    upsert: (args: {
      where: { id: string }
      update: { nickname: string }
      create: { id: string; nickname: string; isGuest: boolean }
    }) => Promise<unknown>
  }
}

export async function persistMatch(db: ResultsDb | null, input: PersistInput): Promise<void> {
  if (!db || input.players.length === 0) return
  // User-Zeilen sicherstellen (Gast wurde ggf. ohne DB ausgestellt).
  for (const p of input.players) {
    await db.user.upsert({
      where: { id: p.userId },
      update: { nickname: p.nickname },
      create: { id: p.userId, nickname: p.nickname, isGuest: true },
    })
  }
  await db.match.create({
    data: {
      roomId: input.roomId,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      winnerId: input.winnerId,
      players: {
        // MatchPlayer hat keinen Nickname (steht in User via upsert oben).
        create: input.players.map((p) => ({
          userId: p.userId,
          kills: p.kills,
          deaths: p.deaths,
          score: p.score,
        })),
      },
    },
  })
}
