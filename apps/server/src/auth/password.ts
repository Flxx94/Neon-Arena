import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/**
 * Passwort-Hashing mit scrypt (Node-eigen, keine Abhaengigkeit). Format:
 * `scrypt$N$r$p$salt(b64)$hash(b64)` – Parameter stehen im Hash, damit sie spaeter erhoeht werden koennen.
 */
const N = 2 ** 15
const R = 8
const P = 1
const KEYLEN = 64
const MAXMEM = 96 * 1024 * 1024

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, N, R, P)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}

/** Konstantzeit-Vergleich; kaputte/fremde Formate -> false (nie werfen). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  // Parameter-Grenzen: ein manipulierter Datensatz darf keinen Speicher-/CPU-Angriff ausloesen.
  if (!Number.isInteger(n) || n < 2 ** 10 || n > 2 ** 16) return false
  if (!Number.isInteger(r) || r < 1 || r > 16) return false
  if (!Number.isInteger(p) || p < 1 || p > 4) return false
  try {
    const salt = Buffer.from(parts[4]!, 'base64')
    const expected = Buffer.from(parts[5]!, 'base64')
    if (salt.length < 8 || expected.length !== KEYLEN) return false
    const actual = await derive(password, salt, n, r, p)
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

let dummy: Promise<string> | null = null

/** Fuer unbekannte Emails: trotzdem einmal hashen/vergleichen (kein Timing-Orakel fuer Email-Existenz). */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummy ??= hashPassword('dummy-password-for-timing')
  await verifyPassword(password, await dummy)
}
