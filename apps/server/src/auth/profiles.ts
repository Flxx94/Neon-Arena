import { randomUUID } from 'node:crypto'
import { normalizeIp } from '../db/bans.js'
import { getDb } from '../db/prisma.js'

/** Spielerprofil: Anzeigename + Look, gebunden an die (normalisierte) IP. */
export interface Profile {
  id: string
  nickname: string
  skin: number
  ip: string
}

export interface ProfileStore {
  /** Profil per ID (Session-Wiederherstellung nach Server-Neustart). */
  findById(id: string): Promise<Profile | null>
  create(nickname: string, ip: string): Promise<Profile>
  rename(id: string, nickname: string): Promise<void>
  setSkin(id: string, skin: number): Promise<void>
}

/** In-Memory (Dev/Tests, DB-loser Betrieb): Profile gehen beim Neustart verloren. */
export class MemoryProfileStore implements ProfileStore {
  private list: Profile[] = []

  async findById(id: string): Promise<Profile | null> {
    const p = this.list.find((x) => x.id === id)
    return p ? { ...p } : null
  }

  async create(nickname: string, ip: string): Promise<Profile> {
    const p: Profile = { id: randomUUID(), nickname, skin: 0, ip: normalizeIp(ip) }
    this.list.push(p)
    return { ...p }
  }

  async rename(id: string, nickname: string): Promise<void> {
    const p = this.list.find((x) => x.id === id)
    if (p) p.nickname = nickname
  }

  async setSkin(id: string, skin: number): Promise<void> {
    const p = this.list.find((x) => x.id === id)
    if (p) p.skin = skin
  }
}

interface DbRow {
  id: string
  nickname: string
  skin: number
  ip: string | null
}

/** Minimale Prisma-Form (mockbar in Tests). */
export interface ProfileDb {
  user: {
    create: (args: { data: { id: string; nickname: string; ip: string; skin: number; isGuest: boolean } }) => Promise<unknown>
    findUnique: (args: { where: { id: string } }) => Promise<DbRow | null>
    update: (args: { where: { id: string }; data: { nickname: string } | { skin: number } }) => Promise<unknown>
  }
}

export class PrismaProfileStore implements ProfileStore {
  constructor(private db: ProfileDb) {}

  async findById(id: string): Promise<Profile | null> {
    const u = await this.db.user.findUnique({ where: { id } })
    return u ? { id: u.id, nickname: u.nickname, skin: u.skin, ip: u.ip ?? '' } : null
  }

  async create(nickname: string, ip: string): Promise<Profile> {
    const p: Profile = { id: randomUUID(), nickname, skin: 0, ip: normalizeIp(ip) }
    await this.db.user.create({ data: { id: p.id, nickname, ip: p.ip, skin: 0, isGuest: false } })
    return p
  }

  async rename(id: string, nickname: string): Promise<void> {
    await this.db.user.update({ where: { id }, data: { nickname } })
  }

  async setSkin(id: string, skin: number): Promise<void> {
    await this.db.user.update({ where: { id }, data: { skin } })
  }
}

let store: ProfileStore | null = null
let memory: MemoryProfileStore | null = null

/** DB vorhanden -> Postgres, sonst In-Memory. */
export function getProfileStore(): ProfileStore {
  if (store) return store
  const db = getDb()
  if (db) return new PrismaProfileStore(db as unknown as ProfileDb)
  memory ??= new MemoryProfileStore()
  return memory
}

/** Nur fuer Tests. */
export function setProfileStore(s: ProfileStore | null): void {
  store = s
  if (s === null) memory = null
}
