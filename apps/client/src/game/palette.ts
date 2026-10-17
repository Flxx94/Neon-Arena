import type { MapTheme } from '@neon-arena/shared'
import type { Theme } from '../ui/theme.js'

/** Runder, fetter System-Font-Stack (keine externen Webfonts: DSGVO/LAN-tauglich), auch fuer CSS (--font). */
export const FONT =
  'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", "Varela Round", "Trebuchet MS", "Segoe UI", system-ui, sans-serif'

/**
 * Zwei Welten, ein Stil: dicke Tinten-Outlines, flaches Cel-Shading, kraeftige Spielfarben.
 *  - dark  = "Night Grid": tiefes Violett, leuchtende Kanten (additive Lichter)
 *  - light = "Day Arcade": warmer Sand, Spielzeug-/Papier-Look mit weichen Schatten
 */
export type WallKind = 'wall' | 'bunker' | 'pillar' | 'barricade' | 'crate'

export interface WallColors {
  top: string
  side: string
  hi: string
}

export interface Palette {
  theme: Theme
  bg: string
  bgDot: string
  floorA: string
  floorB: string
  grid: string
  decal: string
  decalStrong: string
  borderBand: string
  stripeA: string
  stripeB: string
  ink: string
  shadow: string
  text: string
  textInk: string
  hpBack: string
  hpGood: string
  hpMid: string
  hpLow: string
  shield: string
  bullet: string
  bulletCore: string
  pickupHp: string
  pickupShield: string
  walls: Record<WallKind, WallColors>
  /** Additive Lichter nur auf dunklem Grund sichtbar. */
  additive: boolean
}

const dark: Palette = {
  theme: 'dark',
  bg: '#0d0822',
  bgDot: 'rgba(160, 130, 255, 0.10)',
  floorA: '#1b1443',
  floorB: '#20174d',
  grid: 'rgba(138, 112, 255, 0.16)',
  decal: 'rgba(120, 205, 255, 0.20)',
  decalStrong: 'rgba(120, 205, 255, 0.42)',
  borderBand: '#120b30',
  stripeA: '#ffd23f',
  stripeB: '#120b30',
  ink: '#05030f',
  shadow: 'rgba(2, 0, 12, 0.55)',
  text: '#f6f2ff',
  textInk: '#05030f',
  hpBack: '#2a2158',
  hpGood: '#5dff9b',
  hpMid: '#ffd23f',
  hpLow: '#ff4b5c',
  shield: '#4db8ff',
  bullet: '#ffe95c',
  bulletCore: '#ffffff',
  pickupHp: '#5dff9b',
  pickupShield: '#4db8ff',
  walls: {
    wall: { top: '#1fd1c6', side: '#0a6e7a', hi: '#9ffff4' },
    bunker: { top: '#ff4f9d', side: '#9b1c63', hi: '#ffb3d6' },
    pillar: { top: '#ffd23f', side: '#a8761a', hi: '#fff2b0' },
    barricade: { top: '#9275ff', side: '#4a2fb3', hi: '#d4c8ff' },
    crate: { top: '#ff8d3d', side: '#a34a14', hi: '#ffd1a8' },
  },
  additive: true,
}

const light: Palette = {
  theme: 'light',
  bg: '#ffe9c7',
  bgDot: 'rgba(27, 19, 64, 0.07)',
  floorA: '#fff9ec',
  floorB: '#fff0d4',
  grid: 'rgba(27, 19, 64, 0.08)',
  decal: 'rgba(27, 19, 64, 0.12)',
  decalStrong: 'rgba(27, 19, 64, 0.28)',
  borderBand: '#f6d9a6',
  stripeA: '#ffc928',
  stripeB: '#1b1340',
  ink: '#1b1340',
  shadow: 'rgba(80, 45, 0, 0.22)',
  text: '#1b1340',
  textInk: '#ffffff',
  hpBack: '#e9d6b4',
  hpGood: '#22c768',
  hpMid: '#f5a300',
  hpLow: '#ec2f45',
  shield: '#1e90ff',
  bullet: '#ff9e00',
  bulletCore: '#fff7d6',
  pickupHp: '#22c768',
  pickupShield: '#1e90ff',
  walls: {
    wall: { top: '#2fd9cc', side: '#12918f', hi: '#c4fff9' },
    bunker: { top: '#ff6aae', side: '#c22a76', hi: '#ffd0e6' },
    pillar: { top: '#ffd84d', side: '#d19a16', hi: '#fff6c4' },
    barricade: { top: '#a68cff', side: '#6847d6', hi: '#e2d9ff' },
    crate: { top: '#ff9a52', side: '#cf5f1c', hi: '#ffdcc0' },
  },
  additive: false,
}

