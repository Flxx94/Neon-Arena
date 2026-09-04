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
  /** Letzte vom Server angewendete Input-seq (fuer Client-Reconciliation, M2-05). */
  @type('number') ackSeq = -1
}

export class Projectile extends Schema {
  @type('string') id = ''
  @type('string') owner = ''
  @type('number') x = 0
  @type('number') y = 0
  @type('number') vx = 0
  @type('number') vy = 0
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
}
