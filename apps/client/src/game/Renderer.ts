export interface RenderPlayer {
  id: string
  nickname: string
  x: number
  y: number
  hp: number
  alive: boolean
  shield: number
}

export interface RenderProjectile {
  id: string
  x: number
  y: number
}

export interface RenderPickup {
  id: string
  kind: string
  x: number
  y: number
}

export interface RenderState {
  players: RenderPlayer[]
  projectiles: RenderProjectile[]
  pickups: RenderPickup[]
  ownId: string | null
}

/** Rendering hinter Interface (M2-06): spaeter Phaser/Pixi tauschbar (P2-05). */
export interface Renderer {
  render(state: RenderState): void
  worldToScreen(x: number, y: number): { x: number; y: number }
}
