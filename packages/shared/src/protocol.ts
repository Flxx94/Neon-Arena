/** Netzprotokoll-Typen (M1-Skeleton-Vorgriff, erweiterbar). JSON in M0/MVP, MessagePack erst P2. */
export const PROTOCOL_V = 1

/** Client -> Server: komprimierter Bewegungs-/Aim-Input, max 30/s. */
export interface InputMessage {
  kind: 'input'
  seq: number
  dx: number
  dy: number
  aim: number
  fire: boolean
}

/** Server -> Client: Delta-Snapshot, 20 Hz. */
export interface SnapshotMessage {
  kind: 'snapshot'
  tick: number
  ack: number
  players: PlayerSnapshot[]
}

/** Server -> Client: Spiel-Events (Kill/Pickup/RoundEnd). */
export type EventMessage =
  | { kind: 'event'; event: 'kill'; by: string; victim: string }
  | { kind: 'event'; event: 'roundEnd'; winner: string }

export interface PlayerSnapshot {
  id: string
  x: number
  y: number
  hp: number
}

export type ServerMessage = SnapshotMessage | EventMessage
export type ClientMessage = InputMessage
