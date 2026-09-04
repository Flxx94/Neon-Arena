import type { RedisClientType } from 'redis'

export interface Session {
  userId: string
  nickname: string
  createdAt: number
}

export interface SessionStore {
  create(session: Session): Promise<void>
  get(userId: string): Promise<Session | null>
}

/** In-Memory (Dev/Tests). Kein TTL-Eviction – MVP ok, Prod nutzt Redis. */
export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>()

  async create(session: Session): Promise<void> {
    this.sessions.set(session.userId, session)
  }

  async get(userId: string): Promise<Session | null> {
    return this.sessions.get(userId) ?? null
  }

  clear(): void {
    this.sessions.clear()
  }
}

const SESSION_TTL_SECONDS = 24 * 3600

/** Redis (`session:*`, TTL 24 h) fuer Multi-Node-Betrieb (M4-02). */
export class RedisSessionStore implements SessionStore {
  constructor(private redis: RedisClientType) {}

  async create(session: Session): Promise<void> {
    await this.redis.set(`session:${session.userId}`, JSON.stringify(session), { EX: SESSION_TTL_SECONDS })
  }

  async get(userId: string): Promise<Session | null> {
    const raw = await this.redis.get(`session:${userId}`)
    if (!raw) return null
    try {
      return JSON.parse(raw) as Session
    } catch {
      return null
    }
  }
}

let store: SessionStore | null = null

/** Globaler Store; Tests koennen per setSessionStore ueberschreiben. */
export function getSessionStore(): SessionStore {
  if (!store) store = new MemorySessionStore()
  return store
}

export function setSessionStore(next: SessionStore | null): void {
  store = next
}
