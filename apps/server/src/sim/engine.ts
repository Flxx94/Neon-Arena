import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BOT_FIRE_RANGE,
  BOT_PREFERRED_RANGE,
  BOT_THINK_TICKS,
  FILL_MIN_PLAYERS,
  KILL_SCORE,
  MAX_BOTS_PER_ROOM,
  mapOf,
  nextMapId,
  PICKUP_HP_AMOUNT,
  PICKUP_MAX_ACTIVE,
  PICKUP_RADIUS,
  PICKUP_SHIELD_AMOUNT,
  PICKUP_SPAWN_INTERVAL_MS,
  PLAYER_RADIUS,
  RESPAWN_SECONDS,
  REWIND_TICKS,
  ROUND_END_SECONDS,
  ROUND_SECONDS,
  MAP_COUNT,
  SHIELD_MAX,
  SKIN_COUNT,
  CLASSES,
  AUTOAIM_CONE,
  AUTOAIM_PULL,
  AUTOAIM_RANGE,
  ONE_SHOT,
  ULT_DEATH_LOSS,
  ULT_MAX,
  ULT_PASSIVE_TICKS,
  ULT_PER_DAMAGE_DEALT,
  ULT_PER_DAMAGE_TAKEN,
  ULT_PER_KILL,
  classOf,
  effectiveSpeed,
  isFlying,
  ultTargetScore,
  classRange,
  skinModel,
  SPAWN_PROTECTION_SECONDS,
  SURVIVAL_BONUS,
  TICK_RATE,
  resolveArena,
  resolveCircle,
  resolveRect,
  stepPlayer,
  stepRocket,
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
  /** Aktuell wirksamer Input pro Spieler (zuletzt verbrauchter bzw. Bot-Input). */
  inputs: Map<string, ValidatedInput>
  /** Wartende Client-Inputs pro Spieler: pro Tick wird genau EIN Input verbraucht (= 1 Client-Schritt). */
  inputQueue: Map<string, ValidatedInput[]>
  /** Spieler ohne frischen Input in diesem Tick: bewegen sich nicht (kein ungeplanter Extra-Schritt). */
  stalled: Set<string>
  /** Positions-Historie pro Spieler (neueste zuletzt, fuer Server-Rewind). */
  histories: Map<string, { x: number; y: number }[]>
  timers: Map<string, PlayerTimers>
  projectileTtl: Map<string, number>
  nextProjectileId: number
  nextPickupId: number
  nextBotNum: number
  roundTicksLeft: number
  /** Volle Rundenlaenge (fuer Reset; Tests via ROUND_SECONDS_OVERRIDE kuerzbar). */
  roundTotal: number
  endTicksLeft: number
  pickupTimer: number
  botIds: Set<string>
  botsEnabled: boolean
  /** Events seit letztem Drain (Room broadcastet sie). */
  events: SimEvent[]
  /** Spieler mit Ult-Wunsch in diesem Tick (idempotent; Server prueft Ladung). */
  ultReq: Map<string, { ua: number; ud: number }>
  /** Aktive Geisterwelten: Boo-Id -> Ziel-Id. */
  ghostTarget: Map<string, string>
  nextRealm: number
}

export function createContext(botsEnabled = true): SimContext {
  return {
    tick: 0,
    inputs: new Map(),
    inputQueue: new Map(),
    stalled: new Set(),
    histories: new Map(),
    timers: new Map(),
    projectileTtl: new Map(),
    nextProjectileId: 1,
    nextPickupId: 1,
    nextBotNum: 1,
    roundTicksLeft: ROUND_SECONDS * TICK_RATE,
    roundTotal: ROUND_SECONDS * TICK_RATE,
    endTicksLeft: 0,
    pickupTimer: Math.ceil((PICKUP_SPAWN_INTERVAL_MS / 1000) * TICK_RATE),
    botIds: new Set(),
    botsEnabled,
    events: [],
    ultReq: new Map(),
    ghostTarget: new Map(),
    nextRealm: 1,
  }
}

export function initPlayer(
  ctx: SimContext,
  sessionId: string,
  pos: { x: number; y: number },
): void {
  ctx.histories.set(sessionId, [{ ...pos }])
  ctx.timers.set(sessionId, {
    respawnAt: -1,
    protectedUntil: ctx.tick + SPAWN_PROTECTION_SECONDS * TICK_RATE,
    lastFireTick: -10_000,
  })
}

