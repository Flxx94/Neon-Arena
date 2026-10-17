import { z } from 'zod'
import { SKIN_COUNT } from './skins.js'

/** Nickname-Regel (M5-02): <=16 Zeichen, alphanumerisch + _-. */
export const nicknameSchema = z
  .string()
  .min(1)
  .max(16)
  .regex(/^[a-zA-Z0-9_-]+$/)

/** Account-Anmeldung (Email + Passwort). Email wird normalisiert (trim + lowercase). */
export const emailSchema = z.string().trim().toLowerCase().email().max(254)
/** Passwort: 8-128 Zeichen (scrypt hasht beliebige Laenge; Obergrenze gegen Missbrauch). */
export const passwordSchema = z.string().min(8).max(128)

export const registerSchema = z
  .object({ email: emailSchema, password: passwordSchema, nickname: nicknameSchema })
  .strip()

export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strip()

/** Lobby: gewaehlter Look (Modell + Farbe) wird am Account gespeichert. */
export const skinUpdateSchema = z
  .object({ skin: z.number().int().min(0).max(SKIN_COUNT - 1) })
  .strip()

export const joinSchema = z.object({
  nickname: nicknameSchema,
  // Version nur als Zahl akzeptieren; Mismatch -> explizites PROTOCOL_MISMATCH (M5-01).
  protocolV: z.number().int(),
  // M4-02: Gast-Identitaet (Session muss serverseitig existieren).
  userId: z.string().uuid().optional(),
  // UI v3: kosmetischer Skin (Modell + Farbe), rein optional; Bereich wird hart geprueft.
  skin: z
    .number()
    .int()
    .min(0)
    .max(SKIN_COUNT - 1)
    .optional(),
})

/** Jede Client-Message laeuft durch dieses Schema; unbekannte Felder werden gestrippt (.strict fehlt absichtlich nicht -> strip). */
export const inputSchema = z
  .object({
    kind: z.literal('input'),
    seq: z.number().int().nonnegative(),
    dx: z.number().min(-1).max(1),
    dy: z.number().min(-1).max(1),
    aim: z.number().min(-Math.PI).max(Math.PI),
    fire: z.boolean(),
    /** Ult ausloesen (idempotent: der Server verlangt volle Leiste). */
    ult: z.boolean().optional(),
    /** Ult-Zielrichtung (rad) und -Entfernung (0..1 der Reichweite) aus dem Pre-Aim des Ult-Joysticks. */
    ua: z.number().min(-Math.PI).max(Math.PI).optional(),
    ud: z.number().min(0).max(1).optional(),
  })
  .strip()

/** Charakterwechsel (nur waehrend man tot ist; der Server prueft das). */
export const skinChangeSchema = z
  .object({
    skin: z
      .number()
      .int()
      .min(0)
      .max(SKIN_COUNT - 1),
  })
  .strip()

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type JoinInput = z.infer<typeof joinSchema>
export type ValidatedInput = z.infer<typeof inputSchema>
