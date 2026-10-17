import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema'

export class Player extends Schema {
  @type('string') nickname = ''
  @type('number') x = 0
  @type('number') y = 0
  @type('number') hp = 100
  @type('boolean') alive = true
  @type('number') kills = 0
  @type('number') deaths = 0
  @type('number') score = 0
  @type('number') shield = 0
  @type('boolean') isBot = false
  /** Kosmetik (UI v3): Modell + Farbe, siehe shared/skins.ts. Gameplay liest das nie. */
  @type('uint8') skin = 0
  /** Zielrichtung in rad (auf 0.05 gerundet): Clients zeichnen damit Blick + Waffe der Gegner. */
  @type('float32') aim = 0
  /** Verbleibende Boost-Ticks (0 = kein Boost); Clients brauchen es fuer Prediction + Effekte. */
  @type('uint8') boost = 0
  /** Letzte vom Server angewendete Input-seq (fuer Client-Reconciliation, M2-05). */
  @type('number') ackSeq = -1
  /** Ult-Ladung 0..ULT_MAX (Zehntel-Prozent, shared/classes.ts). */
  @type('uint16') ult = 0
  /** Verbleibende Ticks der aktiven Ult (0 = inaktiv); bei Hexo: Zeitfenster fuer den Ult-Schuss. */
  @type('uint8') ultTicks = 0
  /** Betaeubung: Ticks ohne Bewegung und ohne Schuss (Kitty-Ult). */
  @type('uint8') stun = 0
  /** Festgewurzelt: Ticks ohne Bewegung, Schiessen erlaubt (Boo-Geisterwelt). */
  @type('uint8') disarm = 0
  /** Welt-Instanz: 0 = Arena, sonst Geisterwelt-Duell (nur Spieler mit gleicher Zahl sehen/treffen sich). */
  @type('uint8') realm = 0
  /** Verlangsamt (Zappy-Feld): Ticks, die der Effekt noch haelt. */
  @type('uint8') slow = 0
  /** Ticks, in denen der Spieler nach einer Raketen-Explosion unsichtbar/unverwundbar auf den Respawn wartet. */
  @type('uint8') hidden = 0
  /** Ult-Richtung (rad; Rakete: Flugrichtung) und Ult-Punkt (Strahl-Ursprung, Wuerfel-Ziel) fuer die Darstellung. */
  @type('float32') ultAim = 0
  @type('float32') ultX = 0
  @type('float32') ultY = 0
}

export class Projectile extends Schema {
  @type('string') id = ''
  @type('string') owner = ''
  @type('number') x = 0
  @type('number') y = 0
  @type('number') vx = 0
  @type('number') vy = 0
  /** Charakter-Klasse des Schuetzen (= Modellindex): bestimmt Optik, Schaden und Radius. */
  @type('uint8') kind = 0
}

export class Pickup extends Schema {
  @type('string') id = ''
  @type('string') kind = 'hp'
  @type('number') x = 0
  @type('number') y = 0
}

export type RoundPhase = 'play' | 'end'

export class ArenaState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>()
  @type([Projectile]) projectiles = new ArraySchema<Projectile>()
  @type([Pickup]) pickups = new ArraySchema<Pickup>()
  /** Verbleibende Rundenzeit in Sekunden (M3-03). */
  @type('number') timeLeft = 180
  @type('string') phase: RoundPhase = 'play'
  /** Nickname des Rundensiegers ("" waehrend `play`). */
  @type('string') winner = ''
  /** Aktive Karte (`shared/maps.ts`), wechselt pro Runde. */
  @type('uint8') map = 0
}
