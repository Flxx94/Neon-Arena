import { describe, expect, it } from 'vitest'
import {
  CLASSES,
  MODEL_COUNT,
  ULT_DEATH_LOSS,
  ULT_MAX,
  ULT_PASSIVE_TICKS,
  ULT_PER_DAMAGE_DEALT,
  ONE_SHOT,
  SLOW_MULT,
  effectiveSpeed,
  isFlying,
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

    it('Effekte: Tempo nur waehrend Geisterwelt/Rakete, Verlangsamung im Feld, Rakete fliegt', () => {
      const boo = CLASSES[4]!
      const blobby = CLASSES[0]!
      expect(effectiveSpeed(boo, 0)).toBe(boo.speed)
      expect(effectiveSpeed(boo, 5)).toBeCloseTo(boo.speed * boo.ult.speedMult)
      expect(effectiveSpeed(blobby, 5)).toBeCloseTo(blobby.speed * blobby.ult.speedMult)
      expect(effectiveSpeed(boo, 0, 3)).toBeCloseTo(boo.speed * SLOW_MULT)
      expect(isFlying(blobby, 5)).toBe(true)
      expect(isFlying(blobby, 0)).toBe(false)
      expect(isFlying(boo, 5)).toBe(false)
    })

    it('Ult-Parameter passen zur Art (Reichweiten, One-Shot, Schockwelle)', () => {
      const by = (k: string) => CLASSES.find((c) => c.ult.kind === k)!.ult
      expect(by('beam').range).toBeGreaterThan(Math.hypot(2800, 1600)) // ganze Map
      expect(by('beam').width).toBeGreaterThan(60)
      expect(by('slam').shockRadius).toBeGreaterThan(by('slam').radius)
      expect(by('slam').knockback).toBeGreaterThan(0)
      expect(by('field').tickDamage).toBeGreaterThan(0)
      expect(by('rocket').salvo).toBeGreaterThanOrEqual(8)
      expect(ONE_SHOT).toBeGreaterThan(Math.max(...CLASSES.map((c) => c.hp + 50)))
      for (const c of CLASSES) {
        const needsPoint = c.ult.aim === 'target' || c.ult.aim === 'point'
        if (needsPoint) expect(c.ult.range).toBeGreaterThan(0)
      }
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
