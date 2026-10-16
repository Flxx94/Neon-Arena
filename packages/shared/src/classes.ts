/**
 * Charakter-Klassen (ADR-006): jedes der 6 Modelle hat eigene Lebenspunkte, Lauftempo und genau
 * EINE Attacke. Die Tabelle ist die einzige Quelle der Wahrheit fuer Server-Sim, Client-Prediction
 * (Tempo) und Lobby-Anzeige. Der Index entspricht `skinModel(skin)`.
 *
 * Performance-Regeln (Server): jede Attacke ist genau ein Projektil pro Schuss, Sonderverhalten
 * (Lifesteal, Rueckenschaden) kostet O(1) pro Treffer, es entstehen keine zusaetzlichen Entities.
 * Die Zahl gleichzeitiger Projektile pro Spieler ist durch `ttlTicks / cooldownTicks` begrenzt
 * (siehe classes.test.ts), also nie hoeher als beim bisherigen Einheitswaffen-Spiel.
 */
import {
  FIRE_INTERVAL_MS,
  PLAYER_HP,
  PLAYER_SPEED,
  PROJECTILE_DAMAGE,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  PROJECTILE_TTL_MS,
  TICK_RATE,
} from './constants.js'
import { MODEL_COUNT, skinModel } from './skins.js'

export type Role = 'damage' | 'tank' | 'assassin'

export const ROLE_LABELS: Record<Role, string> = {
  damage: 'Damage Dealer',
  tank: 'Tank',
  assassin: 'Assassin',
}

/** Ultra-Attacken (ADR-007). Jede Figur hat genau eine; sie laedt sich ueber Schaden/Kills/Zeit auf. */
export type UltKind = 'overdrive' | 'bulwark' | 'rush' | 'snipe' | 'ghost' | 'pounce'

export interface UltDef {
  kind: UltKind
  name: string
  description: string
  /** Wirkdauer in Ticks (0 = sofortiger Effekt). */
  durationTicks: number
  /** Faktor auf das Lauftempo waehrend der Ult. */
  speedMult: number
  /** Faktor auf die Abklingzeit der Waffe waehrend der Ult (<1 = schneller). */
  cooldownMult: number
  /** Faktor auf erlittenen Schaden waehrend der Ult (<1 = weniger). */
  damageTakenMult: number
  /** Faktor auf den Schaden des Ult-Schusses (Hexo). */
  damageMult: number
  /** Zielreichweite in px fuer Ults mit Zielauswahl (Boo, Kitty); 0 = ohne Ziel. */
  range: number
  /** Betaeubungsdauer in Ticks (Kitty). */
  stunTicks: number
}

function ult(
  kind: UltKind,
  name: string,
  description: string,
  durationTicks: number,
  extra: Partial<Omit<UltDef, 'kind' | 'name' | 'description' | 'durationTicks'>> = {},
): UltDef {
  return {
    kind,
    name,
    description,
    durationTicks,
    speedMult: 1,
    cooldownMult: 1,
    damageTakenMult: 1,
    damageMult: 1,
    range: 0,
    stunTicks: 0,
    ...extra,
  }
}

export interface CharacterClass {
  role: Role
  /** Maximale Lebenspunkte. */
  hp: number
  /** Lauftempo in px/s (Boost-Felder multiplizieren dies). */
  speed: number
  /** Mindestabstand zwischen zwei Schuessen in Ticks (30 Hz). */
  cooldownTicks: number
  damage: number
  projectileSpeed: number
  projectileRadius: number
  /** Lebensdauer des Projektils in Ticks (bestimmt die Reichweite). */
  ttlTicks: number
  /** Anteil des verursachten Schadens, der als Leben zurueckkommt (0 = keiner). */
  lifesteal: number
  /** Schadensfaktor, wenn das Ziel vom Schuetzen wegschaut (1 = kein Bonus). */
  backstab: number
  /** Name der Attacke. */
  attack: string
  /** Kurzbeschreibung fuer die Lobby. */
  description: string
  /** Ultra-Attacke dieser Figur. */
  ult: UltDef
}

const sec = (s: number): number => Math.ceil(s * TICK_RATE)

