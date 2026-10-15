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