export function removePlayer(ctx: SimContext, state: ArenaState, sessionId: string): void {
  endRealmsOf(ctx, state, sessionId)
  ctx.ultReq.delete(sessionId)
  ctx.inputs.delete(sessionId)
  ctx.inputQueue.delete(sessionId)
  ctx.stalled.delete(sessionId)
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
export function findSpawn(others: Player[], mapId = 0): { x: number; y: number } {
  const map = mapOf(mapId)
  for (let i = 0; i < 20; i++) {
    const x = PLAYER_RADIUS + Math.random() * (ARENA_WIDTH - 2 * PLAYER_RADIUS)
    const y = PLAYER_RADIUS + Math.random() * (ARENA_HEIGHT - 2 * PLAYER_RADIUS)
    if (insideObstacle(map, x, y, PLAYER_RADIUS)) continue
    const overlap = others.some((p) => Math.hypot(p.x - x, p.y - y) < 2 * PLAYER_RADIUS)
    if (!overlap) return { x, y }
  }
  return { x: ARENA_WIDTH / 2, y: 100 }
}

function insideObstacle(map: ReturnType<typeof mapOf>, x: number, y: number, margin: number): boolean {
  return map.obstacles.some(
    (o) => x > o.x - margin && x < o.x + o.w + margin && y > o.y - margin && y < o.y + o.h + margin,
  )
}

/** Maximal gepufferte Inputs pro Spieler (~200 ms); aeltere werden verworfen (Client repliziert den Rest). */
const MAX_QUEUED_INPUTS = 6

/** Validierten Input einreihen; pro Tick wird einer angewendet (inkl. ackSeq). */
export function applyInput(
  ctx: SimContext,
  state: ArenaState,
  sessionId: string,
  input: ValidatedInput,
): void {
  const player = state.players.get(sessionId)
  if (!player) return
  let queue = ctx.inputQueue.get(sessionId)
  if (!queue) {
    queue = []
    ctx.inputQueue.set(sessionId, queue)
  }
  queue.push(input)
  if (queue.length > MAX_QUEUED_INPUTS) queue.shift()
  player.aim = quantizeAim(input.aim)
}

/**
 * Pro Tick genau einen wartenden Input je Spieler verbrauchen. Ohne frischen Input bleibt der
 * Spieler stehen ("stalled"): ein spaeter eintreffender Input zaehlt dann trotzdem nur einen Schritt,
 * Server und Client-Prediction bleiben in Phase (kein Rubber-Banding bei Netz-Jitter).
 */
function consumeInputs(ctx: SimContext, state: ArenaState): void {
  ctx.stalled.clear()
  for (const [id, queue] of ctx.inputQueue) {
    const player = state.players.get(id)
    if (!player) continue
    const next = queue.shift()
    if (next) {
      ctx.inputs.set(id, next)
      player.ackSeq = next.seq
      if (next.ult) ctx.ultReq.set(id, { ua: next.ua ?? next.aim, ud: next.ud ?? 0.6 })
    } else if (ctx.inputs.has(id)) {
      ctx.stalled.add(id)
    }
  }
}

/** Aim fuer den State gerundet (0.05 rad ~ 3 Grad): weniger Delta-Traffic, optisch identisch. */
function quantizeAim(aim: number): number {
  return Math.round(aim * 20) / 20
}

/** Ein 30-Hz-Tick: Runde, Respawns, Bewegung, Kollision, Feuer, Projektile, Pickups, Bots. */
export function update(ctx: SimContext, state: ArenaState): void {
  ctx.tick++
  const dt = 1 / TICK_RATE

  consumeInputs(ctx, state)
  updateRound(ctx, state)
  if (state.phase === 'play') {
    handleRespawns(ctx, state)
    thinkBots(ctx, state)
    maintainBots(ctx, state)
    tickStatus(ctx, state)
    handleUlts(ctx, state)
    movePlayers(ctx, state)
    updateRockets(ctx, state)
    resolvePlayerCollisions(state)
    fireWeapons(ctx, state)
    updateProjectiles(ctx, state, dt)
    updatePickups(ctx, state)
  } else {
    // End-Screen: weiterlaufen lassen, aber kein Schaden, keine neuen Pickups.
    movePlayers(ctx, state)
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

function startRound(ctx: SimContext, state: ArenaState, mapId?: number): void {
  state.projectiles.splice(0, state.projectiles.length)
  // Neue Runde = neue Karte (Rotation); Pickups der alten Karte liegen evtl. in Hindernissen der neuen.
  state.map = mapId ?? nextMapId(state.map)
  state.pickups.splice(0, state.pickups.length)
  const placed: Player[] = []
  for (const player of state.players.values()) {
    const spawn = findSpawn(placed, state.map)
    player.x = spawn.x
    player.y = spawn.y
    player.hp = classOf(player.skin).hp
    player.boost = 0
    player.shield = 0
    player.ult = 0
    player.ultTicks = 0
    player.stun = 0
    player.disarm = 0
    player.slow = 0
    player.hidden = 0
    player.realm = 0
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
  ctx.ghostTarget.clear()
  ctx.ultReq.clear()
  state.phase = 'play'
  state.winner = ''
  ctx.roundTicksLeft = ctx.roundTotal
  ctx.events.push({ type: 'roundStart' })
}

function handleRespawns(ctx: SimContext, state: ArenaState): void {
  for (const [id, player] of state.players) {
    if (player.alive) continue
    const timers = ctx.timers.get(id)
    if (!timers || ctx.tick < timers.respawnAt) continue
    const alive = [...state.players.values()].filter((p) => p.alive)
    const spawn = findSpawn(alive, state.map)
    player.x = spawn.x
    player.y = spawn.y
    player.hp = classOf(player.skin).hp
    player.boost = 0
    player.shield = 0
    player.alive = true
    timers.protectedUntil = ctx.tick + SPAWN_PROTECTION_SECONDS * TICK_RATE
    ctx.histories.set(id, [{ x: spawn.x, y: spawn.y }])
  }
}

function movePlayers(ctx: SimContext, state: ArenaState): void {
  const map = mapOf(state.map)
  for (const [id, player] of state.players) {
    if (!player.alive) continue
    const cls = classOf(player.skin)
    const input = ctx.inputs.get(id)
    // Rakete (Blobby-Ult): fliegt dauerhaft in `ultAim`, Eingabe lenkt; ignoriert Hindernisse und Betaeubung.
    if (isFlying(cls, player.ultTicks)) {
      flyRocket(player, effectiveSpeed(cls, player.ultTicks, 0), input?.dx ?? 0, input?.dy ?? 0)
      continue
    }
    if (player.hidden > 0) continue
    if (!input || ctx.stalled.has(id)) continue
    // Betaeubt: keine Bewegung (Client-Prediction spiegelt das ueber stun).
    if (player.stun > 0) continue
    // Gleiche Schrittfunktion wie die Client-Prediction (shared/physics): Boost inklusive.
    player.boost = stepPlayer(
      player,
      player.boost,
      input.dx,
      input.dy,
      effectiveSpeed(cls, player.ultTicks, player.slow),
      map.obstacles,
      map.boostPads,
    )
  }
}

function flyRocket(player: Player, speed: number, dx: number, dy: number): void {
  player.ultAim = stepRocket(player, player.ultAim, dx, dy, speed)
}

function resolvePlayerCollisions(state: ArenaState): void {
  const alive = [...state.players.entries()].filter(([, p]) => p.alive)
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const [, a] = alive[i]!
      const [, b] = alive[j]!
      if (a.realm !== b.realm) continue
      if (untouchable(a) || untouchable(b)) continue
      if (resolveCircle(a, PLAYER_RADIUS, b, PLAYER_RADIUS)) {
        resolveArena(a, PLAYER_RADIUS)
        resolveArena(b, PLAYER_RADIUS)
      }
    }
  }
}

/** Neues Projektil der Klasse von `owner` an Position (x,y) in Richtung `angle` erzeugen. */
function spawnProjectile(
  ctx: SimContext,
  state: ArenaState,
  ownerId: string,
  player: Player,
  x: number,
  y: number,
  angle: number,
  ttlTicks: number,
): void {
  const cls = classOf(player.skin)
  const proj = new Projectile()
  proj.id = `p${ctx.nextProjectileId++}`
  proj.owner = ownerId
  proj.kind = skinModel(player.skin)
  proj.x = x
  proj.y = y
  proj.vx = Math.cos(angle) * cls.projectileSpeed
  proj.vy = Math.sin(angle) * cls.projectileSpeed
  state.projectiles.push(proj)
  ctx.projectileTtl.set(proj.id, ttlTicks)
}

/** Zappy-Ult: leichte Zielhilfe, dreht den Schuss zum besten Gegner im Kegel (Mensch bleibt in Kontrolle). */
function autoAim(state: ArenaState, id: string, p: Player, aim: number): number {
  let bestDiff = 0
  let bestAbs = AUTOAIM_CONE
  let bestDist = AUTOAIM_RANGE
  for (const [oid, o] of state.players) {
    if (oid === id || !o.alive || o.realm !== p.realm) continue
    const dx = o.x - p.x
    const dy = o.y - p.y
    const dist = Math.hypot(dx, dy)
    if (dist > AUTOAIM_RANGE || dist < 1) continue
    let diff = Math.atan2(dy, dx) - aim
    while (diff > Math.PI) diff -= 2 * Math.PI
    while (diff < -Math.PI) diff += 2 * Math.PI
    if (Math.abs(diff) < bestAbs || (Math.abs(diff) < AUTOAIM_CONE && dist < bestDist * 0.5)) {
      bestAbs = Math.abs(diff)
      bestDiff = diff
      bestDist = dist
    }
  }
  return aim + bestDiff * AUTOAIM_PULL
}

function fireWeapons(ctx: SimContext, state: ArenaState): void {
  for (const [id, player] of state.players) {
    if (!player.alive) continue
    const input = ctx.inputs.get(id)
    const timers = ctx.timers.get(id)
    if (!input?.fire || !timers) continue
    // Charakter-Waffe (shared/classes): Abklingzeit, Tempo, Radius, Reichweite je Klasse.
    const cls = classOf(player.skin)
    if (player.stun > 0) continue // betaeubt: kein Schuss
    if (untouchable(player)) continue // Rakete/Explosions-Wartezeit schiesst nicht
    if (player.disarm > 0) continue // Geisterwelt-Ziel: entwaffnet (bewegen ja, schiessen nein)
    // Fire-Rate serverseitig erzwungen (M2-03): zu fruehe Schuesse verfallen.
    if (ctx.tick - timers.lastFireTick < cls.cooldownTicks) continue
    timers.lastFireTick = ctx.tick
    const aim =
      cls.ult.kind === 'field' && player.ultTicks > 0
        ? autoAim(state, id, player, input.aim)
        : input.aim
    const offset = PLAYER_RADIUS + cls.projectileRadius + 1
    spawnProjectile(
      ctx,
      state,
      id,
      player,
      player.x + Math.cos(aim) * offset,
      player.y + Math.sin(aim) * offset,
      aim,
      cls.ttlTicks,
    )
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
      insideObstacle(mapOf(state.map), proj.x, proj.y, (CLASSES[proj.kind] ?? CLASSES[0]!).projectileRadius)
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
  proj: { x: number; y: number; vx: number; vy: number; kind: number; owner: string },
  prevX: number,
  prevY: number,
): boolean {
  const cls = CLASSES[proj.kind] ?? CLASSES[0]!
  const ownerRealm = state.players.get(proj.owner)?.realm ?? 0
  const radius = PLAYER_RADIUS + cls.projectileRadius
  for (const [id, player] of state.players) {
    if (id === proj.owner || !player.alive) continue
    if (player.realm !== ownerRealm) continue // Geisterwelt: nur Spieler derselben Welt treffen sich
    if (untouchable(player)) continue // Rakete ist unverwundbar
    const timers = ctx.timers.get(id)
    if (timers && ctx.tick < timers.protectedUntil) continue
    const hist = ctx.histories.get(id)
    const rewound =
      hist && hist.length > REWIND_TICKS ? hist[hist.length - 1 - REWIND_TICKS]! : player
    if (
      segmentHitsCircle(
        prevX,
        prevY,
        proj.x,
        proj.y,
        rewound.x,
        rewound.y,
        radius,
      )
    ) {
      let amount = cls.damage
      // Rueckenschaden (Kitty): Ziel schaut ungefaehr in Flugrichtung = vom Schuetzen weg (cos > 0.5, +-60 Grad).
      if (cls.backstab > 1) {
        const speed = Math.hypot(proj.vx, proj.vy) || 1
        if ((proj.vx * Math.cos(player.aim) + proj.vy * Math.sin(player.aim)) / speed > 0.5) {
          amount *= cls.backstab
        }
      }
      damage(ctx, state, id, proj.owner, amount, cls.lifesteal)
      return true
    }
  }
  return false
}

function damage(
  ctx: SimContext,
  state: ArenaState,
  victimId: string,
  killerId: string,
  amount: number,
  lifesteal = 0,
  charge = true,
): void {
  const victim = state.players.get(victimId)
  if (!victim || !victim.alive) return
  if (untouchable(victim)) return // Rakete: unverwundbar
  let rest = amount
  const dealt = rest
  if (victim.shield > 0) {
    const absorbed = Math.min(victim.shield, rest)
    victim.shield -= absorbed
    rest -= absorbed
  }
  victim.hp -= rest
  // Ult-Aufladung: Schaden austeilen und einstecken laedt (gedeckelt auf ULT_MAX).
  if (charge) {
    chargeUlt(state.players.get(killerId), Math.min(dealt, 100) * ULT_PER_DAMAGE_DEALT)
    chargeUlt(victim, Math.min(dealt, 100) * ULT_PER_DAMAGE_TAKEN)
  }
  // Lifesteal (Boo): Anteil des verursachten Schadens, begrenzt auf die eigenen Max-Lebenspunkte.
  if (lifesteal > 0) {
    const healer = state.players.get(killerId)
    if (healer?.alive) {
      healer.hp = Math.min(classOf(healer.skin).hp, healer.hp + amount * lifesteal)
    }
  }
  if (victim.hp > 0) return
  victim.hp = 0
  victim.alive = false
  victim.deaths += 1
  // Tod: Ult-Ladung teilweise verloren, eine volle Leiste bleibt voll; Effekte enden.
  if (victim.ult < ULT_MAX) victim.ult = Math.floor(victim.ult * (1 - ULT_DEATH_LOSS))
  endRealmsOf(ctx, state, victimId)
  victim.ultTicks = 0
  victim.stun = 0
  victim.disarm = 0
  victim.slow = 0
  victim.hidden = 0
  const killer = state.players.get(killerId)
  if (killer) {
    killer.kills += 1
    killer.score += KILL_SCORE
    if (charge) chargeUlt(killer, ULT_PER_KILL)
  }
  const timers = ctx.timers.get(victimId)
  if (timers) timers.respawnAt = ctx.tick + RESPAWN_SECONDS * TICK_RATE
  ctx.events.push({ type: 'kill', by: killer?.nickname ?? '?', victim: victim.nickname })
}

/** Ult-Ladung erhoehen (gedeckelt). */
function chargeUlt(player: Player | undefined, amount: number): void {
  if (!player || !player.alive || amount <= 0) return
  player.ult = Math.min(ULT_MAX, Math.round(player.ult + amount))
}

/** Pro Tick: Status-Zaehler herunterzaehlen, Ult-Effekte (Feld, Einschlag, Rakete), passive Aufladung. */
function tickStatus(ctx: SimContext, state: ArenaState): void {
  const passive = ctx.tick % ULT_PASSIVE_TICKS === 0
  for (const [id, player] of state.players) {
    if (!player.alive) continue
    if (player.stun > 0) player.stun--
    if (player.disarm > 0) player.disarm--
    if (player.slow > 0) player.slow--
    if (player.hidden > 0) {
      player.hidden--
      if (player.hidden === 0) respawnAfterRocket(ctx, state, id, player)
    }
    if (player.ultTicks > 0) {
      const def = classOf(player.skin).ult
      if (def.kind === 'field') applyField(ctx, state, id, player, def)
      player.ultTicks--
      if (player.ultTicks === 0) {
        if (def.kind === 'ghost') endRealmsOf(ctx, state, id)
        else if (def.kind === 'slam') resolveSlam(ctx, state, id, player, def)
        else if (def.kind === 'rocket') explodeRocket(ctx, state, id)
      }
    }
    if (passive) chargeUlt(player, 1)
  }
}

/** Wartezeit (Ticks) zwischen Raketen-Explosion und Respawn: die Explosion soll sichtbar sein. */
const ROCKET_HIDE_TICKS = Math.ceil(0.9 * TICK_RATE)

/** Rakete im Flug oder wartende Blobby nach der Explosion: kein Treffer, keine Kollision, kein Schuss. */
const untouchable = (p: Player): boolean => p.hidden > 0 || isFlying(classOf(p.skin), p.ultTicks)

const isProtected = (ctx: SimContext, id: string): boolean =>
  ctx.tick < (ctx.timers.get(id)?.protectedUntil ?? -1)

/** Elektrofeld (Zappy): Gegner im Radius verlangsamen + Tick-Schaden (keine Ult-Aufladung dadurch). */
function applyField(
  ctx: SimContext,
  state: ArenaState,
  id: string,
  p: Player,
  def: ReturnType<typeof classOf>['ult'],
): void {
  const dmgTick = ctx.tick % def.tickEvery === 0
  for (const [oid, o] of state.players) {
    if (oid === id || !o.alive || o.realm !== p.realm || isProtected(ctx, oid)) continue
    if (Math.hypot(o.x - p.x, o.y - p.y) > def.radius) continue
    o.slow = Math.max(o.slow, 3)
    if (dmgTick) damage(ctx, state, oid, id, def.tickDamage, 0, false)
  }
}

/** Riesenwuerfel (Cuby) schlaegt ein: One-Shot im Einschlagradius, Schockwelle stoesst Nahe zurueck. */
function resolveSlam(
  ctx: SimContext,
  state: ArenaState,
  id: string,
  p: Player,
  def: ReturnType<typeof classOf>['ult'],
): void {
  const tx = p.ultX
  const ty = p.ultY
  for (const [oid, o] of state.players) {
    if (oid === id || !o.alive || o.realm !== p.realm || isProtected(ctx, oid)) continue
    if (untouchable(o)) continue
    const dx = o.x - tx
    const dy = o.y - ty
    const d = Math.hypot(dx, dy)
    if (d <= def.radius + PLAYER_RADIUS) {
      damage(ctx, state, oid, id, ONE_SHOT, 0, false)
    } else if (d <= def.shockRadius) {
      const k = def.knockback * (1 - (d / def.shockRadius) * 0.6)
      const nx = d > 1e-6 ? dx / d : 1
      const ny = d > 1e-6 ? dy / d : 0
      o.x += nx * k
      o.y += ny * k
      resolveArena(o, PLAYER_RADIUS)
      for (const r of mapOf(state.map).obstacles) resolveRect(o, PLAYER_RADIUS, r)
    }
  }
}

/** Raketen-Explosion (Blobby): One-Shot im Umkreis, Kugelsalve in alle Richtungen, Blobby landet woanders. */
function explodeRocket(ctx: SimContext, state: ArenaState, id: string): void {
  const p = state.players.get(id)
  if (!p) return
  const cls = classOf(p.skin)
  const def = cls.ult
  p.ultTicks = 0
  for (const [oid, o] of state.players) {
    if (oid === id || !o.alive || o.realm !== p.realm || isProtected(ctx, oid)) continue
    if (untouchable(o)) continue
    if (Math.hypot(o.x - p.x, o.y - p.y) <= def.radius + PLAYER_RADIUS) {
      damage(ctx, state, oid, id, ONE_SHOT, 0, false)
    }
  }
  const ttl = Math.ceil(0.7 * TICK_RATE)
  for (let i = 0; i < def.salvo; i++) {
    const a = (i / def.salvo) * 2 * Math.PI
    spawnProjectile(ctx, state, id, p, p.x, p.y, a, ttl)
  }
  // Blobby bleibt kurz unsichtbar/unverwundbar am Explosionsort (Client zeigt die Explosion), dann Respawn.
  p.hidden = ROCKET_HIDE_TICKS
  p.boost = 0
}

/** Nach der Explosion: Blobby taucht an einem anderen Punkt der Map auf (kurzer Spawn-Schutz). */
function respawnAfterRocket(ctx: SimContext, state: ArenaState, id: string, p: Player): void {
  const others = [...state.players.values()].filter((o) => o !== p && o.alive)
  const spawn = findSpawn(others, state.map)
  p.x = spawn.x
  p.y = spawn.y
  const timers = ctx.timers.get(id)
  if (timers) timers.protectedUntil = ctx.tick + Math.ceil(1.5 * TICK_RATE)
  ctx.histories.set(id, [{ x: p.x, y: p.y }])
}

/** Geisterwelt beenden, an der `id` als Boo oder Ziel beteiligt ist. */
function endRealmsOf(ctx: SimContext, state: ArenaState, id: string): void {
  for (const [booId, targetId] of ctx.ghostTarget) {
    if (booId !== id && targetId !== id) continue
    const boo = state.players.get(booId)
    const target = state.players.get(targetId)
    if (boo) {
      boo.realm = 0
      boo.ultTicks = 0
    }
    if (target) {
      target.realm = 0
      target.disarm = 0
    }
    ctx.ghostTarget.delete(booId)
  }
}

/** Platziert `p` direkt neben `target` (auf der Seite, von der `p` kommt), ohne in Waenden zu landen. */
function placeNextTo(state: ArenaState, p: Player, target: Player): void {
  let dx = p.x - target.x
  let dy = p.y - target.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) {
    dx = 1
    dy = 0
  } else {
    dx /= len
    dy /= len
  }
  const gap = 2 * PLAYER_RADIUS + 6
  p.x = target.x + dx * gap
  p.y = target.y + dy * gap
  resolveArena(p, PLAYER_RADIUS)
  for (const o of mapOf(state.map).obstacles) resolveRect(p, PLAYER_RADIUS, o)
}

/** Rakete (Blobby): Kontakt mit einem Gegner zuendet die Explosion. */
function updateRockets(ctx: SimContext, state: ArenaState): void {
  for (const [id, p] of state.players) {
    if (!p.alive) continue
    const cls = classOf(p.skin)
    if (!isFlying(cls, p.ultTicks)) continue
    for (const [oid, o] of state.players) {
      if (oid === id || !o.alive || o.realm !== p.realm) continue
      if (untouchable(o)) continue
      if (Math.hypot(o.x - p.x, o.y - p.y) <= cls.ult.width + PLAYER_RADIUS) {
        explodeRocket(ctx, state, id)
        break
      }
    }
  }
}

/** Strahl (Hexo): sofortiger Treffer-Scan entlang der Bahn ueber die ganze Map, ignoriert Hindernisse. */
function castBeam(
  ctx: SimContext,
  state: ArenaState,
  id: string,
  caster: Player,
  def: ReturnType<typeof classOf>['ult'],
  angle: number,
): void {
  const ex = caster.x + Math.cos(angle) * def.range
  const ey = caster.y + Math.sin(angle) * def.range
  const r = PLAYER_RADIUS + def.width / 2
  for (const [oid, o] of state.players) {
    if (oid === id || !o.alive || o.realm !== caster.realm || isProtected(ctx, oid)) continue
    if (untouchable(o)) continue
    if (segmentHitsCircle(caster.x, caster.y, ex, ey, o.x, o.y, r)) {
      damage(ctx, state, oid, id, ONE_SHOT, 0, false)
    }
  }
}

/** Ult-Wuensche abarbeiten: nur bei voller Ladung, lebend, nicht betaeubt und ohne laufende Ult. */
function handleUlts(ctx: SimContext, state: ArenaState): void {
  if (ctx.ultReq.size === 0) return
  for (const [id, req] of ctx.ultReq) {
    const caster = state.players.get(id)
    if (!caster || !caster.alive || caster.ult < ULT_MAX || caster.ultTicks > 0 || caster.stun > 0)
      continue
    const def = classOf(caster.skin).ult
    if (def.kind === 'ghost' || def.kind === 'pounce') {
      // Zielauswahl entlang der Pre-Aim-Richtung (gleiche Funktion wie die Client-Markierung).
      let best: Player | null = null
      let bestId = ''
      let bestScore = Infinity
      for (const [otherId, other] of state.players) {
        if (otherId === id || !other.alive || other.realm !== 0) continue
        if (untouchable(other)) continue
        const score = ultTargetScore(caster.x, caster.y, req.ua, def.range, other.x, other.y)
        if (score < bestScore) {
          bestScore = score
          best = other
          bestId = otherId
        }
      }
      if (!best) continue // kein Ziel: Ladung bleibt, Wunsch verfaellt
      placeNextTo(state, caster, best)
      if (def.kind === 'pounce') {
        best.stun = Math.max(best.stun, def.stunTicks)
      } else {
        const realm = ctx.nextRealm
        ctx.nextRealm = ctx.nextRealm >= 255 ? 1 : ctx.nextRealm + 1
        caster.realm = realm
        best.realm = realm
        best.disarm = def.durationTicks
        caster.ultTicks = def.durationTicks
        ctx.ghostTarget.set(id, bestId)
      }
    } else if (def.kind === 'beam') {
      caster.ultAim = req.ua
      caster.ultX = caster.x
      caster.ultY = caster.y
      caster.ultTicks = def.durationTicks
      castBeam(ctx, state, id, caster, def, req.ua)
    } else if (def.kind === 'slam') {
      const dist = Math.min(def.range, Math.max(120, def.range * req.ud))
      caster.ultAim = req.ua
      caster.ultX = Math.min(ARENA_WIDTH - 40, Math.max(40, caster.x + Math.cos(req.ua) * dist))
      caster.ultY = Math.min(ARENA_HEIGHT - 40, Math.max(40, caster.y + Math.sin(req.ua) * dist))
      caster.ultTicks = def.durationTicks
    } else if (def.kind === 'rocket') {
      caster.ultAim = req.ua
      caster.stun = 0
      caster.disarm = 0
      caster.boost = 0
      caster.ultTicks = def.durationTicks
    } else {
      caster.ultTicks = def.durationTicks // field
    }
    caster.ult = 0
  }
  ctx.ultReq.clear()
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
      if (!player.alive || player.realm !== 0) continue
      if (Math.hypot(player.x - pickup.x, player.y - pickup.y) > PLAYER_RADIUS + PICKUP_RADIUS)
        continue
      if (pickup.kind === 'hp') {
        const maxHp = classOf(player.skin).hp
        if (player.hp >= maxHp) continue
        player.hp = Math.min(maxHp, player.hp + PICKUP_HP_AMOUNT)
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
    if (insideObstacle(mapOf(state.map), x, y, PICKUP_RADIUS)) continue
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
    bot.skin = Math.floor(Math.random() * SKIN_COUNT)
    const alive = [...state.players.values()].filter((p) => p.alive)
    const spawn = findSpawn(alive, state.map)
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
    // Klassenreichweite: Kurzstrecken-Bots (Assassins) muessen naeher ran, Sniper schiessen frueher.
    const reach = classRange(classOf(bot.skin))
    const aim = Math.atan2(nearest.y - bot.y, nearest.x - bot.x)
    const visible = lineOfSight(mapOf(state.map), bot, nearest)
    let mx = 0
    let my = 0
    const preferred = Math.min(BOT_PREFERRED_RANGE, reach * 0.6)
    if (nearestDist > preferred + 40) {
      mx = Math.cos(aim) * 0.8
      my = Math.sin(aim) * 0.8
    } else if (nearestDist < preferred - 40) {
      mx = -Math.cos(aim) * 0.8
      my = -Math.sin(aim) * 0.8
    }
    // UI v3 (mehr Hindernisse): quer zur Blickrichtung ausweichen. Ohne Sichtlinie kraeftig
    // (laeuft um Deckung herum statt an der Wand zu kleben), mit Sichtlinie leicht (Strafen).
    // Die Seite wechselt alle ~3 s, damit Bots nicht ewig denselben Pfeiler umkreisen.
    const side = botSide(id, ctx.tick)
    const strafe = visible ? 0.35 : 0.9
    mx += -Math.sin(aim) * side * strafe
    my += Math.cos(aim) * side * strafe
    const mag = Math.hypot(mx, my)
    if (mag > 1) {
      mx /= mag
      my /= mag
    }
    const fire = nearestDist < Math.min(BOT_FIRE_RANGE, reach * 0.9) && visible
    // Bots zuenden die Ult, sobald sie voll ist und ein Gegner in Reichweite ist.
    if (bot.ult >= ULT_MAX) {
      const udef = classOf(bot.skin).ult
      const inReach = udef.kind === 'beam' ? nearestDist < 1200 : nearestDist < 450 && visible
      if (inReach) ctx.ultReq.set(id, { ua: aim, ud: Math.min(1, nearestDist / (udef.range || 600)) })
    }
    ctx.inputs.set(id, { kind: 'input', seq: ctx.tick, dx: mx, dy: my, aim, fire })
    bot.ackSeq = ctx.tick
    bot.aim = quantizeAim(aim)
  }
}

/** Deterministisch +1/-1 pro Bot, wechselt alle 90 Ticks (3 s). */
function botSide(id: string, tick: number): 1 | -1 {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return (Math.abs(hash) + Math.floor(tick / 90)) % 2 === 0 ? 1 : -1
}

function lineOfSight(map: ReturnType<typeof mapOf>, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  for (const t of [0.25, 0.5, 0.75]) {
    const x = a.x + (b.x - a.x) * t
    const y = a.y + (b.y - a.y) * t
    if (insideObstacle(map, x, y, 0)) return false
  }
  return true
}

// --- Admin (Panel): nur ueber ArenaRoom nach ADMIN_TOKEN-Auth erreichbar ---

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(v)))