export const CLASSES: readonly CharacterClass[] = [
  {
    // Blobby = bisherige Standardwaffe (Referenz fuer die Balance).
    role: 'damage',
    hp: PLAYER_HP,
    speed: PLAYER_SPEED,
    cooldownTicks: Math.ceil((FIRE_INTERVAL_MS / 1000) * TICK_RATE),
    damage: PROJECTILE_DAMAGE,
    projectileSpeed: PROJECTILE_SPEED,
    projectileRadius: PROJECTILE_RADIUS,
    ttlTicks: Math.ceil((PROJECTILE_TTL_MS / 1000) * TICK_RATE),
    lifesteal: 0,
    backstab: 1,
    attack: 'Blubber-Blaster',
    description:
      'Der Allrounder: zuverlässige Seifenblasen mit guter Reichweite und solider Feuerrate. Perfekt zum Einstieg.',
    ult: ult('overdrive', 'Blasenflut', 'Für 4 Sekunden feuert Blobby mehr als doppelt so schnell.', sec(4), { cooldownMult: 0.4 }),
  },
  {
    role: 'tank',
    hp: 180,
    speed: 125,
    cooldownTicks: 20,
    damage: 40,
    projectileSpeed: 330,
    projectileRadius: 7,
    ttlTicks: sec(1.6),
    lifesteal: 0,
    backstab: 1,
    attack: 'Klotz-Kanone',
    description:
      'Schleudert dicke Würfel: langsam, aber mit riesigem Treffer und größter Lebensanzeige. Hält am meisten aus.',
    ult: ult('bulwark', 'Bollwerk', 'Für 4 Sekunden nimmt Cuby nur 20 % Schaden. Nichts hält ihn auf.', sec(4), { damageTakenMult: 0.2 }),
  },
  {
    role: 'assassin',
    hp: 75,
    speed: 225,
    cooldownTicks: 8,
    damage: 28,
    projectileSpeed: 650,
    projectileRadius: 3.5,
    ttlTicks: sec(0.55),
    lifesteal: 0,
    backstab: 1,
    attack: 'Blitz-Bolzen',
    description:
      'Superschnell, aber zerbrechlich: kurze, blitzschnelle Funkenschüsse. Ran, austeilen, wieder weg.',
    ult: ult('rush', 'Blitzrausch', 'Für 4 Sekunden rast Zappy 60 % schneller und feuert flotter.', sec(4), { speedMult: 1.6, cooldownMult: 0.6 }),
  },
  {
    role: 'damage',
    hp: 90,
    speed: 155,
    cooldownTicks: 25,
    damage: 65,
    projectileSpeed: 900,
    projectileRadius: 3,
    ttlTicks: sec(1.8),
    lifesteal: 0,
    backstab: 1,
    attack: 'Hex-Nadel',
    description:
      'Der Scharfschütze: pfeilschnelle Nadel mit enormer Reichweite und 65 Schaden, dafür nur etwa ein Schuss pro Sekunde.',
    ult: ult('snipe', 'Todesnadel', 'Der nächste Schuss (8 Sekunden Zeit) ist eine riesige Nadel mit 2,4-fachem Schaden.', sec(8), { damageMult: 2.4 }),
  },
  {
    role: 'tank',
    hp: 140,
    speed: 140,
    cooldownTicks: 12,
    damage: 24,
    projectileSpeed: 380,
    projectileRadius: 5,
    ttlTicks: sec(1.5),
    lifesteal: 0.3,
    backstab: 1,
    attack: 'Spuk-Wisp',
    description:
      'Geisterhafter Wisp, der 30 % des Schadens als Leben zurückholt. Zäh, ausdauernd und kaum totzukriegen.',
    ult: ult('ghost', 'Geisterwelt', 'Zieh einen Gegner in dein Geisterreich: 5 Sekunden Duell, du bist schneller, er kann nicht laufen, alle anderen sind unsichtbar.', sec(5), { speedMult: 1.5, range: 700 }),
  },
  {
    role: 'assassin',
    hp: 80,
    speed: 205,
    cooldownTicks: 10,
    damage: 26,
    projectileSpeed: 460,
    projectileRadius: 4,
    ttlTicks: sec(0.7),
    lifesteal: 0,
    backstab: 1.7,
    attack: 'Krallen-Schwung',
    description:
      'Lautlos und gefährlich: Treffer in den Rücken richten 70 % mehr Schaden an. Kurze Reichweite, hohes Tempo.',
    ult: ult('pounce', 'Schattensprung', 'Springt zum anvisierten Gegner und betäubt ihn ca. 2 Sekunden.', 0, { range: 650, stunTicks: sec(2) }),
  },
]

