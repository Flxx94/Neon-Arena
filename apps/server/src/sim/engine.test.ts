import { describe, expect, it } from 'vitest'
import {
  ARENA_WIDTH,
  CLASSES,
  classOf,
  BOOST_PADS,
  BOOST_SPEED_MULT,
  BOOST_TICKS,
  OBSTACLES,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PROJECTILE_DAMAGE,
  RESPAWN_SECONDS,
  ROUND_END_SECONDS,
  SKIN_COUNT,
  TICK_RATE,
  ULT_DEATH_LOSS,
  ULT_MAX,
  ULT_PASSIVE_TICKS,
  ULT_PER_DAMAGE_DEALT,
  ULT_PER_DAMAGE_TAKEN,
  ULT_PER_KILL,
  SLOW_MULT,
  mapOf,
  ROCKET_TURN_RATE,
} from '@neon-arena/shared'
import {
  applyInput,
  createContext,
  drainEvents,
  initPlayer,
  removePlayer,
  update,
} from './engine.js'
import { ArenaState, Pickup, Player } from './state.js'

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
    const ctx = createContext(false)
    const state = new ArenaState()
    addPlayer(state, 'a', 1400, 800)
    initPlayer(ctx, 'a', { x: 1400, y: 800 })

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
    const ctx = createContext(false)
    const state = new ArenaState()
    const p = addPlayer(state, 'a', ARENA_WIDTH - PLAYER_RADIUS - 1, 800)
    initPlayer(ctx, 'a', { x: p.x, y: p.y })
    for (let i = 0; i < 30; i++) {
      applyInput(ctx, state, 'a', input(i, 1, 0))
      update(ctx, state)
    }
    expect(p.x).toBeLessThanOrEqual(ARENA_WIDTH - PLAYER_RADIUS)
  })

  it('Hindernis blockt Bewegung', () => {
    const ctx = createContext(false)
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
    const ctx = createContext(false)
    const state = new ArenaState()
    addPlayer(state, 'shooter', 1300, 800)
    const victim = addPlayer(state, 'victim', 1500, 800)
    initPlayer(ctx, 'shooter', { x: 1300, y: 800 })
    initPlayer(ctx, 'victim', { x: 1500, y: 800 })
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
    const ctx = createContext(false)
    const state = new ArenaState()
    addPlayer(state, 'shooter', 1300, 800)
    const victim = addPlayer(state, 'victim', 1400, 800)
    initPlayer(ctx, 'shooter', { x: 1300, y: 800 })
    initPlayer(ctx, 'victim', { x: 1400, y: 800 })
    // Beide frisch -> victim geschuetzt (2 s).
    applyInput(ctx, state, 'shooter', input(0, 0, 0, 0, true))
    for (let i = 0; i < 20; i++) update(ctx, state)
    expect(victim.hp).toBe(100)
  })
})

