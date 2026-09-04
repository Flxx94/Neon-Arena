import { describe, expect, it } from 'vitest'
import {
  ARENA_WIDTH,
  OBSTACLES,
  PLAYER_RADIUS,
  PROJECTILE_DAMAGE,
  RESPAWN_SECONDS,
  TICK_RATE,
} from '@neon-arena/shared'
import { applyInput, createContext, initPlayer, update } from './engine.js'
import { ArenaState, Player } from './state.js'

function addPlayer(state: ArenaState, id: string, x: number, y: number): Player {
  const p = new Player()
  p.nickname = id
  p.x = x
  p.y = y
  state.players.set(id, p)
  return p
}

function input(seq: number, dx = 0, dy = 0, aim = 0, fire = false) {
  return { kind: 'input' as const, seq, dx, dy, aim, fire }
}

describe('engine (M2)', () => {
  it('Fire-Rate: Schuesse im selben Intervall verfallen', () => {
    const ctx = createContext()
    const state = new ArenaState()
    addPlayer(state, 'a', 800, 450)
    initPlayer(ctx, 'a', { x: 800, y: 450 })

    applyInput(ctx, state, 'a', input(0, 0, 0, 0, true))
    update(ctx, state)
    expect(state.projectiles.length).toBe(1)

    // Sofort weiterfeuern -> verworfen (250 ms Intervall, Tick = 33 ms).
    applyInput(ctx, state, 'a', input(1, 0, 0, 0, true))
    update(ctx, state)
    expect(state.projectiles.length).toBe(1)

    // Nach Ablauf des Intervalls -> zweites Projektil.
    for (let i = 0; i < 8; i++) update(ctx, state)
    applyInput(ctx, state, 'a', input(2, 0, 0, 0, true))
    update(ctx, state)
    expect(state.projectiles.length).toBe(2)
  })

  it('Wand-Clamp: kein Durchdringen', () => {
    const ctx = createContext()
    const state = new ArenaState()
    const p = addPlayer(state, 'a', ARENA_WIDTH - PLAYER_RADIUS - 1, 450)
    initPlayer(ctx, 'a', { x: p.x, y: p.y })
    for (let i = 0; i < 30; i++) {
      applyInput(ctx, state, 'a', input(i, 1, 0))
      update(ctx, state)
    }
    expect(p.x).toBeLessThanOrEqual(ARENA_WIDTH - PLAYER_RADIUS)
  })

  it('Hindernis blockt Bewegung', () => {
    const ctx = createContext()
    const state = new ArenaState()
    const o = OBSTACLES[0]!
    const p = addPlayer(state, 'a', o.x - PLAYER_RADIUS - 5, o.y + o.h / 2)
    initPlayer(ctx, 'a', { x: p.x, y: p.y })
    for (let i = 0; i < 60; i++) {
      applyInput(ctx, state, 'a', input(i, 1, 0))
      update(ctx, state)
    }
    expect(p.x).toBeLessThanOrEqual(o.x - PLAYER_RADIUS + 0.001)
  })

  it('Kill -> Respawn nach 3 s mit vollem HP', () => {
    const ctx = createContext()
    const state = new ArenaState()
    addPlayer(state, 'shooter', 700, 450)
    const victim = addPlayer(state, 'victim', 900, 450)
    initPlayer(ctx, 'shooter', { x: 700, y: 450 })
    initPlayer(ctx, 'victim', { x: 900, y: 450 })
    // Spawn-Schutz umgehen (eigener Testfall prueft ihn separat).
    ctx.timers.get('victim')!.protectedUntil = -1

    // 4 Treffer a 25 Schaden (Zielen nach Osten, aim=0).
    for (let hit = 0; hit < 4; hit++) {
      applyInput(ctx, state, 'shooter', input(hit * 10, 0, 0, 0, true))
      for (let i = 0; i < 10; i++) update(ctx, state)
      // Warten bis Intervall um ist.
      for (let i = 0; i < 8; i++) update(ctx, state)
    }
    expect(victim.hp).toBeLessThanOrEqual(100 - PROJECTILE_DAMAGE)
    // Weiter bis Tod.
    for (let round = 0; round < 10 && victim.alive; round++) {
      applyInput(ctx, state, 'shooter', input(100 + round * 10, 0, 0, 0, true))
      for (let i = 0; i < 18; i++) update(ctx, state)
    }
    expect(victim.alive).toBe(false)
    expect(victim.deaths).toBe(1)
    expect(state.players.get('shooter')!.kills).toBe(1)

    // Respawn nach 3 s.
    for (let i = 0; i < RESPAWN_SECONDS * TICK_RATE + 2; i++) update(ctx, state)
    expect(victim.alive).toBe(true)
    expect(victim.hp).toBe(100)
  })

  it('Spawn-Schutz: frischer Spieler nimmt keinen Schaden', () => {
    const ctx = createContext()
    const state = new ArenaState()
    addPlayer(state, 'shooter', 700, 450)
    const victim = addPlayer(state, 'victim', 800, 450)
    initPlayer(ctx, 'shooter', { x: 700, y: 450 })
    initPlayer(ctx, 'victim', { x: 800, y: 450 })
    // Beide frisch -> victim geschuetzt (2 s).
    applyInput(ctx, state, 'shooter', input(0, 0, 0, 0, true))
    for (let i = 0; i < 20; i++) update(ctx, state)
    expect(victim.hp).toBe(100)
  })
})
