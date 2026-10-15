import { getDb } from '../db/prisma.js'

export interface Account {
  id: string
  email: string
  nickname: string
  passwordHash: string
  skin: number
  createdAt: number
}

export interface AccountStore {
  /** false = Email existiert bereits. */
  create(account: Account): Promise<boolean>
  findByEmail(email: string): Promise<Account | null>
  findById(id: string): Promise<Account | null>
  setSkin(id: string, skin: number): Promise<void>
}

/**
 * In-Memory (Dev/Tests und DB-loser Betrieb). ACHTUNG: Konten gehen beim Neustart verloren –
 * fuer dauerhafte Konten DB_ENABLED=true + DATABASE_URL setzen (siehe docs/DEPLOY-FREE.md).
 */
export class MemoryAccountStore implements AccountStore {
  private byId = new Map<string, Account>()
  private byEmail = new Map<string, string>()

  async create(account: Account): Promise<boolean> {
    if (this.byEmail.has(account.email)) return false
    this.byId.set(account.id, { ...account })
    this.byEmail.set(account.email, account.id)
    return true
  }

  async findByEmail(email: string): Promise<Account | null> {
    const id = this.byEmail.get(email)
    const a = id ? this.byId.get(id) : undefined
    return a ? { ...a } : null
  }

  async findById(id: string): Promise<Account | null> {
    const a = this.byId.get(id)
    return a ? { ...a } : null
  }

  async setSkin(id: string, skin: number): Promise<void> {
    const a = this.byId.get(id)
    if (a) a.skin = skin
  }

  clear(): void {
    this.byId.clear()
    this.byEmail.clear()
  }
}

interface DbUser {
  id: string
  email: string | null
  nickname: string
  passwordHash: string | null
  skin: number
  createdAt: Date
}

/** Minimale Prisma-Form (mockbar in Tests). */
export interface AccountDb {
  user: {
    create: (args: {
      data: {
        id: string
        email: string
        nickname: string
        passwordHash: string
        skin: number
        isGuest: boolean
      }
    }) => Promise<unknown>
    findUnique: (args: { where: { email: string } | { id: string } }) => Promise<DbUser | null>
    update: (args: { where: { id: string }; data: { skin: number } }) => Promise<unknown>
  }
}

function toAccount(u: DbUser): Account | null {
  if (!u.email || !u.passwordHash) return null // Gast-Zeile, kein Konto
  return {
    id: u.id,
    email: u.email,
    nickname: u.nickname,
    passwordHash: u.passwordHash,
    skin: u.skin,
    createdAt: u.createdAt.getTime(),
  }
}

export class PrismaAccountStore implements AccountStore {
  constructor(private db: AccountDb) {}

  async create(account: Account): Promise<boolean> {
    try {
      await this.db.user.create({
        data: {
          id: account.id,
          email: account.email,
          nickname: account.nickname,
          passwordHash: account.passwordHash,
          skin: account.skin,
          isGuest: false,
        },
      })
      return true
    } catch (err) {
      // P2002 = Unique-Constraint (Email schon vergeben, auch bei gleichzeitiger Registrierung).
      if ((err as { code?: string } | null)?.code === 'P2002') return false
      throw err
    }
  }

  async findByEmail(email: string): Promise<Account | null> {
    const u = await this.db.user.findUnique({ where: { email } })
    return u ? toAccount(u) : null
  }

  async findById(id: string): Promise<Account | null> {
    const u = await this.db.user.findUnique({ where: { id } })
    return u ? toAccount(u) : null
  }

  async setSkin(id: string, skin: number): Promise<void> {
    await this.db.user.update({ where: { id }, data: { skin } })
  }
}

let store: AccountStore | null = null
let memory: MemoryAccountStore | null = null

/** DB vorhanden -> Postgres, sonst In-Memory. */
export function getAccountStore(): AccountStore {
  if (store) return store
  const db = getDb()
  if (db) return new PrismaAccountStore(db as unknown as AccountDb)
  memory ??= new MemoryAccountStore()
  return memory
}

/** Nur fuer Tests. */
export function setAccountStore(s: AccountStore | null): void {
  store = s
  if (s === null) memory = null
}