describe('engine runden/pickups/bots (M3)', () => {
  it('Rundenende kuert Sieger, danach Neustart mit Reset', () => {
    const ctx = createContext(false)
    const state = new ArenaState()
    const a = addPlayer(state, 'a', 200, 200)
    const b = addPlayer(state, 'b', 1400, 700)
    initPlayer(ctx, 'a', { x: 200, y: 200 })
    initPlayer(ctx, 'b', { x: 1400, y: 700 })
    a.score = 300
    b.score = 100
    ctx.roundTicksLeft = 2
    update(ctx, state)
    update(ctx, state)
    expect(state.phase).toBe('end')
    expect(state.winner).toBe('a')
    expect(ctx.events.some((e) => e.type === 'roundEnd')).toBe(true)

    for (let i = 0; i < 10 * 30 + 2; i++) update(ctx, state)
    expect(state.phase).toBe('play')
    expect(state.winner).toBe('')
    expect(a.score).toBe(0)
    expect(a.hp).toBe(100)
  })

  it('Kill gibt 100 Punkte + Kill-Event', () => {
    const ctx = createContext(false)
    const state = new ArenaState()
    addPlayer(state, 'shooter', 1300, 800)
    const victim = addPlayer(state, 'victim', 1360, 800)
    initPlayer(ctx, 'shooter', { x: 1300, y: 800 })
    initPlayer(ctx, 'victim', { x: 1360, y: 800 })
    ctx.timers.get('victim')!.protectedUntil = -1
    victim.hp = 25
    applyInput(ctx, state, 'shooter', input(0, 0, 0, 0, true))
    for (let i = 0; i < 10; i++) update(ctx, state)
    expect(victim.alive).toBe(false)
    expect(state.players.get('shooter')!.score).toBe(100)
    expect(ctx.events).toContainEqual({ type: 'kill', by: 'shooter', victim: 'victim' })
    const drained = drainEvents(ctx)
    expect(drained).toContainEqual({ type: 'kill', by: 'shooter', victim: 'victim' })
    expect(ctx.events).toHaveLength(0)
  })

  it('HP-Pickup heilt nur nach Server-Bestaetigung, voll ignoriert', () => {
    const ctx = createContext(false)
    const state = new ArenaState()
    const p = addPlayer(state, 'a', 1400, 800)
    initPlayer(ctx, 'a', { x: 1400, y: 800 })
    p.hp = 50
    // Pickup direkt auf Spieler legen (Server-Sim, keine Client-Fakes).
    const pickup = new Pickup()
    pickup.id = 'u1'
    pickup.kind = 'hp'
    pickup.x = 1400
    pickup.y = 800
    state.pickups.push(pickup)
    update(ctx, state)
    expect(p.hp).toBe(100)
    expect(state.pickups.length).toBe(0)
  })

  it('Shield absorbiert Schaden zuerst', () => {
    const ctx = createContext(false)
    const state = new ArenaState()
    addPlayer(state, 'shooter', 1300, 800)
    const victim = addPlayer(state, 'victim', 1360, 800)
    initPlayer(ctx, 'shooter', { x: 1300, y: 800 })
    initPlayer(ctx, 'victim', { x: 1360, y: 800 })
    ctx.timers.get('victim')!.protectedUntil = -1
    victim.shield = 50
    applyInput(ctx, state, 'shooter', input(0, 0, 0, 0, true))
    // Nur 5 Ticks: genau ein Schuss (Intervall 8 Ticks), Treffer nach ~2 Ticks.
    for (let i = 0; i < 5; i++) update(ctx, state)
    expect(victim.hp).toBe(100)
    expect(victim.shield).toBe(25)
  })

  it('Bots fuellen auf 4 auf, naehern sich und schiessen', () => {
    const ctx = createContext(true)
    const state = new ArenaState()
    addPlayer(state, 'human', 200, 800)
    initPlayer(ctx, 'human', { x: 200, y: 800 })
    update(ctx, state)
    expect(ctx.botIds.size).toBe(3)

    // Deterministisch: einen Bot mit freier Schussbahn platzieren (y=150, ausserhalb der Bloecke).
    for (const id of [...ctx.botIds]) removePlayer(ctx, state, id)
    removePlayer(ctx, state, 'human')
    addPlayer(state, 'human', 200, 150)
    initPlayer(ctx, 'human', { x: 200, y: 150 })
    const bot = addPlayer(state, 'bot-9', 500, 150)
    bot.isBot = true
    initPlayer(ctx, 'bot-9', { x: 500, y: 150 })
    ctx.botIds.add('bot-9')
    for (let i = 0; i < 40; i++) update(ctx, state)
    expect(state.projectiles.length).toBeGreaterThan(0)
  })
})

describe('engine UI v3 (Skins, Aim, Bot-Ausweichen)', () => {
  it('Aim landet gerundet im State (Gegner-Blickrichtung fuer Clients)', () => {
    const ctx = createContext(false)
    const state = new ArenaState()
    const p = addPlayer(state, 'a', 1400, 800)
    initPlayer(ctx, 'a', { x: 1400, y: 800 })
    applyInput(ctx, state, 'a', input(0, 0, 0, 1.2345))
    expect(p.aim).toBeCloseTo(1.25, 5)
    applyInput(ctx, state, 'a', input(1, 0, 0, -3))
    expect(p.aim).toBeCloseTo(-3, 5)
  })

  it('Bots bekommen einen gueltigen Skin und zielen auf ihr Ziel', () => {
    const ctx = createContext(true)
    const state = new ArenaState()
    addPlayer(state, 'human', 200, 800)
    initPlayer(ctx, 'human', { x: 200, y: 800 })
    update(ctx, state)
    expect(ctx.botIds.size).toBe(3)
    for (const id of ctx.botIds) {
      const bot = state.players.get(id)!
      expect(Number.isInteger(bot.skin)).toBe(true)
      expect(bot.skin).toBeGreaterThanOrEqual(0)
      expect(bot.skin).toBeLessThan(SKIN_COUNT)
    }
  })

  it('Bot ohne Sichtlinie weicht quer aus statt an der Wand zu kleben', () => {
    const ctx = createContext(true)
    const state = new ArenaState()
    // Linke Seitenwand (OBSTACLES[0]) liegt genau zwischen Bot und Ziel, beide auf Mittellinie.
    const o = OBSTACLES[0]!
    const y = o.y + o.h / 2
    addPlayer(state, 'human', o.x + o.w + 30, y)
    initPlayer(ctx, 'human', { x: o.x + o.w + 30, y })
    const bot = addPlayer(state, 'bot-9', o.x - 30, y)
    bot.isBot = true
    initPlayer(ctx, 'bot-9', { x: bot.x, y })
    ctx.botIds.add('bot-9')
    // Aufgefuellte Bots deterministisch in die Mitte, weit weg vom Ziel (Math.random fix).
    const realRandom = Math.random
    Math.random = () => 0.5
    try {
      // Bots denken alle 10 Ticks: nach 10 Updates liegt der erste Input vor.
      for (let i = 0; i < 10; i++) update(ctx, state)
    } finally {
      Math.random = realRandom
    }
    const botInput = ctx.inputs.get('bot-9')!
    // Ohne Ausweichen waere dy == 0 (Ziel auf gleicher Hoehe).
    expect(Math.abs(botInput.dy)).toBeGreaterThan(0.1)
    expect(Math.hypot(botInput.dx, botInput.dy)).toBeLessThanOrEqual(1.0001)
    expect(botInput.fire).toBe(false)
  })
})

