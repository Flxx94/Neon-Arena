import { beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import { checkGuestSession, issueGuest, verifyGuest } from './guest.js'
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
