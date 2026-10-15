import { beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'net'
import { MemoryAccountStore, setAccountStore } from './auth/accounts.js'
import { MemorySessionStore, setSessionStore } from './auth/sessions.js'
import { createApp } from './index.js'
import { MemoryRateStore, setRateStore } from './ratelimit/limiter.js'

async function listen() {
  const app = createApp()
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.on('listening', () => resolve()))
  const port = (server.address() as AddressInfo).port
  return { port, close: () => server.close() }
}

beforeEach(() => {
  setSessionStore(new MemorySessionStore())
  setRateStore(new MemoryRateStore())
  setAccountStore(new MemoryAccountStore())
})

describe('GET /health (M0-05)', () => {
  it('antwortet 200 mit status ok', async () => {
    const { port, close } = await listen()
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string }
      expect(body.status).toBe('ok')
    } finally {
      close()
    }
  })
})

describe('auth + leaderboard routen (M4)', () => {
  it('POST /auth/guest -> Cookie, GET /me behaelt Identitaet', async () => {
    const { port, close } = await listen()
    try {
      const res = await fetch(`http://127.0.0.1:${port}/auth/guest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nickname: 'Reload' }),
      })
      expect(res.status).toBe(200)
      const setCookie = res.headers.get('set-cookie') ?? ''
      expect(setCookie).toContain('na_guest=')
      const cookie = setCookie.split(';')[0]!
      const body = (await res.json()) as { userId: string; nickname: string }
      expect(body.nickname).toBe('Reload')

      const me = await fetch(`http://127.0.0.1:${port}/me`, { headers: { cookie } })
      expect(me.status).toBe(200)
      expect(await me.json()).toEqual(body)
    } finally {
      close()
    }
  })

  it('POST /auth/guest mit 6x schnell -> 429 (M4-05)', async () => {
    const { port, close } = await listen()
    try {
      let last = 0
      for (let i = 0; i < 6; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/auth/guest`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nickname: `Flood${i}` }),
        })
        last = res.status
        await res.text()
      }
      expect(last).toBe(429)
    } finally {
      close()
    }
  })

  it('GET /leaderboard ohne DB -> 503', async () => {
    const { port, close } = await listen()
    try {
      const res = await fetch(`http://127.0.0.1:${port}/leaderboard`)
      // NODE_ENV=test -> DB deaktiviert.
      expect(res.status).toBe(503)
    } finally {
      close()
    }
  })
})

describe('Konten: register / login / logout / skin (ADR-005)', () => {
  const json = { 'content-type': 'application/json' }
  const account = { email: 'Spieler@Example.com', password: 'sehr-geheim-123', nickname: 'Spieler_1' }

  it('Registrieren -> Cookie + /me; Logout loescht die Session', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      const res = await fetch(`${base}/auth/register`, { method: 'POST', headers: json, body: JSON.stringify(account) })
      expect(res.status).toBe(201)
      const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!
      expect(cookie).toContain('na_guest=')
      const body = (await res.json()) as Record<string, unknown>
      expect(body).toMatchObject({ nickname: 'Spieler_1', isGuest: false, email: 'spieler@example.com' })
      expect(JSON.stringify(body)).not.toContain('sehr-geheim')

      const me = await fetch(`${base}/me`, { headers: { cookie } })
      expect(me.status).toBe(200)
      expect(await me.json()).toEqual(body)

      const out = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie } })
      expect(out.status).toBe(204)
      expect(out.headers.get('set-cookie') ?? '').toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/)
      expect((await fetch(`${base}/me`, { headers: { cookie } })).status).toBe(401)
    } finally {
      close()
    }
  })

  it('doppelte Email -> 409, ungueltige Eingabe -> 400, Passwort wird nie zurueckgegeben', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      const post = (b: unknown) => fetch(`${base}/auth/register`, { method: 'POST', headers: json, body: JSON.stringify(b) })
      expect((await post(account)).status).toBe(201)
      const dup = await post({ ...account, nickname: 'Anderer' })
      expect(dup.status).toBe(409)
      expect(await dup.json()).toEqual({ error: 'EMAIL_TAKEN' })
      const bad = await post({ ...account, email: 'x', password: '1' })
      expect(bad.status).toBe(400)
    } finally {
      close()
    }
  })

  it('Login: richtig -> 200 + Skin aus dem Konto; falsch -> 401 generisch', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      const reg = await fetch(`${base}/auth/register`, { method: 'POST', headers: json, body: JSON.stringify(account) })
      const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0]!
      const skinRes = await fetch(`${base}/me/skin`, { method: 'PATCH', headers: { ...json, cookie }, body: JSON.stringify({ skin: 17 }) })
      expect(skinRes.status).toBe(200)

      const ok = await fetch(`${base}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: 'spieler@example.com', password: account.password }) })
      expect(ok.status).toBe(200)
      expect(await ok.json()).toMatchObject({ nickname: 'Spieler_1', skin: 17, isGuest: false })

      const wrong = await fetch(`${base}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: 'spieler@example.com', password: 'falsch-falsch' }) })
      expect(wrong.status).toBe(401)
      expect(await wrong.json()).toEqual({ error: 'INVALID_CREDENTIALS' })
    } finally {
      close()
    }
  })

  it('PATCH /me/skin: ohne Session 401, ungueltiger Skin 400', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      const anon = await fetch(`${base}/me/skin`, { method: 'PATCH', headers: json, body: JSON.stringify({ skin: 1 }) })
      expect(anon.status).toBe(401)
      const reg = await fetch(`${base}/auth/register`, { method: 'POST', headers: json, body: JSON.stringify(account) })
      const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0]!
      const bad = await fetch(`${base}/me/skin`, { method: 'PATCH', headers: { ...json, cookie }, body: JSON.stringify({ skin: 9999 }) })
      expect(bad.status).toBe(400)
    } finally {
      close()
    }
  })

  it('Login-Flood pro Email -> 429', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      let last = 0
      for (let i = 0; i < 10; i++) {
        const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: 'opfer@example.com', password: `falsch-${i}-xxxx` }) })
        last = r.status
        await r.text()
      }
      expect(last).toBe(429)
    } finally {
      close()
    }
  })
})
