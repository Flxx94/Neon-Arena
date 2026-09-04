/** Sliding-Window Rate-Limits (M4-05): Memory oder Redis, gleiche API. */

export interface RateStore {
  /** Zaehlt Hit im Fenster, gibt aktuelle Anzahl zurueck. */
  hit(key: string, windowMs: number): Promise<number>
}

export class MemoryRateStore implements RateStore {
  private hits = new Map<string, number[]>()

  async hit(key: string, windowMs: number): Promise<number> {
    const now = Date.now()
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs)
    arr.push(now)
    this.hits.set(key, arr)
    return arr.length
  }

  clear(): void {
    this.hits.clear()
  }
}

/** Fixed-Window via INCR+EXPIRE (MVP-genau genug; fair über Nodes). */
export class RedisRateStore implements RateStore {
  constructor(private redis: { incr(key: string): Promise<number>; pExpire(key: string, ms: number): Promise<unknown> }) {}

  async hit(key: string, windowMs: number): Promise<number> {
    const count = await this.redis.incr(key)
    if (count === 1) await this.redis.pExpire(key, windowMs)
    return count
  }
}

/** true = erlaubt, false = ueber Limit. */
export async function checkLimit(store: RateStore, key: string, limit: number, windowMs: number): Promise<boolean> {
  return (await store.hit(key, windowMs)) <= limit
}

let store: RateStore | null = null

export function getRateStore(): RateStore {
  if (!store) store = new MemoryRateStore()
  return store
}

export function setRateStore(next: RateStore | null): void {
  store = next
}
