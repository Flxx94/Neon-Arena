import { beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import {
  ACCOUNT_TTL_SECONDS,
  checkGuestSession,
  clearSessionCookie,
  issueGuest,
  issueSession,
  verifyGuest,
} from './guest.js'
import { MemorySessionStore, setSessionStore } from './sessions.js'

beforeEach(() => {
  setSessionStore(new MemorySessionStore())
})

describe('guest auth (M4-02)', () => {
  it('issue -> verify Roundtrip', async () => {
    const { identity, cookie } = await issueGuest('Neo_1')
    expect(identity.nickname).toBe('Neo_1')
    expect(cookie).toContain('na_guest=')
    expect(cookie).toContain('HttpOnly')
    const token = cookie.split(';')[0]!.split('=')[1]!
    expect(await verifyGuest(token)).toEqual(identity)
  })

  it('fremdes Token wird abgewiesen', async () => {
    expect(await checkGuestSession(randomUUID())).toBe(false)
    const { identity } = await issueGuest('Echt')
    expect(await checkGuestSession(identity.userId)).toBe(true)
    expect(await checkGuestSession(undefined)).toBe(false)
  })

  it('manipuliertes Token wird abgewiesen', async () => {
    const { cookie } = await issueGuest('Neo_2')
    const token = cookie.split(';')[0]!.split('=')[1]!
    const tampered = token.slice(0, -2) + 'xx'
    expect(await verifyGuest(tampered)).toBeNull()
    expect(await verifyGuest('garbage')).toBeNull()
  })

  it('ungueltiger Nickname wird abgewiesen', async () => {
    await expect(issueGuest('<script>')).rejects.toThrow()
  })
})

describe('Konto-Session (ADR-005)', () => {
  it('Konto-Identitaet bleibt beim Verify erhalten (isGuest=false, Email, Skin, 7 Tage)', async () => {
    const { identity, cookie } = await issueSession(
      { userId: randomUUID(), nickname: 'Konto', isGuest: false, skin: 13, email: 'k@example.com' },
      ACCOUNT_TTL_SECONDS,
    )
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain(`Max-Age=${ACCOUNT_TTL_SECONDS}`)
    const token = cookie.split(';')[0]!.split('=')[1]!
    expect(await verifyGuest(token)).toEqual(identity)
    expect(identity.isGuest).toBe(false)
  })

  it('Gast ist isGuest=true, Logout-Cookie ist abgelaufen', async () => {
    const { identity } = await issueGuest('Gast_1')
    expect(identity.isGuest).toBe(true)
    expect(clearSessionCookie()).toMatch(/Max-Age=0/)
  })
})
