import { PrismaClient } from '@prisma/client'

let client: PrismaClient | null | undefined

/** Lazy Prisma-Client; null wenn Persistenz deaktiviert (Tests, DB-loses Dev). */
export function getDb(): PrismaClient | null {
  if (client !== undefined) return client
  const enabled = process.env.DB_ENABLED !== 'false' && process.env.NODE_ENV !== 'test'
  const url = process.env.DATABASE_URL
  if (!enabled || !url) {
    client = null
    return client
  }
  try {
    client = new PrismaClient()
    return client
  } catch {
    client = null
    return client
  }
}

/** Nur fuer Tests: Ruecksetzen des Caches. */
export function resetDbForTesting(): void {
  client = undefined
}