export const PALETTES: Record<Theme, Palette> = { dark, light }

type Walls = Palette['walls']
function w(
  wall: [string, string, string],
  bunker: [string, string, string],
  pillar: [string, string, string],
  barricade: [string, string, string],
  crate: [string, string, string],
): Walls {
  const c = ([top, side, hi]: [string, string, string]): WallColors => ({ top, side, hi })
  return { wall: c(wall), bunker: c(bunker), pillar: c(pillar), barricade: c(barricade), crate: c(crate) }
}

/**
 * Karten-Stile: ueberschreiben nur Boden-/Wand-/Hintergrundfarben der Basis-Palette
 * (HP-/Projektil-/UI-Farben bleiben gleich, damit das Gameplay auf jeder Karte gleich lesbar ist).
 */
const MAP_STYLES: Record<Exclude<MapTheme, 'neon'>, Record<Theme, Partial<Palette>>> = {
  winter: {
    dark: {
      bg: '#071225', bgDot: 'rgba(170, 215, 255, 0.10)', floorA: '#27446b', floorB: '#2d4d78',
      grid: 'rgba(180, 220, 255, 0.07)', decal: 'rgba(200, 235, 255, 0.22)', decalStrong: 'rgba(200, 235, 255, 0.5)',
      borderBand: '#0e1d3a', stripeA: '#dff3ff', stripeB: '#0e1d3a', shadow: 'rgba(2, 8, 24, 0.55)',
      walls: w(['#8fe3ff', '#2b7fa8', '#e6faff'], ['#cfe9ff', '#5f8fb8', '#ffffff'], ['#a9d6f0', '#4f86b0', '#ffffff'], ['#6fb7ff', '#2c5ea8', '#d6ebff'], ['#a6d4f2', '#4a7ea6', '#f0faff']),
    },
    light: {
      bg: '#cfe8f8', bgDot: 'rgba(30, 70, 110, 0.08)', floorA: '#f7fcff', floorB: '#e9f3fb',
      grid: 'rgba(60, 110, 160, 0.07)', decal: 'rgba(60, 120, 180, 0.18)', decalStrong: 'rgba(60, 120, 180, 0.38)',
      borderBand: '#d6ebf8', stripeA: '#ffffff', stripeB: '#1b1340', shadow: 'rgba(30, 70, 120, 0.22)',
      walls: w(['#7fd8f5', '#3a8fb8', '#e2f8ff'], ['#bfe0f7', '#6f9cc4', '#ffffff'], ['#b4dcf4', '#6a98c0', '#ffffff'], ['#6fb0f5', '#3a6cb8', '#d6ebff'], ['#9acbec', '#5a8cb0', '#eef9ff']),
    },
  },
  desert: {
    dark: {
      bg: '#1f1006', bgDot: 'rgba(255, 200, 130, 0.08)', floorA: '#4a3220', floorB: '#533a26',
      grid: 'rgba(255, 200, 130, 0.05)', decal: 'rgba(255, 200, 120, 0.2)', decalStrong: 'rgba(255, 200, 120, 0.42)',
      borderBand: '#2a190d', stripeA: '#e8a34a', stripeB: '#2a190d', shadow: 'rgba(14, 6, 0, 0.55)',
      walls: w(['#e0b070', '#8a5a2a', '#ffe3b5'], ['#d98a4a', '#8c4a1c', '#ffd0a0'], ['#f0c878', '#9c6a22', '#fff0c4'], ['#b8743c', '#6a3a18', '#f0c090'], ['#c9a064', '#7a5426', '#f5dca8']),
    },
    light: {
      bg: '#f6d9a0', bgDot: 'rgba(120, 70, 10, 0.08)', floorA: '#f9e3b4', floorB: '#f3d79c',
      grid: 'rgba(120, 70, 10, 0.05)', decal: 'rgba(140, 80, 10, 0.16)', decalStrong: 'rgba(140, 80, 10, 0.32)',
      borderBand: '#e9c27a', stripeA: '#d8934a', stripeB: '#1b1340', shadow: 'rgba(110, 60, 0, 0.25)',
      walls: w(['#e8b66e', '#a8702e', '#fff0cc'], ['#e0955a', '#a85a24', '#ffdcb8'], ['#f2cc7c', '#b8802a', '#fff6d0'], ['#c8844a', '#8a4a20', '#f6d0a4'], ['#d6ae70', '#9a6a30', '#fae6b8']),
    },
  },
  jungle: {
    dark: {
      bg: '#04130c', bgDot: 'rgba(120, 255, 170, 0.08)', floorA: '#12351f', floorB: '#163d25',
      grid: 'rgba(120, 255, 170, 0.05)', decal: 'rgba(140, 255, 180, 0.2)', decalStrong: 'rgba(140, 255, 180, 0.42)',
      borderBand: '#0a2314', stripeA: '#5fd36e', stripeB: '#0a2314', shadow: 'rgba(0, 10, 4, 0.55)',
      walls: w(['#5fbf6a', '#256a34', '#c8ffc8'], ['#9aa88a', '#566650', '#e6f0d8'], ['#3fae52', '#1c6a30', '#a8f0a8'], ['#7a9e4a', '#3a5a1c', '#d4eca0'], ['#6fa85a', '#2e6a28', '#c4f0b0']),
    },
    light: {
      bg: '#bfe8b0', bgDot: 'rgba(20, 80, 30, 0.08)', floorA: '#a8dc8c', floorB: '#9fd582',
      grid: 'rgba(20, 80, 30, 0.07)', decal: 'rgba(20, 90, 40, 0.18)', decalStrong: 'rgba(20, 90, 40, 0.36)',
      borderBand: '#7fc468', stripeA: '#2f9a46', stripeB: '#1b1340', shadow: 'rgba(10, 60, 20, 0.25)',
      walls: w(['#5cc26a', '#2a7a3a', '#d4ffd4'], ['#a8b898', '#667a5c', '#eef6e0'], ['#34a84a', '#1c7430', '#b4f4b4'], ['#86aa50', '#42661e', '#e0f4a8'], ['#72b25e', '#32742c', '#cff4b8']),
    },
  },
}

