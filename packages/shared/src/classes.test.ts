import { describe, expect, it } from 'vitest'
import {
  CLASSES,
  MODEL_COUNT,
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
})