describe('engine Input-Queue + Boost', () => {
  it('verbraucht pro Tick genau einen Input (Client-Schritte = Server-Schritte)', () => {
    const ctx = createContext(false)
    const state = new ArenaState()
    const p = addPlayer(state, 'a', 1400, 800)
    initPlayer(ctx, 'a', { x: 1400, y: 800 })
    // Zwei Inputs treffen im selben Tick ein.
    applyInput(ctx, state, 'a', input(0, 1, 0))
    applyInput(ctx, state, 'a', input(1, 1, 0))
    update(ctx, state)
    expect(p.ackSeq).toBe(0)
    const step = PLAYER_SPEED / TICK_RATE
    expect(p.x).toBeCloseTo(1400 + step, 5)
    update(ctx, state)
    expect(p.ackSeq).toBe(1)
    expect(p.x).toBeCloseTo(1400 + 2 * step, 5)
    // Kein neuer Input: kein ungeplanter Extra-Schritt.
    update(ctx, state)
    expect(p.x).toBeCloseTo(1400 + 2 * step, 5)
  })

  it('Boost-Feld: Spieler wird schneller und der Boost laeuft ab', () => {
    const ctx = createContext(false)
    const state = new ArenaState()
    const pad = BOOST_PADS[0]!
    const p = addPlayer(state, 'a', pad.x, pad.y)
    initPlayer(ctx, 'a', { x: pad.x, y: pad.y })
    applyInput(ctx, state, 'a', input(0, 0, -1))
    update(ctx, state)
    expect(p.boost).toBeGreaterThan(0)
    const y1 = p.y
    applyInput(ctx, state, 'a', input(1, 0, -1))
    update(ctx, state)
    expect(y1 - p.y).toBeCloseTo((PLAYER_SPEED / TICK_RATE) * BOOST_SPEED_MULT, 5)
    // Feld verlassen, dann stehen bleiben: Boost laeuft aus.
    for (let i = 0; i < BOOST_TICKS + 20; i++) {
      applyInput(ctx, state, 'a', input(2 + i, 0, i < 12 ? -1 : 0))
      update(ctx, state)
    }
    expect(p.boost).toBe(0)
  })

  describe('Charakter-Klassen', () => {
    /** Spieler mit Klasse `model` (Farbe 0) an Position, mit klassenspezifischem Voll-HP. */
    function addClass(state: ArenaState, id: string, model: number, x: number, y: number): Player {
      const p = addPlayer(state, id, x, y)
      p.skin = model
      p.hp = classOf(model).hp
      return p
    }
    function setup(shooterModel: number, victimModel: number, gap = 200, x0 = 1300, y0 = 800) {
      const ctx = createContext(false)
      const state = new ArenaState()
      const shooter = addClass(state, 'shooter', shooterModel, x0, y0)
      const victim = addClass(state, 'victim', victimModel, x0 + gap, y0)
      initPlayer(ctx, 'shooter', { x: x0, y: y0 })
      initPlayer(ctx, 'victim', { x: x0 + gap, y: y0 })
      ctx.timers.get('victim')!.protectedUntil = -1
      ctx.timers.get('shooter')!.protectedUntil = -1
      return { ctx, state, shooter, victim }
    }
    function shootOnce(ctx: ReturnType<typeof createContext>, state: ArenaState, ticks = 30) {
      applyInput(ctx, state, 'shooter', input(1, 0, 0, 0, true))
      update(ctx, state)
      applyInput(ctx, state, 'shooter', input(2, 0, 0, 0, false))
      for (let i = 0; i < ticks; i++) update(ctx, state)
    }

    it('Schaden und Projektil-Eigenschaften kommen aus der Klasse des Schuetzen', () => {
      for (const model of [1, 2, 3, 4, 5]) {
        const { ctx, state, victim } = setup(model, 0, 150)
        // Kitty trifft einen nach Osten blickenden Gegner von hinten -> Rueckenbonus ausschliessen.
        victim.aim = Math.PI
        shootOnce(ctx, state)
        const c = classOf(model)
        expect(victim.hp).toBeCloseTo(classOf(0).hp - c.damage, 5)
      }
    })

    it('Projektil traegt die Klasse (kind) und die Klassengeschwindigkeit', () => {
      const { ctx, state } = setup(3, 0, 1500)
      applyInput(ctx, state, 'shooter', input(1, 0, 0, 0, true))
      update(ctx, state)
      const proj = state.projectiles[0]!
      expect(proj.kind).toBe(3)
      expect(proj.vx).toBeCloseTo(CLASSES[3]!.projectileSpeed, 5)
    })

    it('Abklingzeit je Klasse: Cuby schiesst deutlich seltener als Zappy', () => {
      const count = (model: number): number => {
        const { ctx, state } = setup(model, 0, 2000)
        applyInput(ctx, state, 'shooter', input(1, 0, 0, 0, true))
        let shots = 0
        let seen = new Set<string>()
        for (let i = 0; i < 60; i++) {
          update(ctx, state)
          for (const p of state.projectiles) {
            if (!seen.has(p.id)) {
              seen.add(p.id)
              shots++
            }
          }
        }
        return shots
      }
      expect(count(1)).toBe(Math.ceil(60 / CLASSES[1]!.cooldownTicks))
      expect(count(2)).toBe(Math.ceil(60 / CLASSES[2]!.cooldownTicks))
      expect(count(2)).toBeGreaterThan(count(1) * 2)
    })

    it('Reichweite: Zappy-Bolzen verfallen frueh, Hex-Nadeln fliegen weit', () => {
      const short = setup(2, 0, 1200, 150, 30)
      shootOnce(short.ctx, short.state, 10 + CLASSES[2]!.ttlTicks)
      expect(short.state.projectiles.length).toBe(0)
      const far = setup(3, 0, 1200, 150, 30)
      applyInput(far.ctx, far.state, 'shooter', input(1, 0, 0, 0, true))
      update(far.ctx, far.state)
      for (let i = 0; i < CLASSES[2]!.ttlTicks + 5; i++) update(far.ctx, far.state)
      expect(far.state.projectiles.length).toBe(1)
    })

    it('Kitty: Rueckenschaden nur, wenn das Ziel vom Schuetzen wegschaut', () => {
      const away = setup(5, 0, 150)
      away.victim.aim = 0 // schaut in Flugrichtung (nach Osten) = Ruecken zum Schuetzen
      shootOnce(away.ctx, away.state)
      expect(classOf(0).hp - away.victim.hp).toBeCloseTo(CLASSES[5]!.damage * CLASSES[5]!.backstab, 5)
      const facing = setup(5, 0, 150)
      facing.victim.aim = Math.PI // schaut den Schuetzen an
      shootOnce(facing.ctx, facing.state)
      expect(classOf(0).hp - facing.victim.hp).toBeCloseTo(CLASSES[5]!.damage, 5)
    })

    it('Boo: Lifesteal heilt, ist aber auf Max-HP begrenzt', () => {
      const { ctx, state, shooter, victim } = setup(4, 0, 150)
      shooter.hp = 60
      victim.aim = Math.PI
      shootOnce(ctx, state)
      expect(shooter.hp).toBeCloseTo(60 + CLASSES[4]!.damage * CLASSES[4]!.lifesteal, 5)
      const full = setup(4, 0, 150)
      full.victim.aim = Math.PI
      shootOnce(full.ctx, full.state)
      expect(full.shooter.hp).toBe(CLASSES[4]!.hp)
    })

    it('Tempo je Klasse: Bewegung nutzt die Klassen-Geschwindigkeit (Server = Prediction)', () => {
      for (const model of [0, 1, 2]) {
        const ctx = createContext(false)
        const state = new ArenaState()
        const p = addClass(state, 'a', model, 1300, 800)
        initPlayer(ctx, 'a', { x: 1300, y: 800 })
        applyInput(ctx, state, 'a', input(1, 1, 0))
        const x0 = p.x
        update(ctx, state)
        expect(p.x - x0).toBeCloseTo(classOf(model).speed / TICK_RATE, 5)
      }
    })

    it('Respawn und Heil-Pickup nutzen die Max-HP der Klasse', () => {
      const ctx = createContext(false)
      const state = new ArenaState()
      const tank = addClass(state, 'tank', 1, 1300, 800)
      initPlayer(ctx, 'tank', { x: 1300, y: 800 })
      tank.hp = 0
      tank.alive = false
      ctx.timers.get('tank')!.respawnAt = ctx.tick
      update(ctx, state)
      expect(tank.alive).toBe(true)
      expect(tank.hp).toBe(CLASSES[1]!.hp)
      tank.hp = CLASSES[1]!.hp - 5
      const pu = new Pickup()
      pu.id = 'u1'
      pu.kind = 'hp'
      pu.x = tank.x
      pu.y = tank.y
      state.pickups.push(pu)
      update(ctx, state)
      expect(tank.hp).toBe(CLASSES[1]!.hp)
    })
  })

  describe('Ults', () => {
    let curCtx: ReturnType<typeof createContext> | null = null
    function world(models: number[], gap = 200, x0 = 150, y0 = 30) {
      const ctx = createContext(false)
      curCtx = ctx
      const state = new ArenaState()
      const ps = models.map((m, i) => {
        const id = `p${i}`
        const p = addPlayer(state, id, x0 + i * gap, y0)
        p.skin = m
        p.hp = classOf(m).hp
        initPlayer(ctx, id, { x: p.x, y: p.y })
        ctx.timers.get(id)!.protectedUntil = -1
        return p
      })
      return { ctx, state, ps }
    }
    const idOf = (i: number) => `p${i}`
    let seqN = 100
    function press(ctx: ReturnType<typeof createContext>, state: ArenaState, i: number, extra = {}) {
      applyInput(ctx, state, idOf(i), { ...input(seqN++, 0, 0, 0, false), ult: true, ...extra })
    }
    function idle(ctx: ReturnType<typeof createContext>, state: ArenaState, i: number, extra = {}) {
      applyInput(ctx, state, idOf(i), { ...input(seqN++, 0, 0, 0, false), ...extra })
    }
    function run(ctx: ReturnType<typeof createContext>, state: ArenaState, ticks: number) {
      for (let i = 0; i < ticks; i++) update(ctx, state)
    }

    it('Aufladung: Schaden austeilen/einstecken, Kill und Zeit laden; gedeckelt auf ULT_MAX', () => {
      const { ctx, state, ps } = world([0, 0], 150)
      ps[1]!.aim = Math.PI
      applyInput(ctx, state, 'p0', input(1, 0, 0, 0, true))
      run(ctx, state, 12)
      expect(ps[0]!.ult).toBeGreaterThanOrEqual(Math.round(25 * ULT_PER_DAMAGE_DEALT))
      expect(ps[1]!.ult).toBeGreaterThanOrEqual(Math.round(25 * ULT_PER_DAMAGE_TAKEN))
      ps[0]!.ult = ULT_MAX - 1
      run(ctx, state, 40)
      expect(ps[0]!.ult).toBe(ULT_MAX)
    })

    it('Passiv: +1 alle ULT_PASSIVE_TICKS Ticks', () => {
      const { ctx, state, ps } = world([0], 150)
      run(ctx, state, ULT_PASSIVE_TICKS * 5)
      expect(ps[0]!.ult).toBe(5)
    })

    it('Tod: nicht volle Ult verliert 35 %, volle bleibt voll', () => {
      for (const [start, expected] of [
        [600, Math.floor(600 * (1 - ULT_DEATH_LOSS))],
        [ULT_MAX, ULT_MAX],
      ] as const) {
        const { ctx, state, ps } = world([1, 0], 150)
        ps[1]!.ult = start
        ps[1]!.hp = 1
        applyInput(ctx, state, 'p0', input(1, 0, 0, 0, true))
        run(ctx, state, 12)
        expect(ps[1]!.alive).toBe(false)
        // Nach dem Tod keine Aufladung mehr, nur der Verlust (+ evtl. Treffer-Ladung vor dem Tod).
        expect(ps[1]!.ult).toBeLessThanOrEqual(expected + Math.round(ULT_PER_DAMAGE_TAKEN * 40))
        expect(ps[1]!.ult).toBeGreaterThanOrEqual(expected)
        if (start === ULT_MAX) expect(ps[1]!.ult).toBe(ULT_MAX)
      }
    })

    it('Ult nur bei voller Ladung; danach Ladung 0', () => {
      const { ctx, state, ps } = world([0], 150)
      press(ctx, state, 0)
      run(ctx, state, 2)
      expect(ps[0]!.ultTicks).toBe(0)
      ps[0]!.ult = ULT_MAX
      press(ctx, state, 0)
      run(ctx, state, 2)
      expect(ps[0]!.ultTicks).toBeGreaterThan(0)
      expect(ps[0]!.ult).toBeLessThan(20)
    })

    /** Spieler frei platzieren (Tests mit definierter Geometrie). */
    function put(p: Player, x: number, y: number) {
      p.x = x
      p.y = y
      curCtx?.histories.set(p.nickname, [{ x, y }]) // Rewind-Historie mitnehmen
    }

    it('Elektrofeld (Zappy): verlangsamt + schadet nur im Radius, Zielhilfe dreht Schuesse zum Gegner', () => {
      const { ctx, state, ps } = world([2, 0, 0], 100)
      put(ps[0]!, 400, 500)
      put(ps[1]!, 400 + 150, 500) // im Feld
      put(ps[2]!, 400 + 600, 500) // ausserhalb
      ps[0]!.ult = ULT_MAX
      press(ctx, state, 0)
      run(ctx, state, 31)
      const def = CLASSES[2]!.ult
      expect(ps[1]!.slow).toBeGreaterThan(0)
      expect(ps[1]!.hp).toBeLessThan(classOf(0).hp)
      expect(ps[1]!.hp).toBeGreaterThanOrEqual(classOf(0).hp - def.tickDamage * 3)
      expect(ps[2]!.slow).toBe(0)
      expect(ps[2]!.hp).toBe(classOf(0).hp)
      // Verlangsamung: Tempo des Gegners im Feld sinkt auf SLOW_MULT
      const x0 = ps[1]!.x
      applyInput(ctx, state, 'p1', input(seqN++, 1, 0))
      update(ctx, state)
      expect(ps[1]!.x - x0).toBeCloseTo((classOf(0).speed * SLOW_MULT) / TICK_RATE, 3)
      // Autoaim: Ziel 0.1 rad neben der Zielrichtung wird ohne Ult verfehlt, mit Ult getroffen
      const shot = (withUlt: boolean) => {
        const w = world([2, 0], 100)
        put(w.ps[0]!, 150, 40)
        put(w.ps[1]!, 150 + Math.cos(0.1) * 300, 40 + Math.sin(0.1) * 300)
        if (withUlt) {
          w.ps[0]!.ult = ULT_MAX
          press(w.ctx, w.state, 0)
          run(w.ctx, w.state, 2)
        }
        const hp0 = w.ps[1]!.hp
        applyInput(w.ctx, w.state, 'p0', input(seqN++, 0, 0, 0, true))
        run(w.ctx, w.state, 20)
        return hp0 - w.ps[1]!.hp
      }
      expect(shot(false)).toBe(0)
      expect(shot(true)).toBeGreaterThanOrEqual(CLASSES[2]!.damage)
    })

    it('Weltenstrahl (Hexo): One-Shot fuer alle in der Bahn, ueber die ganze Map, durch Hindernisse', () => {
      const { ctx, state, ps } = world([3, 1, 0, 0], 100)
      put(ps[0]!, 100, 800)
      put(ps[1]!, 900, 800) // Cuby (180 HP), mitten in der Bahn
      put(ps[2]!, 2600, 800) // ganz am anderen Ende
      put(ps[3]!, 900, 1000) // ausserhalb der Bahn
      ps[0]!.ult = ULT_MAX
      press(ctx, state, 0, { ua: 0, ud: 1 })
      update(ctx, state)
      expect(ps[1]!.alive).toBe(false)
      expect(ps[2]!.alive).toBe(false)
      expect(ps[3]!.alive).toBe(true)
      expect(ps[0]!.ultTicks).toBeGreaterThan(0) // Anzeigedauer
      // Ult-Kills laden die Ult nicht sofort wieder voll (nur Kill-Bonus)
      expect(ps[0]!.ult).toBeLessThanOrEqual(2 * ULT_PER_KILL + 40)
    })

    it('Riesenwuerfel (Cuby): Einschlag nach Flugzeit, One-Shot am Ziel, Schockwelle stoesst zurueck', () => {
      const { ctx, state, ps } = world([1, 0, 0, 0], 100)
      put(ps[0]!, 300, 800)
      put(ps[1]!, 300 + 400, 800) // Einschlagpunkt (ud = 400/600)
      put(ps[2]!, 300 + 400 + 140, 800) // neben dem Einschlag -> Rueckstoss
      put(ps[3]!, 300 + 400 + 600, 800) // weit weg
      ps[0]!.ult = ULT_MAX
      press(ctx, state, 0, { ua: 0, ud: 400 / 600 })
      update(ctx, state)
      expect(ps[0]!.ultX).toBeCloseTo(700, 0)
      expect(ps[0]!.ultTicks).toBeGreaterThan(0)
      expect(ps[1]!.alive).toBe(true) // noch in der Luft
      const x2 = ps[2]!.x
      run(ctx, state, CLASSES[1]!.ult.durationTicks + 1)
      expect(ps[1]!.alive).toBe(false)
      expect(ps[2]!.alive).toBe(true)
      expect(ps[2]!.x).toBeGreaterThan(x2 + 40)
      expect(ps[3]!.x).toBe(300 + 400 + 600)
      expect(ps[0]!.ultTicks).toBe(0)
    })

    it('Raketenflug (Blobby): fliegt ueber Hindernisse, unverwundbar, explodiert ueber Gegner, Salve + Neuspawn', () => {
      const { ctx, state, ps } = world([0, 1, 2, 0], 100)
      // Weg quer durch die Map-Mitte (Hindernisse) zu Gegner 1
      put(ps[0]!, 700, 800)
      put(ps[1]!, 1500, 800)
      put(ps[2]!, 1500 + 60, 800 + 40) // im Explosionsradius
      put(ps[3]!, 2500, 100) // weit weg
      ps[0]!.ult = ULT_MAX
      press(ctx, state, 0, { ua: 0, ud: 1 })
      update(ctx, state)
      expect(ps[0]!.ultTicks).toBeGreaterThan(0)
      // Waehrend des Flugs: kein Schaden, keine Kollision, schiessen unmoeglich
      applyInput(ctx, state, 'p3', input(seqN++, 0, 0, Math.atan2(800 - 100, 700 - 2500), true))
      const hp = ps[0]!.hp
      let minX = ps[0]!.x
      let exploded = false
      for (let i = 0; i < 60 && !exploded; i++) {
        applyInput(ctx, state, 'p0', input(seqN++, 1, 0, 0, true))
        update(ctx, state)
        if (ps[0]!.ultTicks === 0) exploded = true
        else minX = Math.max(minX, ps[0]!.x)
        if (!exploded) expect(ps[0]!.hp).toBe(hp)
      }
      expect(exploded).toBe(true)
      expect(minX).toBeGreaterThan(1000) // hat die Mitte ueberflogen
      expect(ps[1]!.alive).toBe(false)
      expect(ps[2]!.alive).toBe(false)
      expect(ps[3]!.alive).toBe(true)
      // Salve + Neuspawn an anderem Punkt
      expect(state.projectiles.length).toBeGreaterThanOrEqual(CLASSES[0]!.ult.salvo - 1)
      expect(Math.hypot(ps[0]!.x - 1500, ps[0]!.y - 800)).toBeGreaterThan(5)
    })

    it('Rakete ohne Gegner explodiert nach Ablauf und Blobby taucht woanders auf', () => {
      const { ctx, state, ps } = world([0], 100)
      put(ps[0]!, 300, 300)
      ps[0]!.ult = ULT_MAX
      press(ctx, state, 0, { ua: 0, ud: 1 })
      run(ctx, state, CLASSES[0]!.ult.durationTicks + 3)
      expect(ps[0]!.ultTicks).toBe(0)
      expect(state.projectiles.length).toBeGreaterThan(0)
    })

    it('Rakete: weiche Kurven (begrenzte Lenkrate), Explosion bleibt sichtbar, danach erst Neuspawn', () => {
      const { ctx, state, ps } = world([0], 100)
      put(ps[0]!, 1400, 800)
      ps[0]!.ult = ULT_MAX
      press(ctx, state, 0, { ua: 0, ud: 1 })
      update(ctx, state)
      let last = ps[0]!.ultAim
      let maxTurn = 0
      for (let i = 0; i < 20; i++) {
        applyInput(ctx, state, 'p0', input(seqN++, -1, 0, 0, false)) // sofort 180 Grad verlangt
        update(ctx, state)
        maxTurn = Math.max(maxTurn, Math.abs(ps[0]!.ultAim - last))
        last = ps[0]!.ultAim
      }
      expect(maxTurn).toBeLessThanOrEqual(ROCKET_TURN_RATE / TICK_RATE + 1e-3)
      expect(maxTurn).toBeGreaterThan(0.05)
      // Ablauf: unsichtbar am Explosionsort, danach Respawn woanders
      let guard = 0
      while (ps[0]!.ultTicks > 0 && guard++ < 200) update(ctx, state)
      expect(ps[0]!.hidden).toBeGreaterThan(0)
      const ex = { x: ps[0]!.x, y: ps[0]!.y }
      run(ctx, state, 5)
      expect(Math.hypot(ps[0]!.x - ex.x, ps[0]!.y - ex.y)).toBeLessThan(1)
      const hp = ps[0]!.hp
      expect(hp).toBeGreaterThan(0)
      run(ctx, state, 40)
      expect(ps[0]!.hidden).toBe(0)
    })

    it('Geisterwelt: Ziel kann sich bewegen, aber nicht schiessen', () => {
      const { ctx, state, ps } = world([4, 0], 300)
      ps[0]!.ult = ULT_MAX
      press(ctx, state, 0)
      update(ctx, state)
      expect(ps[1]!.disarm).toBeGreaterThan(0)
      const x0 = ps[1]!.x
      applyInput(ctx, state, 'p1', input(seqN++, 1, 0, Math.PI, true))
      run(ctx, state, 8)
      expect(ps[1]!.x).toBeGreaterThan(x0 + 5)
      expect(state.projectiles.filter((pr) => pr.owner === 'p1').length).toBe(0)
    })

    it('Schattensprung (Kitty): springt zum Ziel, betaeubt es ~2 s, Betaeubte stehen und schiessen nicht', () => {
      const { ctx, state, ps } = world([5, 0], 400)
      ps[0]!.ult = ULT_MAX
      press(ctx, state, 0)
      update(ctx, state)
      expect(Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y)).toBeLessThan(2 * PLAYER_RADIUS + 12)
      expect(ps[1]!.stun).toBeGreaterThan(CLASSES[5]!.ult.stunTicks - 3)
      const x0 = ps[1]!.x
      applyInput(ctx, state, 'p1', input(seqN++, 1, 0, 0, true))
      run(ctx, state, 10)
      expect(ps[1]!.x).toBe(x0)
      expect(state.projectiles.length).toBe(0)
      run(ctx, state, CLASSES[5]!.ult.stunTicks)
      expect(ps[1]!.stun).toBe(0)
      applyInput(ctx, state, 'p1', input(seqN++, 1, 0))
      update(ctx, state)
      expect(ps[1]!.x).toBeGreaterThan(x0)
    })

    it('Ult mit Ziel ohne Gegner im Zielkegel: keine Aktivierung, Ladung bleibt', () => {
      const { ctx, state, ps } = world([5, 0], 400)
      ps[0]!.ult = ULT_MAX
      press(ctx, state, 0, { aim: Math.PI / 2 })
      run(ctx, state, 2)
      expect(ps[0]!.ult).toBe(ULT_MAX)
      expect(ps[1]!.stun).toBe(0)
    })

    it('Geisterwelt (Boo): gemeinsame Welt, Ziel gewurzelt, Dritte treffen/sehen sich nicht, Ende nach Dauer', () => {
      const { ctx, state, ps } = world([4, 0, 0], 300)
      ps[0]!.ult = ULT_MAX
      press(ctx, state, 0)
      update(ctx, state)
      expect(ps[0]!.realm).not.toBe(0)
      expect(ps[1]!.realm).toBe(ps[0]!.realm)
      expect(ps[2]!.realm).toBe(0)
      expect(ps[1]!.disarm).toBeGreaterThan(0)
      // Dritter schiesst auf Ziel in der Geisterwelt: kein Schaden.
      ps[2]!.x = ps[1]!.x + 200
      ps[2]!.y = ps[1]!.y
      const hp = ps[1]!.hp
      applyInput(ctx, state, 'p2', input(seqN++, 0, 0, Math.PI, true))
      run(ctx, state, 10)
      expect(ps[1]!.hp).toBe(hp)
      // Boo trifft das Ziel (gleiche Welt).
      applyInput(ctx, state, 'p0', input(seqN++, 0, 0, Math.atan2(ps[1]!.y - ps[0]!.y, ps[1]!.x - ps[0]!.x), true))
      run(ctx, state, 10)
      expect(ps[1]!.hp).toBeLessThan(hp)
      // Ende
      run(ctx, state, CLASSES[4]!.ult.durationTicks)
      expect(ps[0]!.realm).toBe(0)
      expect(ps[1]!.realm).toBe(0)
      expect(ps[1]!.disarm).toBe(0)
    })

    it('Geisterwelt endet sofort, wenn Boo oder das Ziel stirbt', () => {
      const { ctx, state, ps } = world([4, 0], 300)
      ps[0]!.ult = ULT_MAX
      press(ctx, state, 0)
      update(ctx, state)
      ps[1]!.hp = 1
      applyInput(ctx, state, 'p0', input(seqN++, 0, 0, Math.atan2(ps[1]!.y - ps[0]!.y, ps[1]!.x - ps[0]!.x), true))
      run(ctx, state, 10)
      expect(ps[1]!.alive).toBe(false)
      expect(ps[0]!.realm).toBe(0)
      expect(ps[0]!.ultTicks).toBe(0)
      expect(ctx.ghostTarget.size).toBe(0)
    })

    it('Rundenstart setzt Ult und Status zurueck; idle-Input haelt nichts am Leben', () => {
      const { ctx, state, ps } = world([5, 0], 400)
      ps[0]!.ult = ULT_MAX
      ps[1]!.stun = 50
      idle(ctx, state, 0)
      ctx.roundTicksLeft = 1
      run(ctx, state, 2 + ROUND_END_SECONDS * TICK_RATE + 2)
      expect(ps[0]!.ult).toBeLessThan(20)
      expect(ps[1]!.stun).toBe(0)
    })
  })
  describe('Karten', () => {
    it('wechselt pro Runde die Karte, leert Pickups und spawnt ausserhalb von Hindernissen', () => {
      const ctx = createContext(false)
      const state = new ArenaState()
      for (let i = 0; i < 6; i++) {
        addPlayer(state, `p${i}`, 1400, 800)
        initPlayer(ctx, `p${i}`, { x: 1400, y: 800 })
      }
      const pk = new Pickup()
      pk.x = 100
      pk.y = 100
      state.pickups.push(pk)
      const seen = new Set<number>([state.map])
      for (let round = 0; round < 6; round++) {
        const before = state.map
        ctx.roundTicksLeft = 1
        for (let i = 0; i < 2 + ROUND_END_SECONDS * TICK_RATE + 2; i++) update(ctx, state)
        expect(state.phase).toBe('play')
        expect(state.map).not.toBe(before)
        seen.add(state.map)
        const m = mapOf(state.map)
        for (const p of state.players.values()) {
          const hit = m.obstacles.some(
            (o) => p.x > o.x - PLAYER_RADIUS && p.x < o.x + o.w + PLAYER_RADIUS && p.y > o.y - PLAYER_RADIUS && p.y < o.y + o.h + PLAYER_RADIUS,
          )
          expect(hit).toBe(false)
        }
      }
      expect(seen.size).toBeGreaterThan(2)
    })

    it('Kollision nutzt die Hindernisse der aktiven Karte', () => {
      const ctx = createContext(false)
      const state = new ArenaState()
      state.map = 1
      const o = mapOf(1).obstacles[0]!
      const p = addPlayer(state, 'a', o.x - PLAYER_RADIUS - 2, o.y + o.h / 2)
      initPlayer(ctx, 'a', { x: p.x, y: p.y })
      for (let i = 0; i < 20; i++) {
        applyInput(ctx, state, 'a', input(i + 1, 1, 0, 0, false))
        update(ctx, state)
      }
      expect(p.x).toBeLessThanOrEqual(o.x - PLAYER_RADIUS + 0.01)
    })
  })
})