const styled = new Map<string, Palette>()

/** Palette fuer (Hell/Dunkel, Karten-Theme); "neon" = unveraenderte Basis-Palette. */
export function paletteFor(theme: Theme, mapTheme: MapTheme): Palette {
  if (mapTheme === 'neon') return PALETTES[theme]
  const key = `${theme}:${mapTheme}`
  let p = styled.get(key)
  if (!p) {
    p = { ...PALETTES[theme], ...MAP_STYLES[mapTheme][theme] }
    styled.set(key, p)
  }
  return p
}

/** Skin-Farben (Reihenfolge = COLOR_NAMES in shared/skins.ts). */
export const SKIN_COLORS = [
  '#ff5fa2',
  '#26d0ff',
  '#8dea2f',
  '#ffcf2e',
  '#9a6bff',
  '#ff8a2b',
  '#2fe3b0',
  '#ff4b5c',
] as const

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '')
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** amount > 0 hellt Richtung Weiss auf, amount < 0 dunkelt Richtung Schwarz ab. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const t = amount < 0 ? 0 : 255
  const k = Math.abs(amount)
  return toHex(r + (t - r) * k, g + (t - g) * k, b + (t - b) * k)
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

export interface SkinTone {
  base: string
  dark: string
  light: string
}

const toneCache = new Map<number, SkinTone>()

export function skinTone(colorIndex: number): SkinTone {
  const i = ((colorIndex % SKIN_COLORS.length) + SKIN_COLORS.length) % SKIN_COLORS.length
  let tone = toneCache.get(i)
  if (!tone) {
    const base = SKIN_COLORS[i]!
    tone = { base, dark: shade(base, -0.28), light: shade(base, 0.45) }
    toneCache.set(i, tone)
  }
  return tone
}
