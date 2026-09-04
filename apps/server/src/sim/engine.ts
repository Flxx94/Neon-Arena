import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BOT_FIRE_RANGE,
  BOT_PREFERRED_RANGE,
  BOT_THINK_TICKS,
  FIRE_INTERVAL_MS,
  FILL_MIN_PLAYERS,
  KILL_SCORE,
  MAX_BOTS_PER_ROOM,
  OBSTACLES,
  PICKUP_HP_AMOUNT,
  PICKUP_MAX_ACTIVE,
  PICKUP_RADIUS,
  PICKUP_SHIELD_AMOUNT,
  PICKUP_SPAWN_INTERVAL_MS,
  PLAYER_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PROJECTILE_DAMAGE,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  PROJECTILE_TTL_MS,
  RESPAWN_SECONDS,
  REWIND_TICKS,
  ROUND_END_SECONDS,
  ROUND_SECONDS,
  SHIELD_MAX,
  SPAWN_PROTECTION_SECONDS,
  SURVIVAL_BONUS,
  TICK_RATE,
  resolveArena,
  resolveCircle,
  resolveRect,
  segmentHitsCircle,
  type PickupKind,
  type ValidatedInput,
} from '@neon-arena/shared'
import { ArenaState, Pickup, Player, Projectile } from './state.js'

export interface PlayerTimers {
  respawnAt: number
  protectedUntil: number
  lastFireTick: number
}

export type SimEvent =
  | { type: 'kill'; by: string; victim: string }
  | { type: 'roundEnd'; winner: string }
  | { type: 'roundStart' }

export interface SimContext {
  tick: number
  /** Letzter Input pro Spieler (wird jeden Tick angewendet). */
  inputs: Map<string, ValidatedInput>
  /** Positions-Historie pro Spieler (neueste zuletzt, fuer Server-Rewind). */
  histories: Map<string, { x: number; y: number }[]>
  timers: Map<string, PlayerTimers>
  projectileTtl: Map<string, number>
  nextProjectileId: number
  nextPickupId: number
  nextBotNum: number
  roundTicksLeft: number
  endTicksLeft: number
  pickupTimer: number
  botIds: Set<string>
  botsEnabled: boolean
  /** Events seit letztem Drain (Room broadcastet sie). */
  events: SimEvent[]
}

export function createContext(botsEnabled = true): SimContext {
  return {
    tick: 0,
    inputs: new Map(),
    histories: new Map(),
    timers: new Map(),
    projectileTtl: new Map(),
    nextProjectileId: 1,
    nextPickupId: 1,
    nextBotNum: 1,
    roundTicksLeft: ROUND_SECONDS * TICK_RATE,
    endTicksLeft: 0,
    pickupTimer: Math.ceil((PICKUP_SPAWN_INTERVAL_MS / 1000) * TICK_RATE),
    botIds: new Set(),
    botsEnabled,
    events: [],
  }
}

export function initPlayer(ctx: SimContext, sessionId: string, pos: { x: number; y: number }): void {
  ctx.histories.set(sessionId, [{ ...pos }])
  ctx.timers.set(sessionId, {
    respawnAt: -1,
    protectedUntil: ctx.tick + SPAWN_PROTECTION_SECONDS * TICK_RATE,
    lastFireTick: -10_000,
  })
}

export function removePlayer(ctx: SimContext, state: ArenaState, sessionId: string): void {
  ctx.inputs.delete(sessionId)
  ctx.histories.delete(sessionId)
  ctx.timers.delete(sessionId)
  ctx.botIds.delete(sessionId)
  state.players.delete(sessionId)
}

/** Events abholen + leeren (Room broadcastet sie danach). */
export function drainEvents(ctx: SimContext): SimEvent[] {
  const events = [...ctx.events]
  ctx.events.length = 0
  return events
}

