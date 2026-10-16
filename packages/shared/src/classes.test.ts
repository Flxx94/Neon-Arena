import { describe, expect, it } from 'vitest'
import {
  CLASSES,
  MODEL_COUNT,
  ULT_DEATH_LOSS,
  ULT_MAX,
  ULT_PASSIVE_TICKS,
  ULT_PER_DAMAGE_DEALT,
  effectiveCooldown,
  effectiveSpeed,
  ultTargetScore,
  ROLE_LABELS,
  TICK_RATE,
  classDps,
  classMaxLiveProjectiles,
  classOf,
  classPower,
  classRange,
  makeSkin,
} from './index.js'

describe('Charakter-Klassen (ADR-006)', () => {
  it('jedes Modell hat genau eine Klasse; Farbe aendert die Klasse nicht', () => {
    expect(CLASSES.length).toBe(MODEL_COUNT)
    for (let m = 0; m < MODEL_COUNT; m++) {
      expect(classOf(makeSkin(m, 0))).toBe(CLASSES[m])
      expect(classOf(makeSkin(m, 5))).toBe(CLASSES[m])
    }
  })

  it('alle Rollen kommen vor, alle Texte sind gefuellt', () => {
    const roles = new Set(CLASSES.map((c) => c.role))
    expect([...roles].sort()).toEqual(['assassin', 'damage', 'tank'])
    for (const c of CLASSES) {
      expect(ROLE_LABELS[c.role].length).toBeGreaterThan(0)
      expect(c.attack.length).toBeGreaterThan(2)
      expect(c.description.length).toBeGreaterThan(30)
    }
  })

  it('Rollen-Identitaet: Tanks haben das meiste Leben, Assassins das meiste Tempo', () => {
    const by = (role: string) => CLASSES.filter((c) => c.role === role)
    const minTankHp = Math.min(...by('tank').map((c) => c.hp))
    const maxOtherHp = Math.max(...CLASSES.filter((c) => c.role !== 'tank').map((c) => c.hp))
    expect(minTankHp).toBeGreaterThan(maxOtherHp)
    const minAssassinSpeed = Math.min(...by('assassin').map((c) => c.speed))
    const maxOtherSpeed = Math.max(...CLASSES.filter((c) => c.role !== 'assassin').map((c) => c.speed))
    expect(minAssassinSpeed).toBeGreaterThan(maxOtherSpeed)
    // Sniper: weitester + schnellster Schuss.
    const sniper = CLASSES[3]!
    for (const c of CLASSES) {
      expect(classRange(sniper)).toBeGreaterThanOrEqual(classRange(c))
      expect(sniper.projectileSpeed).toBeGreaterThanOrEqual(c.projectileSpeed)
    }
  })

  it('Balance: Kampfkraft liegt bei allen Klassen innerhalb +-30 % des Mittels', () => {
    const powers = CLASSES.map(classPower)
    const mean = powers.reduce((a, b) => a + b, 0) / powers.length
    for (const p of powers) {
      expect(p).toBeGreaterThan(mean * 0.7)
      expect(p).toBeLessThan(mean * 1.3)
    }
  })

  it('kein Ein-Treffer-Kill ohne Rueckenbonus, Schaden-pro-Sekunde bleibt unter Deckel', () => {
    const maxHp = Math.min(...CLASSES.map((c) => c.hp))
    for (const c of CLASSES) {
      expect(c.damage).toBeLessThan(maxHp)
      expect(classDps(c)).toBeLessThanOrEqual(115)
      // Rueckenbonus: auch mit Bonus nie ein Ein-Treffer-Kill.
      expect(c.damage * c.backstab).toBeLessThan(maxHp)
    }
  })

  it('Server-Last: Cooldown >= 6 Ticks und begrenzte gleichzeitige Projektile je Spieler', () => {
    // Referenz = bisherige Einheitswaffe (Blobby): 66 Ticks Lebensdauer / 8 Ticks Cooldown = 9.
    const baseline = classMaxLiveProjectiles(CLASSES[0]!)
    for (const c of CLASSES) {
      expect(c.cooldownTicks).toBeGreaterThanOrEqual(6)
      expect(classMaxLiveProjectiles(c)).toBeLessThanOrEqual(baseline)
      expect(c.ttlTicks / TICK_RATE).toBeLessThanOrEqual(2.2)
    }
  })

  describe('Ults (ADR-007)', () => {
    it('jede Figur hat genau eine Ult; Dauer/Stun passen in uint8 (Schema)', () => {
      expect(new Set(CLASSES.map((c) => c.ult.kind)).size).toBe(CLASSES.length)
      for (const c of CLASSES) {
        expect(c.ult.name.length).toBeGreaterThan(3)
        expect(c.ult.description.length).toBeGreaterThan(20)
        expect(c.ult.durationTicks).toBeLessThanOrEqual(255)
        expect(c.ult.stunTicks).toBeLessThanOrEqual(255)
      }
    })

    it('Effekte: Tempo/Abklingzeit nur waehrend die Ult laeuft', () => {
      const zappy = CLASSES[2]!
      expect(effectiveSpeed(zappy, 0)).toBe(zappy.speed)
      expect(effectiveSpeed(zappy, 5)).toBeCloseTo(zappy.speed * zappy.ult.speedMult)
      const blobby = CLASSES[0]!
      expect(effectiveCooldown(blobby, 0)).toBe(blobby.cooldownTicks)
      expect(effectiveCooldown(blobby, 5)).toBeLessThan(blobby.cooldownTicks)
      expect(effectiveCooldown(blobby, 5)).toBeGreaterThanOrEqual(3)
    })

    it('Aufladung: ohne Kills dauert eine volle Ult mehrere Treffer, Passiv allein sehr lange', () => {
      const dmgToFill = ULT_MAX / ULT_PER_DAMAGE_DEALT
      expect(dmgToFill).toBeGreaterThan(400)
      expect(ULT_MAX * ULT_PASSIVE_TICKS / TICK_RATE).toBeGreaterThan(150) // Sekunden nur passiv
      expect(ULT_DEATH_LOSS).toBeGreaterThan(0)
      expect(ULT_DEATH_LOSS).toBeLessThan(1)
    })

    it('Zielauswahl: nur im Kegel + Reichweite, naeher an der Zielgeraden gewinnt', () => {
      const range = 700
      expect(ultTargetScore(0, 0, 0, range, 300, 0)).toBeLessThan(Infinity)
      expect(ultTargetScore(0, 0, 0, range, 800, 0)).toBe(Infinity) // zu weit
      expect(ultTargetScore(0, 0, 0, range, -300, 0)).toBe(Infinity) // hinten
      expect(ultTargetScore(0, 0, 0, range, 0, 300)).toBe(Infinity) // 90 Grad daneben
      expect(ultTargetScore(0, 0, 0, range, 300, 20)).toBeGreaterThan(ultTargetScore(0, 0, 0, range, 300, 0))
      expect(ultTargetScore(0, 0, Math.PI, range, -300, 10)).toBeLessThan(Infinity) // Winkel-Umbruch
    })
  })
})
