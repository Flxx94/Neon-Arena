import { beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'net'
import { MemoryProfileStore, setProfileStore } from './auth/profiles.js'
import { MemoryBanStore, setBanStore } from './db/bans.js'
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
  setProfileStore(new MemoryProfileStore())
  setBanStore(new MemoryBanStore())
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

describe('Profile pro IP (ADR-014)', () => {
  const json = { 'content-type': 'application/json' }

  it('neuer Browser: /me -> 401; Namenswahl -> Cookie + Token; Reload ueber Cookie ODER Bearer', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      expect((await fetch(`${base}/me`)).status).toBe(401)
      const res = await fetch(`${base}/me`, { method: 'POST', headers: json, body: JSON.stringify({ nickname: 'Neo_1' }) })
      expect(res.status).toBe(201)
      const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!
      expect(cookie).toContain('na_guest=')
      const body = (await res.json()) as { userId: string; nickname: string; token: string }
      expect(body.nickname).toBe('Neo_1')
      expect(cookie).toContain(body.token)

      const viaCookie = await fetch(`${base}/me`, { headers: { cookie } })
      expect(viaCookie.status).toBe(200)
      expect(((await viaCookie.json()) as { userId: string }).userId).toBe(body.userId)
      const viaBearer = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${body.token}` } })
      expect(viaBearer.status).toBe(200)
      expect(((await viaBearer.json()) as { nickname: string }).nickname).toBe('Neo_1')
      expect((await fetch(`${base}/me`, { headers: { authorization: 'Bearer kaputt' } })).status).toBe(401)
    } finally {
      close()
    }
  })

  it('geteiltes Netz: zwei Browser mit derselben IP haben getrennte Profile (kein Auto-Login ueber die IP)', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      const h = { ...json, 'x-forwarded-for': '10.0.0.1' }
      const a = (await (await fetch(`${base}/me`, { method: 'POST', headers: h, body: JSON.stringify({ nickname: 'Anna' }) })).json()) as { userId: string; token: string }
      // Zweiter Browser (kein Cookie/Token), gleiche IP: bekommt NICHT Annas Profil.
      expect((await fetch(`${base}/me`, { headers: { 'x-forwarded-for': '10.0.0.1' } })).status).toBe(401)
      const b = (await (await fetch(`${base}/me`, { method: 'POST', headers: h, body: JSON.stringify({ nickname: 'Ben' }) })).json()) as { userId: string; token: string }
      expect(b.userId).not.toBe(a.userId)
      const meA = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${a.token}`, 'x-forwarded-for': '10.0.0.1' } })
      const meB = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${b.token}`, 'x-forwarded-for': '10.0.0.1' } })
      expect(((await meA.json()) as { nickname: string }).nickname).toBe('Anna')
      expect(((await meB.json()) as { nickname: string }).nickname).toBe('Ben')
    } finally {
      close()
    }
  })

  it('Server-Neustart (Session weg): gueltiges Token baut die Session aus dem Profil neu auf', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      const a = (await (await fetch(`${base}/me`, { method: 'POST', headers: json, body: JSON.stringify({ nickname: 'Treu' }) })).json()) as { token: string }
      await fetch(`${base}/me/skin`, { method: 'PATCH', headers: { ...json, authorization: `Bearer ${a.token}` }, body: JSON.stringify({ skin: 9 }) })
      setSessionStore(new MemorySessionStore()) // Neustart ohne Redis
      const me = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${a.token}` } })
      expect(me.status).toBe(200)
      expect(await me.json()).toMatchObject({ nickname: 'Treu', skin: 9 })
    } finally {
      close()
    }
  })

  it('"Nicht du?": Logout loescht das Cookie, neuer Name = neues Profil', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      const a = await fetch(`${base}/me`, { method: 'POST', headers: json, body: JSON.stringify({ nickname: 'Alt' }) })
      const old = (await a.json()) as { userId: string; token: string }
      const out = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${old.token}` } })
      expect(out.status).toBe(204)
      expect(out.headers.get('set-cookie') ?? '').toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/)
      const b = await fetch(`${base}/me`, { method: 'POST', headers: json, body: JSON.stringify({ nickname: 'Neu' }) })
      expect(((await b.json()) as { userId: string }).userId).not.toBe(old.userId)
    } finally {
      close()
    }
  })

  it('Namenswahl: ungueltig -> 400, Flood -> 429', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      const bad = await fetch(`${base}/me`, { method: 'POST', headers: json, body: JSON.stringify({ nickname: '<script>' }) })
      expect(bad.status).toBe(400)
      let last = 0
      for (let i = 0; i < 6; i++) {
        const r = await fetch(`${base}/me`, { method: 'POST', headers: json, body: JSON.stringify({ nickname: `Flood${i}` }) })
        last = r.status
        await r.text()
      }
      expect(last).toBe(429)
    } finally {
      close()
    }
  })

  it('Umbenennen: PATCH /me/name aendert Name in Session + Profil, ohne Session 401, ungueltig 400', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      expect((await fetch(`${base}/me/name`, { method: 'PATCH', headers: json, body: JSON.stringify({ nickname: 'X' }) })).status).toBe(401)
      const a = await fetch(`${base}/me`, { method: 'POST', headers: json, body: JSON.stringify({ nickname: 'Erst' }) })
      const cookie = (a.headers.get('set-cookie') ?? '').split(';')[0]!
      const r = await fetch(`${base}/me/name`, { method: 'PATCH', headers: { ...json, cookie }, body: JSON.stringify({ nickname: 'Zweit' }) })
      expect(r.status).toBe(200)
      expect(((await r.json()) as { nickname: string }).nickname).toBe('Zweit')
      expect(((await (await fetch(`${base}/me`, { headers: { cookie } })).json()) as { nickname: string }).nickname).toBe('Zweit')
      const bad = await fetch(`${base}/me/name`, { method: 'PATCH', headers: { ...json, cookie }, body: JSON.stringify({ nickname: 'a b' }) })
      expect(bad.status).toBe(400)
    } finally {
      close()
    }
  })

  it('Skin wird am Profil gemerkt; ungueltiger Skin -> 400; ohne Session 401', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      expect((await fetch(`${base}/me/skin`, { method: 'PATCH', headers: json, body: JSON.stringify({ skin: 1 }) })).status).toBe(401)
      const a = await fetch(`${base}/me`, { method: 'POST', headers: json, body: JSON.stringify({ nickname: 'Look' }) })
      const cookie = (a.headers.get('set-cookie') ?? '').split(';')[0]!
      expect((await fetch(`${base}/me/skin`, { method: 'PATCH', headers: { ...json, cookie }, body: JSON.stringify({ skin: 9999 }) })).status).toBe(400)
      expect((await fetch(`${base}/me/skin`, { method: 'PATCH', headers: { ...json, cookie }, body: JSON.stringify({ skin: 17 }) })).status).toBe(200)
      expect(((await (await fetch(`${base}/me`, { headers: { cookie } })).json()) as { skin: number }).skin).toBe(17)
    } finally {
      close()
    }
  })

  it('gebannte IP: /me und Namenswahl -> 403 BANNED', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      const bans = new MemoryBanStore()
      await bans.add({ ip: '9.9.9.9', nickname: 'Boese', at: Date.now() })
      setBanStore(bans)
      const h = { 'x-forwarded-for': '9.9.9.9' }
      expect((await fetch(`${base}/me`, { headers: h })).status).toBe(403)
      const r = await fetch(`${base}/me`, { method: 'POST', headers: { ...json, ...h }, body: JSON.stringify({ nickname: 'Boese' }) })
      expect(r.status).toBe(403)
      expect(await r.json()).toEqual({ error: 'BANNED' })
    } finally {
      close()
    }
  })

  it('alte Konto-Routen sind weg; Leaderboard ohne DB -> 503', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      for (const path of ['/auth/register', '/auth/login', '/auth/guest']) {
        expect((await fetch(`${base}${path}`, { method: 'POST', headers: json, body: '{}' })).status).toBe(404)
      }
      expect((await fetch(`${base}/leaderboard?sort=kd`)).status).toBe(503)
      expect((await fetch(`${base}/history/x`)).status).toBe(404)
    } finally {
      close()
    }
  })
})
