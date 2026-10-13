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
