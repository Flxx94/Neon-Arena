import type { Effects } from './Effects.js'

export interface RenderPlayer {
  id: string
  nickname: string
  x: number
  y: number
  hp: number
  alive: boolean
  shield: number
  /** Kosmetik: Modell + Farbe, siehe shared/skins.ts. */
  skin: number
  /** Zielrichtung in rad (eigener Spieler: lokal, sonst vom Server). */
  aim: number
  /** Verbleibende Boost-Ticks (0 = keiner): Speed-Streifen + Aura. */
  boost: number
  isBot: boolean
  /** Ult-Status (aktiv / betaeubt / gewurzelt) fuer Auren. */
  ultTicks: number
  stun: number
  root: number
}

export interface RenderProjectile {
  id: string
  x: number
  y: number
  kind: number
  /** Ult-Schuss: gross zeichnen. */
  big: boolean
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
  /** Mausposition in Bildschirmpixeln (fuer das Fadenkreuz). */
  mouse: { x: number; y: number }
  /** Fadenkreuz zeichnen (nur im Spiel). */
  crosshair: boolean
  /** Eigener Spieler ist in einer Geisterwelt: dunkle Welt mit Partikeln. */
  ghost: boolean
  /** Spieler, der von der Ziel-Ult (Boo/Kitty) gerade anvisiert wuerde. */
  ultTargetId: string | null
}

/** Ereignisse, die der Renderer aus Zustandsdifferenzen ableitet (fuer Sound/HUD in main.ts). */
export interface RenderHooks {
  onShot?: (own: boolean, x: number, y: number, kind: number) => void
  onImpact?: (x: number, y: number) => void
  /** `amount` = verlorene HP+Shield; `own` = eigener Spieler wurde getroffen. */
  onHit?: (own: boolean, x: number, y: number, amount: number, byOwnShot: boolean) => void
  onDeath?: (own: boolean, x: number, y: number) => void
  onSpawn?: (own: boolean, x: number, y: number) => void
  onPickup?: (kind: string, own: boolean, x: number, y: number) => void
}

/** Rendering hinter Interface (M2-06): spaeter Phaser/Pixi tauschbar (P2-05). */
export interface Renderer {
  readonly fx: Effects
  hooks: RenderHooks
  render(state: RenderState): void
  worldToScreen(x: number, y: number): { x: number; y: number }
  /** Menue-Hintergrund: Arena ohne Spieler (animiert). */
  renderIdle(): void
}