if (CLASSES.length !== MODEL_COUNT) throw new Error('CLASSES muss MODEL_COUNT Eintraege haben')

/** Klasse eines Skins (Modell = Klasse). O(1), keine Allokation. */
export function classOf(skin: number): CharacterClass {
  return CLASSES[skinModel(skin)]!
}

/** Schaden pro Sekunde bei Dauerfeuer (cooldown-quantisiert wie auf dem Server). */
export function classDps(c: CharacterClass): number {
  return (c.damage * TICK_RATE) / c.cooldownTicks
}

/** Reichweite eines Schusses in px. */
export function classRange(c: CharacterClass): number {
  return (c.projectileSpeed * c.ttlTicks) / TICK_RATE
}

/** Maximal gleichzeitig lebende Projektile eines Spielers (Server-Last-Obergrenze). */
export function classMaxLiveProjectiles(c: CharacterClass): number {
  return Math.ceil(c.ttlTicks / c.cooldownTicks)
}

/**
 * Grobe Kampfkraft fuer den Balance-Test: Schaden/s x Leben x Wurzel(Tempo-Verhaeltnis), gewichtet mit
 * Lifesteal und (zu 40 % angenommenem) Rueckenschaden. Reichweite/Zielschwierigkeit sind bewusst
 * nicht enthalten: Kurzstrecken-Klassen (Assassins) bekommen dafuer mehr Rohwerte, der Sniper weniger.
 */
export function classPower(c: CharacterClass): number {
  return (
    classDps(c) *
    c.hp *
    Math.sqrt(c.speed / PLAYER_SPEED) *
    (1 + c.lifesteal) *
    (1 + (c.backstab - 1) * 0.4)
  )
}

// --- Ult-Aufladung & Hilfsfunktionen (Server und Client nutzen exakt dieselben) ---

/** Voll geladen = ULT_MAX (Player.ult ist in Zehntel-Prozent, uint16). */
export const ULT_MAX = 1000
export const ULT_PER_DAMAGE_DEALT = 1.5
export const ULT_PER_DAMAGE_TAKEN = 0.8
export const ULT_PER_KILL = 100
/** Passiv +1 alle N Ticks (~3,75/s). */
export const ULT_PASSIVE_TICKS = 8
/** Anteil, der beim Tod verloren geht (nur wenn nicht voll). */
export const ULT_DEATH_LOSS = 0.35

/** Lauftempo (px/s) inkl. Ult-Effekt; `ultTicks` = verbleibende Ult-Ticks (0 = inaktiv). */
export function effectiveSpeed(c: CharacterClass, ultTicks: number): number {
  return ultTicks > 0 ? c.speed * c.ult.speedMult : c.speed
}

/** Waffen-Abklingzeit in Ticks inkl. Ult-Effekt. */
export function effectiveCooldown(c: CharacterClass, ultTicks: number): number {
  return ultTicks > 0 ? Math.max(3, Math.round(c.cooldownTicks * c.ult.cooldownMult)) : c.cooldownTicks
}

/**
 * Zielauswahl fuer Ults mit Ziel (Boo/Kitty): kleinster Wert gewinnt, Infinity = nicht anvisierbar.
 * Bewertet Abstand zur Zielgeraden + Entfernung, nur innerhalb eines Kegels (~31 Grad) und der Reichweite.
 */
export function ultTargetScore(
  ax: number,
  ay: number,
  aim: number,
  range: number,
  tx: number,
  ty: number,
): number {
  const dx = tx - ax
  const dy = ty - ay
  const dist = Math.hypot(dx, dy)
  if (dist > range || dist < 1) return Infinity
  let diff = Math.abs(Math.atan2(dy, dx) - aim)
  if (diff > Math.PI) diff = 2 * Math.PI - diff
  if (diff > 0.55) return Infinity
  return Math.sin(diff) * dist + dist * 0.15
}
