import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  FIRE_INTERVAL_MS,
  OBSTACLES,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PROJECTILE_DAMAGE,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  PROJECTILE_TTL_MS,
  RESPAWN_SECONDS,
  REWIND_TICKS,
  SPAWN_PROTECTION_SECONDS,
  TICK_RATE,
  resolveArena,
  resolveCircle,
  resolveRect,
  segmentHitsCircle,
  type ValidatedInput,
} from '@neon-arena/shared'
import { ArenaState, Player, Projectile } from './state.js'

export interface PlayerTimers {
  respawnAt: number
  protectedUntil: number
  lastFireTick: number
}

export interface SimContext {
  tick: number
  /** Letzter Input pro Spieler (wird jeden Tick angewendet). */
  inputs: Map<string, ValidatedInput>
  /** Positions-Historie pro Spieler (neueste zuletzt, fuer Server-Rewind). */
  histories: Map<string, { x: number; y: number }[]>
  timers: Map<string, PlayerTimers>
  projectileTtl: Map<string, number>
  nextProjectileId: number
}

export function createContext(): SimContext {
  return {
    tick: 0,
    inputs: new Map(),
    histories: new Map(),
    timers: new Map(),
    projectileTtl: new Map(),
    nextProjectileId: 1,
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

export function removePlayer(ctx: SimContext, sessionId: string): void {
  ctx.inputs.delete(sessionId)
  ctx.histories.delete(sessionId)
  ctx.timers.delete(sessionId)
}

/** Zufaelliger Spawn ohne Overlap mit lebenden Spielern. */
export function findSpawn(others: Player[]): { x: number; y: number } {
  for (let i = 0; i < 10; i++) {
    const x = PLAYER_RADIUS + Math.random() * (ARENA_WIDTH - 2 * PLAYER_RADIUS)
    const y = PLAYER_RADIUS + Math.random() * (ARENA_HEIGHT - 2 * PLAYER_RADIUS)
    const overlap = others.some((p) => Math.hypot(p.x - x, p.y - y) < 2 * PLAYER_RADIUS)
    if (!overlap) return { x, y }
  }
  return {
    x: PLAYER_RADIUS + Math.random() * (ARENA_WIDTH - 2 * PLAYER_RADIUS),
    y: PLAYER_RADIUS + Math.random() * (ARENA_HEIGHT - 2 * PLAYER_RADIUS),
  }
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

/** Ein 30-Hz-Tick: Respawns, Bewegung, Kollision, Feuer, Projektile, Historie. */
export function update(ctx: SimContext, state: ArenaState): void {
  ctx.tick++
  const dt = 1 / TICK_RATE
  const step = PLAYER_SPEED * dt

  handleRespawns(ctx, state)
  movePlayers(ctx, state, step, dt)
  resolvePlayerCollisions(state)
  fireWeapons(ctx, state)
  updateProjectiles(ctx, state, dt)
  pushHistories(ctx, state)
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
    player.hp = 100
    player.alive = true
    timers.protectedUntil = ctx.tick + SPAWN_PROTECTION_SECONDS * TICK_RATE
    ctx.histories.set(id, [{ x: spawn.x, y: spawn.y }])
  }
}

function movePlayers(ctx: SimContext, state: ArenaState, step: number, _dt: number): void {
  void _dt
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
      hitsObstacle(proj.x, proj.y)
    ) {
      dead = true
    } else {
      dead = checkHits(ctx, state, proj, prevX, prevY)
    }

    if (dead) {
      ctx.projectileTtl.delete(proj.id)
      state.projectiles.splice(i, 1)
    }
  }
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

function hitsObstacle(x: number, y: number): boolean {
  return OBSTACLES.some(
    (o) =>
      x > o.x - PROJECTILE_RADIUS &&
      x < o.x + o.w + PROJECTILE_RADIUS &&
      y > o.y - PROJECTILE_RADIUS &&
      y < o.y + o.h + PROJECTILE_RADIUS,
  )
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
  victim.hp -= PROJECTILE_DAMAGE
  if (victim.hp > 0) return
  victim.hp = 0
  victim.alive = false
  victim.deaths += 1
  const killer = state.players.get(killerId)
  if (killer) killer.kills += 1
  const timers = ctx.timers.get(victimId)
  if (timers) timers.respawnAt = ctx.tick + RESPAWN_SECONDS * TICK_RATE
}
