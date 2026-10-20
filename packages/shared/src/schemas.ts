import { z } from 'zod'
import { SKIN_COUNT } from './skins.js'

/** Nickname-Regel (M5-02): <=16 Zeichen, alphanumerisch + _-. */
export const nicknameSchema = z
  .string()
  .min(1)
  .max(16)
  .regex(/^[a-zA-Z0-9_-]+$/)

/** Namenswahl / Umbenennen (Profil pro IP): nur der Anzeigename. */
export const profileNameSchema = z.object({ nickname: nicknameSchema }).strip()

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

/** Admin-Panel: Anmeldung mit dem serverseitigen ADMIN_TOKEN (nie im Client-Bundle). */
export const adminAuthSchema = z.object({ token: z.string().min(1).max(200) }).strip()

export const ADMIN_PLAYER_ACTIONS = [
  'ult',
  'score',
  'kills',
  'deaths',
  'hp',
  'shield',
  'kill',
  'revive',
  'kick',
  'skin',
] as const
export type AdminPlayerAction = (typeof ADMIN_PLAYER_ACTIONS)[number]

/** Aktion auf einen Spieler der eigenen Raum-Instanz: `set` setzt, `add` addiert (auch negativ). */
export const adminPlayerSchema = z
  .object({
    action: z.enum(ADMIN_PLAYER_ACTIONS),
    target: z.string().min(1).max(64),
    mode: z.enum(['set', 'add']).default('set'),
    value: z.number().finite().min(-100000).max(100000).default(0),
  })
  .strip()

export const ADMIN_ROUND_OPS = ['restart', 'end', 'map', 'time'] as const
export const adminRoundSchema = z
  .object({
    op: z.enum(ADMIN_ROUND_OPS),
    value: z.number().finite().min(-1000).max(1000).default(0),
  })
  .strip()

/** IP-Bann eines Spielers (Ziel = Session-ID) bzw. Aufhebung ueber die IP aus der Bann-Liste. */
export const adminBanSchema = z.object({ target: z.string().min(1).max(64) }).strip()
export const adminUnbanSchema = z.object({ ip: z.string().min(2).max(64) }).strip()

export type AdminPlayerInput = z.infer<typeof adminPlayerSchema>
export type AdminRoundInput = z.infer<typeof adminRoundSchema>
export type JoinInput = z.infer<typeof joinSchema>
export type ValidatedInput = z.infer<typeof inputSchema>