/** Zufaelliger Spawn ohne Overlap mit lebenden Spielern und ausserhalb von Hindernissen. */
export function findSpawn(others: Player[]): { x: number; y: number } {
  for (let i = 0; i < 20; i++) {
    const x = PLAYER_RADIUS + Math.random() * (ARENA_WIDTH - 2 * PLAYER_RADIUS)
    const y = PLAYER_RADIUS + Math.random() * (ARENA_HEIGHT - 2 * PLAYER_RADIUS)
    if (insideObstacle(x, y, PLAYER_RADIUS)) continue
    const overlap = others.some((p) => Math.hypot(p.x - x, p.y - y) < 2 * PLAYER_RADIUS)
    if (!overlap) return { x, y }
  }
  return { x: ARENA_WIDTH / 2, y: 100 }
}

function insideObstacle(x: number, y: number, margin: number): boolean {
  return OBSTACLES.some((o) => x > o.x - margin && x < o.x + o.w + margin && y > o.y - margin && y < o.y + o.h + margin)
}

/** Validierten Input ablegen; wird im naechsten Tick angewendet (inkl. ackSeq). */
export function applyInput(
  ctx: SimContext,
  state: ArenaState,
  sessionId: string,
  input: ValidatedInput,
): void {
  const player = state.players.get(sessionId)
  if (!player) return
  ctx.inputs.set(sessionId, input)
  player.ackSeq = input.seq
}

/** Ein 30-Hz-Tick: Runde, Respawns, Bewegung, Kollision, Feuer, Projektile, Pickups, Bots. */
export function update(ctx: SimContext, state: ArenaState): void {
  ctx.tick++
  const dt = 1 / TICK_RATE
  const step = PLAYER_SPEED * dt

  updateRound(ctx, state)
  if (state.phase === 'play') {
    handleRespawns(ctx, state)
    thinkBots(ctx, state)
    maintainBots(ctx, state)
    movePlayers(ctx, state, step)
    resolvePlayerCollisions(state)
    fireWeapons(ctx, state)
    updateProjectiles(ctx, state, dt)
    updatePickups(ctx, state)
  } else {
    // End-Screen: weiterlaufen lassen, aber kein Schaden, keine neuen Pickups.
    movePlayers(ctx, state, step)
    updateProjectiles(ctx, state, dt)
  }
  pushHistories(ctx, state)
}

// --- Runden (M3-03) ---

function updateRound(ctx: SimContext, state: ArenaState): void {
  if (state.phase === 'play') {
    if (state.players.size === 0) return
    ctx.roundTicksLeft--
    state.timeLeft = Math.max(0, Math.ceil(ctx.roundTicksLeft / TICK_RATE))
    if (ctx.roundTicksLeft > 0) return
    endRound(ctx, state)
  } else {
    ctx.endTicksLeft--
    state.timeLeft = Math.max(0, Math.ceil(ctx.endTicksLeft / TICK_RATE))
    if (ctx.endTicksLeft > 0) return
    startRound(ctx, state)
  }
}

function endRound(ctx: SimContext, state: ArenaState): void {
  let winner = ''
  let best = -1
  for (const player of state.players.values()) {
    if (player.alive) player.score += SURVIVAL_BONUS
    if (player.score > best) {
      best = player.score
      winner = player.nickname
    }
  }
  state.phase = 'end'
  state.winner = winner
  ctx.endTicksLeft = ROUND_END_SECONDS * TICK_RATE
  ctx.events.push({ type: 'roundEnd', winner })
}

function startRound(ctx: SimContext, state: ArenaState): void {
  state.projectiles.splice(0, state.projectiles.length)
  const placed: Player[] = []
  for (const player of state.players.values()) {
    const spawn = findSpawn(placed)
    player.x = spawn.x
    player.y = spawn.y
    player.hp = PLAYER_HP
    player.shield = 0
    player.alive = true
    player.kills = 0
    player.deaths = 0
    player.score = 0
    placed.push(player)
  }
  for (const [id, player] of state.players) {
    const timers = ctx.timers.get(id)
    if (timers) {
      timers.protectedUntil = ctx.tick + SPAWN_PROTECTION_SECONDS * TICK_RATE
      timers.respawnAt = -1
    }
    ctx.histories.set(id, [{ x: player.x, y: player.y }])
  }
  state.phase = 'play'
  state.winner = ''
  ctx.roundTicksLeft = ROUND_SECONDS * TICK_RATE
  ctx.events.push({ type: 'roundStart' })
}

