import { createClient, type RedisClientType } from 'redis'

let client: RedisClientType | null | undefined
let connecting: Promise<RedisClientType> | null = null

/** Lazy Redis-Client; null wenn deaktiviert (Tests, DB-loses Dev). */
export async function getRedis(): Promise<RedisClientType | null> {
  if (client !== undefined) return client
  const enabled = process.env.DB_ENABLED !== 'false' && process.env.NODE_ENV !== 'test'
  const url = process.env.REDIS_URL
  if (!enabled || !url) {
    client = null
    return client
  }
  try {
    const c = createClient({ url }) as RedisClientType
    connecting = c.connect().then(() => c)
    client = await connecting
    return client
  } catch {
    client = null
    return client
  }
}

/** Nur fuer Tests. */
export function resetRedisForTesting(): void {
  client = undefined
  connecting = null
}
