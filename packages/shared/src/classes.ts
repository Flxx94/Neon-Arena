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

/** Ultra-Attacken (ADR-007/008). Jede Figur hat genau eine; sie laedt sich ueber Schaden/Kills/Zeit auf. */
export type UltKind = 'rocket' | 'slam' | 'beam' | 'field' | 'ghost' | 'pounce'

/** Wie die Ult gezielt wird (Pre-Aim im Ult-Joystick): ohne Ziel, Richtung, Punkt oder Gegner. */
export type UltAim = 'self' | 'dir' | 'point' | 'target'

/** Schaden fuer "One-Shot"-Ults: toetet alles, was nicht unverwundbar ist (Schild wird mitgezaehlt). */
export const ONE_SHOT = 9999
/** Lauftempo-Faktor fuer Spieler im Zappy-Feld. */
export const SLOW_MULT = 0.5

export interface UltDef {
  kind: UltKind
  name: string
  description: string
  aim: UltAim
  /** Wirkdauer in Ticks (Rakete: Flugzeit, Wuerfel: Flugzeit bis zum Einschlag, Strahl: Anzeigedauer). */
  durationTicks: number
  /** Faktor auf das Lauftempo waehrend der Ult (Rakete, Geisterwelt). */
  speedMult: number
  /** Maximale Zielentfernung/Strahllaenge in px (0 = ohne). */
  range: number
  /** Wirkradius in px: Feld (Zappy), Explosion (Blobby), Einschlag (Cuby). */
  radius: number
  /** Breite/Kontaktradius in px: Strahlbreite (Hexo), Kontaktzuender der Rakete (Blobby). */
  width: number
  /** Schockwellen-Radius und Rueckstoss in px (Cuby). */
  shockRadius: number
  knockback: number
  /** Schaden pro `tickEvery` Ticks im Feld (Zappy). */
  tickDamage: number
  tickEvery: number
  /** Betaeubungsdauer in Ticks (Kitty). */
  stunTicks: number
  /** Kugelsalve der Explosion (Blobby): Anzahl Projektile in alle Richtungen. */
  salvo: number
}

function ult(
  kind: UltKind,
  name: string,
  description: string,
  aim: UltAim,
  durationTicks: number,
  extra: Partial<Omit<UltDef, 'kind' | 'name' | 'description' | 'aim' | 'durationTicks'>> = {},
): UltDef {
  return {
    kind,
    name,
    description,
    aim,
    durationTicks,
    speedMult: 1,
    range: 0,
    radius: 0,
    width: 0,
    shockRadius: 0,
    knockback: 0,
    tickDamage: 0,
    tickEvery: 1,
    stunTicks: 0,
    salvo: 0,
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
    ult: ult('rocket', 'Raketenflug', 'Blobby wird zur Rakete: fliegt 3 Sekunden über Hindernisse, explodiert über einem Gegner (One-Shot im Umkreis), feuert eine Kugelsalve und landet an einem anderen Punkt der Map.', 'dir', sec(3), { speedMult: 2.4, radius: 110, width: 40, salvo: 16 }),
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
    ult: ult('slam', 'Riesenwürfel', 'Schleudert einen riesigen Würfel auf einen Punkt: One-Shot am Einschlag, die Schockwelle stößt Gegner daneben zurück.', 'point', sec(0.7), { range: 600, radius: 70, shockRadius: 230, knockback: 190 }),
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
    ult: ult('field', 'Elektrofeld', 'Ein elektrisches Feld um Zappy: Gegner darin sind langsamer und nehmen Schaden, Zappys Schüsse zielen leicht automatisch.', 'self', sec(5), { radius: 230, tickDamage: 7, tickEvery: 15 }),
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
    ult: ult('beam', 'Weltenstrahl', 'Ein breiter, blitzschneller Strahl über die ganze Map, der Hindernisse ignoriert und alles in seiner Bahn mit einem Schlag erledigt.', 'dir', 14, { range: 3400, width: 84 }),
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
    ult: ult('ghost', 'Geisterwelt', 'Zieh einen Gegner in dein Geisterreich: 5 Sekunden Duell, du bist schneller, er kann nicht laufen, alle anderen sind unsichtbar.', 'target', sec(5), { speedMult: 1.5, range: 700 }),
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
    ult: ult('pounce', 'Schattensprung', 'Springt zum anvisierten Gegner und betäubt ihn ca. 2 Sekunden.', 'target', 0, { range: 650, stunTicks: sec(2) }),
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

/** Rakete (Blobby-Ult) aktiv? Dann fliegt die Figur ueber Hindernisse und ist unverwundbar. */
export function isFlying(c: CharacterClass, ultTicks: number): boolean {
  return c.ult.kind === 'rocket' && ultTicks > 0
}

/** Lauftempo (px/s) inkl. Ult-Effekt (Geisterwelt, Rakete) und Verlangsamung im Zappy-Feld (`slowTicks` > 0). */
export function effectiveSpeed(c: CharacterClass, ultTicks: number, slowTicks = 0): number {
  let v = c.speed
  if (ultTicks > 0 && (c.ult.kind === 'ghost' || c.ult.kind === 'rocket')) v *= c.ult.speedMult
  if (slowTicks > 0) v *= SLOW_MULT
  return v
}

/** Zielhilfe im Zappy-Feld: Schuss wird um bis zu `AUTOAIM_PULL` Richtung Gegner gedreht (nur im Kegel). */
export const AUTOAIM_RANGE = 520
export const AUTOAIM_CONE = 0.6
export const AUTOAIM_PULL = 0.7

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