function handleRespawns(ctx: SimContext, state: ArenaState): void {
  for (const [id, player] of state.players) {
    if (player.alive) continue
    const timers = ctx.timers.get(id)
    if (!timers || ctx.tick < timers.respawnAt) continue
    const alive = [...state.players.values()].filter((p) => p.alive)
    const spawn = findSpawn(alive)
    player.x = spawn.x
    player.y = spawn.y
    player.hp = PLAYER_HP
    player.shield = 0
    player.alive = true
    timers.protectedUntil = ctx.tick + SPAWN_PROTECTION_SECONDS * TICK_RATE
    ctx.histories.set(id, [{ x: spawn.x, y: spawn.y }])
  }
}

function movePlayers(ctx: SimContext, state: ArenaState, step: number): void {
  for (const [id, player] of state.players) {
    if (!player.alive) continue
    const input = ctx.inputs.get(id)
    if (!input) continue
    player.x += input.dx * step
    player.y += input.dy * step
    resolveArena(player, PLAYER_RADIUS)
    for (const obstacle of OBSTACLES) {
      resolveRect(player, PLAYER_RADIUS, obstacle)
    }
  }
}

function resolvePlayerCollisions(state: ArenaState): void {
  const alive = [...state.players.entries()].filter(([, p]) => p.alive)
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const [, a] = alive[i]!
      const [, b] = alive[j]!
      if (resolveCircle(a, PLAYER_RADIUS, b, PLAYER_RADIUS)) {
        resolveArena(a, PLAYER_RADIUS)
        resolveArena(b, PLAYER_RADIUS)
      }
    }
  }
}

function fireWeapons(ctx: SimContext, state: ArenaState): void {
  const intervalTicks = Math.ceil((FIRE_INTERVAL_MS / 1000) * TICK_RATE)
  for (const [id, player] of state.players) {
    if (!player.alive) continue
    const input = ctx.inputs.get(id)
    const timers = ctx.timers.get(id)
    if (!input?.fire || !timers) continue
    // Fire-Rate serverseitig erzwungen (M2-03): zu fruehe Schuesse verfallen.
    if (ctx.tick - timers.lastFireTick < intervalTicks) continue
    timers.lastFireTick = ctx.tick
    const proj = new Projectile()
    proj.id = `p${ctx.nextProjectileId++}`
    proj.owner = id
    const aim = input.aim
    proj.x = player.x + Math.cos(aim) * (PLAYER_RADIUS + PROJECTILE_RADIUS + 1)
    proj.y = player.y + Math.sin(aim) * (PLAYER_RADIUS + PROJECTILE_RADIUS + 1)
    proj.vx = Math.cos(aim) * PROJECTILE_SPEED
    proj.vy = Math.sin(aim) * PROJECTILE_SPEED
    state.projectiles.push(proj)
    ctx.projectileTtl.set(proj.id, Math.ceil((PROJECTILE_TTL_MS / 1000) * TICK_RATE))
  }
}

function updateProjectiles(ctx: SimContext, state: ArenaState, dt: number): void {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const proj = state.projectiles[i]!
    const prevX = proj.x
    const prevY = proj.y
    proj.x += proj.vx * dt
    proj.y += proj.vy * dt

    let dead = false
    const ttl = (ctx.projectileTtl.get(proj.id) ?? 1) - 1
    ctx.projectileTtl.set(proj.id, ttl)
    if (ttl <= 0) {
      dead = true
    } else if (
      proj.x < 0 ||
      proj.x > ARENA_WIDTH ||
      proj.y < 0 ||
      proj.y > ARENA_HEIGHT ||
      insideObstacle(proj.x, proj.y, PROJECTILE_RADIUS)
    ) {
      dead = true
    } else if (state.phase === 'play') {
      dead = checkHits(ctx, state, proj, prevX, prevY)
    }

    if (dead) {
      ctx.projectileTtl.delete(proj.id)
      state.projectiles.splice(i, 1)
    }
  }
}