export interface AdminPlayerCmd {
  action: 'ult' | 'score' | 'kills' | 'deaths' | 'hp' | 'shield' | 'kill' | 'revive' | 'kick' | 'skin'
  target: string
  mode: 'set' | 'add'
  value: number
}

/** Wirkt `kick` nicht selbst (Room trennt die Verbindung); Rueckgabe false = Ziel/Aktion unbekannt. */
export function adminPlayer(ctx: SimContext, state: ArenaState, cmd: AdminPlayerCmd): boolean {
  const p = state.players.get(cmd.target)
  if (!p) return false
  const val = (cur: number, lo: number, hi: number): number =>
    clampInt(cmd.mode === 'add' ? cur + cmd.value : cmd.value, lo, hi)
  switch (cmd.action) {
    case 'ult':
      p.ult = val(p.ult, 0, ULT_MAX)
      return true
    case 'score':
      p.score = val(p.score, -100000, 100000)
      return true
    case 'kills':
      p.kills = val(p.kills, 0, 100000)
      return true
    case 'deaths':
      p.deaths = val(p.deaths, 0, 100000)
      return true
    case 'hp':
      if (!p.alive) return false
      p.hp = val(p.hp, 1, classOf(p.skin).hp)
      return true
    case 'shield':
      if (!p.alive) return false
      p.shield = val(p.shield, 0, SHIELD_MAX)
      return true
    case 'skin':
      p.skin = clampInt(cmd.value, 0, SKIN_COUNT - 1)
      return true
    case 'kill': {
      if (!p.alive) return false
      p.ultTicks = 0
      p.hidden = 0
      const timers = ctx.timers.get(cmd.target)
      if (timers) timers.protectedUntil = -1
      damage(ctx, state, cmd.target, '', p.hp + p.shield + 1, 0, false)
      return true
    }
    case 'revive': {
      if (p.alive) return false
      const timers = ctx.timers.get(cmd.target)
      if (timers) timers.respawnAt = ctx.tick
      return true
    }
    case 'kick':
      return true
  }
}

export interface AdminRoundCmd {
  op: 'restart' | 'end' | 'map' | 'time'
  value: number
}

export function adminRound(ctx: SimContext, state: ArenaState, cmd: AdminRoundCmd): void {
  switch (cmd.op) {
    case 'restart':
      startRound(ctx, state, state.map)
      break
    case 'map':
      startRound(ctx, state, clampInt(cmd.value, 0, MAP_COUNT - 1))
      break
    case 'end':
      if (state.phase === 'play') endRound(ctx, state)
      break
    case 'time':
      if (state.phase === 'play') {
        ctx.roundTicksLeft = Math.max(TICK_RATE, ctx.roundTicksLeft + Math.round(cmd.value) * TICK_RATE)
        state.timeLeft = Math.max(0, Math.ceil(ctx.roundTicksLeft / TICK_RATE))
      }
      break
  }
}
