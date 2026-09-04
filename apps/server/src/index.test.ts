import { beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'net'
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
