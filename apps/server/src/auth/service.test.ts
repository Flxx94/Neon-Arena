import { describe, expect, it } from 'vitest'
import { MemoryAccountStore, PrismaAccountStore, type AccountDb } from './accounts.js'
import { loginAccount, registerAccount } from './service.js'

const valid = { email: 'Neo@Example.com', password: 'sehr-geheim-123', nickname: 'Neo_1' }

describe('Registrierung', () => {
  it('legt Konto an (Email normalisiert, Passwort nur gehasht)', async () => {
    const store = new MemoryAccountStore()
    const r = await registerAccount(valid, store)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.account.email).toBe('neo@example.com')
    expect(r.account.nickname).toBe('Neo_1')
    expect(r.account.passwordHash).not.toContain('sehr-geheim')
    expect((await store.findByEmail('neo@example.com'))?.id).toBe(r.account.id)
  })

  it('doppelte Email (auch anders geschrieben) -> 409', async () => {
    const store = new MemoryAccountStore()
    expect((await registerAccount(valid, store)).ok).toBe(true)
    const again = await registerAccount({ ...valid, email: '  NEO@example.COM ' }, store)
    expect(again).toMatchObject({ ok: false, status: 409, error: 'EMAIL_TAKEN' })
  })

  it('ungueltige Eingaben -> 400 mit Feld-Code', async () => {
    const store = new MemoryAccountStore()
    expect(await registerAccount({ ...valid, email: 'kein-email' }, store)).toMatchObject({
      status: 400,
      error: 'INVALID_EMAIL',
    })
    expect(await registerAccount({ ...valid, password: 'kurz' }, store)).toMatchObject({
      status: 400,
      error: 'INVALID_PASSWORD',
    })
    expect(await registerAccount({ ...valid, nickname: '<script>' }, store)).toMatchObject({
      status: 400,
      error: 'INVALID_NICKNAME',
    })
    expect(await registerAccount(null, store)).toMatchObject({ status: 400 })
  })
})

describe('Login', () => {
  it('richtige Daten -> Konto, falsches Passwort / unbekannte Email -> gleiche generische 401', async () => {
    const store = new MemoryAccountStore()
    await registerAccount(valid, store)
    const ok = await loginAccount({ email: 'neo@example.com', password: valid.password }, store)
    expect(ok.ok).toBe(true)
    const wrong = await loginAccount({ email: 'neo@example.com', password: 'falsch-falsch' }, store)
    const unknown = await loginAccount({ email: 'wer@example.com', password: 'egal-egal-egal' }, store)
    expect(wrong).toEqual({ ok: false, status: 401, error: 'INVALID_CREDENTIALS' })
    expect(unknown).toEqual(wrong)
  })

  it('Skin wird gespeichert und beim Login zurueckgegeben', async () => {
    const store = new MemoryAccountStore()
    const r = await registerAccount(valid, store)
    if (!r.ok) throw new Error('register failed')
    await store.setSkin(r.account.id, 14)
    const again = await loginAccount({ email: valid.email, password: valid.password }, store)
    expect(again.ok && again.account.skin).toBe(14)
  })
})

describe('PrismaAccountStore (gemockte DB)', () => {
  it('uebersetzt Unique-Verletzung (P2002) in false und ignoriert Gast-Zeilen', async () => {
    const rows = new Map<string, { id: string; email: string | null; nickname: string; passwordHash: string | null; skin: number; createdAt: Date }>()
    const db: AccountDb = {
      user: {
        create: async ({ data }) => {
          for (const r of rows.values()) if (r.email === data.email) throw Object.assign(new Error('dup'), { code: 'P2002' })
          rows.set(data.id, { ...data, createdAt: new Date() })
          return null
        },
        findUnique: async ({ where }) => {
          if ('id' in where) return rows.get(where.id) ?? null
          return [...rows.values()].find((r) => r.email === where.email) ?? null
        },
        update: async ({ where, data }) => {
          const r = rows.get(where.id)
          if (r) r.skin = data.skin
          return null
        },
      },
    }
    const store = new PrismaAccountStore(db)
    const acc = { id: 'u1', email: 'a@b.de', nickname: 'A', passwordHash: 'h', skin: 0, createdAt: 1 }
    expect(await store.create(acc)).toBe(true)
    expect(await store.create({ ...acc, id: 'u2' })).toBe(false)
    await store.setSkin('u1', 9)
    expect((await store.findByEmail('a@b.de'))?.skin).toBe(9)
    // Gast-Zeile (ohne email/passwordHash) ist kein Konto:
    rows.set('g1', { id: 'g1', email: null, nickname: 'G', passwordHash: null, skin: 0, createdAt: new Date() })
    expect(await store.findById('g1')).toBeNull()
  })
})
