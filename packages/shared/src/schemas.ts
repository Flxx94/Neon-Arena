import { z } from 'zod'

/** Nickname-Regel (M5-02): <=16 Zeichen, alphanumerisch + _-. */
export const nicknameSchema = z
  .string()
  .min(1)
  .max(16)
  .regex(/^[a-zA-Z0-9_-]+$/)

export const joinSchema = z.object({
  nickname: nicknameSchema,
  protocolV: z.literal(1),
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
  })
  .strip()

export type JoinInput = z.infer<typeof joinSchema>
export type ValidatedInput = z.infer<typeof inputSchema>
