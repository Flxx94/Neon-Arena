import { getRedis } from './redis.js'

/** Eintrag der IP-Bann-Liste (Admin-Panel). */
export interface BanEntry {
  ip: string
  /** Nickname zum Zeitpunkt des Banns (nur zur Orientierung im Panel). */
  nickname: string
  at: number
}

/**
 * IP-Banns: Memory (Dev/Tests) oder Redis-Hash `bans:ip` (ueberlebt Neustarts, wirkt ueber alle Nodes).
 * IPs sind personenbezogen: nur der Admin sieht sie, sie landen weder im State noch in Logs.
 */
export interface BanStore {
  isBanned(ip: string): Promise<boolean>
  add(entry: BanEntry): Promise<void>
  remove(ip: string): Promise<boolean>
  list(): Promise<BanEntry[]>
}

export class MemoryBanStore implements BanStore {
  private bans = new Map<string, BanEntry>()

  async isBanned(ip: string): Promise<boolean> {
    return this.bans.has(normalizeIp(ip))
  }

  async add(entry: BanEntry): Promise<void> {
    const ip = normalizeIp(entry.ip)
    this.bans.set(ip, { ...entry, ip })
  }

  async remove(ip: string): Promise<boolean> {
    return this.bans.delete(normalizeIp(ip))
  }

  async list(): Promise<BanEntry[]> {
    return [...this.bans.values()].sort((a, b) => b.at - a.at)
  }

  clear(): void {
    this.bans.clear()
  }
}

interface RedisLike {
  hExists(key: string, field: string): Promise<boolean | number>
  hSet(key: string, field: string, value: string): Promise<unknown>
  hDel(key: string, field: string): Promise<number>
  hGetAll(key: string): Promise<Record<string, string>>
}

const KEY = 'bans:ip'

export class RedisBanStore implements BanStore {
  constructor(private redis: RedisLike) {}

  async isBanned(ip: string): Promise<boolean> {
    return Boolean(await this.redis.hExists(KEY, normalizeIp(ip)))
  }

  async add(entry: BanEntry): Promise<void> {
    const ip = normalizeIp(entry.ip)
    await this.redis.hSet(KEY, ip, JSON.stringify({ ...entry, ip }))
  }

  async remove(ip: string): Promise<boolean> {
    return (await this.redis.hDel(KEY, normalizeIp(ip))) > 0
  }

  async list(): Promise<BanEntry[]> {
    const all = await this.redis.hGetAll(KEY)
    const out: BanEntry[] = []
    for (const raw of Object.values(all)) {
      try {
        out.push(JSON.parse(raw) as BanEntry)
      } catch {
        /* defekter Eintrag ignorieren */
      }
    }
    return out.sort((a, b) => b.at - a.at)
  }
}

/** `::ffff:1.2.3.4` (IPv4-mapped) und `1.2.3.4` sind dieselbe Adresse; Gross-/Kleinschreibung egal. */
export function normalizeIp(ip: string): string {
  const s = ip.trim().toLowerCase()
  return s.startsWith('::ffff:') && s.includes('.') ? s.slice(7) : s
}

let store: BanStore | null = null
let initialised = false

/** Redis wenn verfuegbar, sonst Memory. */
export async function getBanStore(): Promise<BanStore> {
  if (store) return store
  if (!initialised) {
    initialised = true
    const redis = await getRedis()
    store = redis ? new RedisBanStore(redis as unknown as RedisLike) : new MemoryBanStore()
  }
  return store ?? (store = new MemoryBanStore())
}

/** Nur fuer Tests. */
export function setBanStore(next: BanStore | null): void {
  store = next
  initialised = next !== null
}