/** Treffer gegen Rewind-Positionen (100 ms Lag-Compensation). */
function checkHits(
  ctx: SimContext,
  state: ArenaState,
  proj: { x: number; y: number; owner: string },
  prevX: number,
  prevY: number,
): boolean {
  for (const [id, player] of state.players) {
    if (id === proj.owner || !player.alive) continue
    const timers = ctx.timers.get(id)
    if (timers && ctx.tick < timers.protectedUntil) continue
    const hist = ctx.histories.get(id)
    const rewound = hist && hist.length > REWIND_TICKS ? hist[hist.length - 1 - REWIND_TICKS]! : player
    if (
      segmentHitsCircle(prevX, prevY, proj.x, proj.y, rewound.x, rewound.y, PLAYER_RADIUS + PROJECTILE_RADIUS)
    ) {
      damage(ctx, state, id, proj.owner)
      return true
    }
  }
  return false
}

function damage(ctx: SimContext, state: ArenaState, victimId: string, killerId: string): void {
  const victim = state.players.get(victimId)
  if (!victim || !victim.alive) return
  let rest = PROJECTILE_DAMAGE
  if (victim.shield > 0) {
    const absorbed = Math.min(victim.shield, rest)
    victim.shield -= absorbed
    rest -= absorbed
  }
  victim.hp -= rest
  if (victim.hp > 0) return
  victim.hp = 0
  victim.alive = false
  victim.deaths += 1
  const killer = state.players.get(killerId)
  if (killer) {
    killer.kills += 1
    killer.score += KILL_SCORE
  }
  const timers = ctx.timers.get(victimId)
  if (timers) timers.respawnAt = ctx.tick + RESPAWN_SECONDS * TICK_RATE
  ctx.events.push({ type: 'kill', by: killer?.nickname ?? '?', victim: victim.nickname })
}

function pushHistories(ctx: SimContext, state: ArenaState): void {
  for (const [id, player] of state.players) {
    if (!player.alive) continue
    let hist = ctx.histories.get(id)
    if (!hist) {
      hist = []
      ctx.histories.set(id, hist)
    }
    hist.push({ x: player.x, y: player.y })
    if (hist.length > 15) hist.shift()
  }
}

// --- Pickups (M3-07) ---

function updatePickups(ctx: SimContext, state: ArenaState): void {
  ctx.pickupTimer--
  if (ctx.pickupTimer <= 0) {
    ctx.pickupTimer = Math.ceil((PICKUP_SPAWN_INTERVAL_MS / 1000) * TICK_RATE)
    if (state.pickups.length < PICKUP_MAX_ACTIVE) {
      spawnPickup(ctx, state)
    }
  }
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const pickup = state.pickups[i]!
    let taken = false
    for (const player of state.players.values()) {
      if (!player.alive) continue
      if (Math.hypot(player.x - pickup.x, player.y - pickup.y) > PLAYER_RADIUS + PICKUP_RADIUS) continue
      if (pickup.kind === 'hp') {
        if (player.hp >= PLAYER_HP) continue
        player.hp = Math.min(PLAYER_HP, player.hp + PICKUP_HP_AMOUNT)
      } else {
        if (player.shield >= SHIELD_MAX) continue
        player.shield = Math.min(SHIELD_MAX, player.shield + PICKUP_SHIELD_AMOUNT)
      }
      taken = true
      break
    }
    if (taken) state.pickups.splice(i, 1)
  }
}

