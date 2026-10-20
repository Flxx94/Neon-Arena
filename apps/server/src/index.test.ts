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

  it('neue IP: /me -> 401; Namenswahl -> Cookie; Reload ueber Cookie UND ueber IP (ohne Cookie)', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      expect((await fetch(`${base}/me`)).status).toBe(401)
      const res = await fetch(`${base}/me`, { method: 'POST', headers: json, body: JSON.stringify({ nickname: 'Neo_1' }) })
      expect(res.status).toBe(201)
      const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!
      expect(cookie).toContain('na_guest=')
      const body = (await res.json()) as { userId: string; nickname: string }
      expect(body.nickname).toBe('Neo_1')

      const viaCookie = await fetch(`${base}/me`, { headers: { cookie } })
      expect(await viaCookie.json()).toEqual(body)
      // Ohne Cookie (z.B. Cookie geloescht): gleiche IP -> gleiches Profil.
      const viaIp = await fetch(`${base}/me`)
      expect(viaIp.status).toBe(200)
      expect(await viaIp.json()).toEqual(body)
      expect(viaIp.headers.get('set-cookie') ?? '').toContain('na_guest=')
    } finally {
      close()
    }
  })

  it('"Nicht du?": Logout + /me?auto=0 -> 401, neuer Name = neues Profil', async () => {
    const { port, close } = await listen()
    const base = `http://127.0.0.1:${port}`
    try {
      const a = await fetch(`${base}/me`, { method: 'POST', headers: json, body: JSON.stringify({ nickname: 'Alt' }) })
      const cookie = (a.headers.get('set-cookie') ?? '').split(';')[0]!
      const old = (await a.json()) as { userId: string }
      expect((await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie } })).status).toBe(204)
      expect((await fetch(`${base}/me?auto=0`)).status).toBe(401)
      const b = await fetch(`${base}/me`, { method: 'POST', headers: json, body: JSON.stringify({ nickname: 'Neu' }) })
      const fresh = (await b.json()) as { userId: string; nickname: string }
      expect(fresh.userId).not.toBe(old.userId)
      expect(((await (await fetch(`${base}/me`)).json()) as { nickname: string }).nickname).toBe('Neu')
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
      expect(((await (await fetch(`${base}/me?auto=1`)).json()) as { nickname: string }).nickname).toBe('Zweit')
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
      expect(((await (await fetch(`${base}/me`)).json()) as { skin: number }).skin).toBe(17)
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
