/** Netzprotokoll-Typen (M1-Skeleton-Vorgriff, erweiterbar). JSON in M0/MVP, MessagePack erst P2. */
/** Bei jeder Aenderung an Sim-/State-/Kartenlogik erhoehen: alte Browser-Tabs werden beim Join mit "Bitte neu laden" abgewiesen. */
export const PROTOCOL_V = 2

/** Client -> Server: komprimierter Bewegungs-/Aim-Input, max 30/s. */
export interface InputMessage {
  kind: 'input'
  seq: number
  dx: number
  dy: number
  aim: number
  fire: boolean
  ult?: boolean
  ua?: number
  ud?: number
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

export type PickupKind = 'hp' | 'shield'

export interface PickupSnapshot {
  id: string
  kind: PickupKind
  x: number
  y: number
}

export type ServerMessage = SnapshotMessage | EventMessage
export type ClientMessage = InputMessage