function spawnPickup(ctx: SimContext, state: ArenaState): void {
  const alive = [...state.players.values()].filter((p) => p.alive)
  for (let i = 0; i < 10; i++) {
    const x = PICKUP_RADIUS + Math.random() * (ARENA_WIDTH - 2 * PICKUP_RADIUS)
    const y = PICKUP_RADIUS + Math.random() * (ARENA_HEIGHT - 2 * PICKUP_RADIUS)
    if (insideObstacle(x, y, PICKUP_RADIUS)) continue
    if (alive.some((p) => Math.hypot(p.x - x, p.y - y) < PLAYER_RADIUS + PICKUP_RADIUS)) continue
    const pickup = new Pickup()
    pickup.id = `u${ctx.nextPickupId++}`
    const kind: PickupKind = Math.random() < 0.5 ? 'hp' : 'shield'
    pickup.kind = kind
    pickup.x = x
    pickup.y = y
    state.pickups.push(pickup)
    return
  }
}

// --- Bots (M3-06): Seek+Shoot-AI, Raum fuellt auf FILL_MIN auf ---

function humanCount(state: ArenaState): number {
  let n = 0
  for (const p of state.players.values()) if (!p.isBot) n++
  return n
}

function maintainBots(ctx: SimContext, state: ArenaState): void {
  const humans = humanCount(state)
  // Leere Raeume bleiben leer (sonst greift maxIdle-Dispose nie).
  const desired =
    humans === 0 || !ctx.botsEnabled
      ? 0
      : Math.min(MAX_BOTS_PER_ROOM, Math.max(0, FILL_MIN_PLAYERS - humans))
  // Überschüssige Bots entfernen.
  while (ctx.botIds.size > desired) {
    const id = ctx.botIds.values().next().value as string | undefined
    if (!id) break
    removePlayer(ctx, state, id)
  }
  // Auffüllen.
  let guard = MAX_BOTS_PER_ROOM
  while (ctx.botIds.size < desired && guard-- > 0) {
    const id = `bot-${ctx.nextBotNum}`
    const bot = new Player()
    bot.nickname = `Bot-${ctx.nextBotNum++}`
    bot.isBot = true
    const alive = [...state.players.values()].filter((p) => p.alive)
    const spawn = findSpawn(alive)
    bot.x = spawn.x
    bot.y = spawn.y
    state.players.set(id, bot)
    initPlayer(ctx, id, spawn)
    ctx.botIds.add(id)
  }
}

function thinkBots(ctx: SimContext, state: ArenaState): void {
  if (ctx.tick % BOT_THINK_TICKS !== 0) return
  for (const id of ctx.botIds) {
    const bot = state.players.get(id)
    if (!bot?.alive) continue
    let nearest: Player | null = null
    let nearestDist = Infinity
    for (const [otherId, other] of state.players) {
      if (otherId === id || !other.alive) continue
      const d = Math.hypot(other.x - bot.x, other.y - bot.y)
      if (d < nearestDist) {
        nearestDist = d
        nearest = other
      }
    }
    if (!nearest) {
      ctx.inputs.set(id, { kind: 'input', seq: ctx.tick, dx: 0, dy: 0, aim: 0, fire: false })
      continue
    }
    const aim = Math.atan2(nearest.y - bot.y, nearest.x - bot.x)
    let mx = 0
    let my = 0
    if (nearestDist > BOT_PREFERRED_RANGE + 40) {
      mx = Math.cos(aim) * 0.8
      my = Math.sin(aim) * 0.8
    } else if (nearestDist < BOT_PREFERRED_RANGE - 40) {
      mx = -Math.cos(aim) * 0.8
      my = -Math.sin(aim) * 0.8
    }
    const fire = nearestDist < BOT_FIRE_RANGE && lineOfSight(bot, nearest)
    ctx.inputs.set(id, { kind: 'input', seq: ctx.tick, dx: mx, dy: my, aim, fire })
    bot.ackSeq = ctx.tick
  }
}

function lineOfSight(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  for (const t of [0.25, 0.5, 0.75]) {
    const x = a.x + (b.x - a.x) * t
    const y = a.y + (b.y - a.y) * t
    if (insideObstacle(x, y, 0)) return false
  }
  return true
}
