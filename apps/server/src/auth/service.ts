import { randomUUID } from 'node:crypto'
import { loginSchema, registerSchema } from '@neon-arena/shared'
import type { Account, AccountStore } from './accounts.js'
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password.js'

export type AuthFailure = { ok: false; status: 400 | 401 | 409; error: string }
export type AuthSuccess = { ok: true; account: Account }

/** Registrierung: validieren, Passwort hashen, anlegen. Email-Kollision -> 409. */
export async function registerAccount(
  body: unknown,
  store: AccountStore,
): Promise<AuthSuccess | AuthFailure> {
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? '')
    const error =
      field === 'email'
        ? 'INVALID_EMAIL'
        : field === 'password'
          ? 'INVALID_PASSWORD'
          : field === 'nickname'
            ? 'INVALID_NICKNAME'
            : 'INVALID_INPUT'
    return { ok: false, status: 400, error }
  }
  const { email, password, nickname } = parsed.data
  const account: Account = {
    id: randomUUID(),
    email,
    nickname,
    passwordHash: await hashPassword(password),
    skin: 0,
    createdAt: Date.now(),
  }
  const created = await store.create(account)
  if (!created) return { ok: false, status: 409, error: 'EMAIL_TAKEN' }
  return { ok: true, account }
}

/** Login: generische Fehlermeldung, kein Hinweis ob die Email existiert. */
export async function loginAccount(
  body: unknown,
  store: AccountStore,
): Promise<AuthSuccess | AuthFailure> {
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) return { ok: false, status: 400, error: 'INVALID_INPUT' }
  const account = await store.findByEmail(parsed.data.email)
  if (!account) {
    await verifyAgainstDummy(parsed.data.password)
    return { ok: false, status: 401, error: 'INVALID_CREDENTIALS' }
  }
  if (!(await verifyPassword(parsed.data.password, account.passwordHash))) {
    return { ok: false, status: 401, error: 'INVALID_CREDENTIALS' }
  }
  return { ok: true, account }
}
