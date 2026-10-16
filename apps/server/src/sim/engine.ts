import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BOT_FIRE_RANGE,
  BOT_PREFERRED_RANGE,
  BOT_THINK_TICKS,
  FILL_MIN_PLAYERS,
  KILL_SCORE,
  MAX_BOTS_PER_ROOM,
  OBSTACLES,
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
  SHIELD_MAX,
  SKIN_COUNT,
  CLASSES,
  ULT_DEATH_LOSS,
  ULT_MAX,
  ULT_PASSIVE_TICKS,
  ULT_PER_DAMAGE_DEALT,
  ULT_PER_DAMAGE_TAKEN,
  ULT_PER_KILL,
  classOf,
  effectiveCooldown,
  effectiveSpeed,
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
  ultReq: Set<string>
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
    ultReq: new Set(),
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
  return OBSTACLES.some(
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
      if (next.ult) ctx.ultReq.add(id)
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

function startRound(ctx: SimContext, state: ArenaState): void {
  state.projectiles.splice(0, state.projectiles.length)
  const placed: Player[] = []
  for (const player of state.players.values()) {
    const spawn = findSpawn(placed)
    player.x = spawn.x
    player.y = spawn.y
    player.hp = classOf(player.skin).hp
    player.boost = 0
    player.shield = 0
    player.ult = 0
    player.ultTicks = 0
    player.stun = 0
    player.root = 0
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
    const spawn = findSpawn(alive)
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
  for (const [id, player] of state.players) {
    if (!player.alive) continue
    const input = ctx.inputs.get(id)
    if (!input || ctx.stalled.has(id)) continue
    // Betaeubt/festgewurzelt: keine Bewegung (Client-Prediction spiegelt das ueber stun/root).
    if (player.stun > 0 || player.root > 0) continue
    // Gleiche Schrittfunktion wie die Client-Prediction (shared/physics): Boost inklusive.
    player.boost = stepPlayer(
      player,
      player.boost,
      input.dx,
      input.dy,
      effectiveSpeed(classOf(player.skin), player.ultTicks),
    )
  }
}

function resolvePlayerCollisions(state: ArenaState): void {
  const alive = [...state.players.entries()].filter(([, p]) => p.alive)
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const [, a] = alive[i]!
      const [, b] = alive[j]!
      if (a.realm !== b.realm) continue
      if (resolveCircle(a, PLAYER_RADIUS, b, PLAYER_RADIUS)) {
        resolveArena(a, PLAYER_RADIUS)
        resolveArena(b, PLAYER_RADIUS)
      }
    }
  }
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
    // Fire-Rate serverseitig erzwungen (M2-03): zu fruehe Schuesse verfallen.
    if (ctx.tick - timers.lastFireTick < effectiveCooldown(cls, player.ultTicks)) continue
    timers.lastFireTick = ctx.tick
    const proj = new Projectile()
    proj.id = `p${ctx.nextProjectileId++}`
    proj.owner = id
    proj.kind = skinModel(player.skin)
    // Hexo-Ult: der naechste Schuss ist die Todesnadel (gross, mehr Schaden), danach ist die Ult verbraucht.
    if (cls.ult.kind === 'snipe' && player.ultTicks > 0) {
      proj.big = true
      player.ultTicks = 0
    }
    const aim = input.aim
    const offset = PLAYER_RADIUS + cls.projectileRadius + 1
    proj.x = player.x + Math.cos(aim) * offset
    proj.y = player.y + Math.sin(aim) * offset
    proj.vx = Math.cos(aim) * cls.projectileSpeed
    proj.vy = Math.sin(aim) * cls.projectileSpeed
    state.projectiles.push(proj)
    ctx.projectileTtl.set(proj.id, cls.ttlTicks)
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
      insideObstacle(proj.x, proj.y, (CLASSES[proj.kind] ?? CLASSES[0]!).projectileRadius)
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
  proj: { x: number; y: number; vx: number; vy: number; kind: number; owner: string; big: boolean },
  prevX: number,
  prevY: number,
): boolean {
  const cls = CLASSES[proj.kind] ?? CLASSES[0]!
  const ownerRealm = state.players.get(proj.owner)?.realm ?? 0
  const radius = PLAYER_RADIUS + cls.projectileRadius * (proj.big ? 2 : 1)
  for (const [id, player] of state.players) {
    if (id === proj.owner || !player.alive) continue
    if (player.realm !== ownerRealm) continue // Geisterwelt: nur Spieler derselben Welt treffen sich
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
      let amount = cls.damage * (proj.big ? cls.ult.damageMult : 1)
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
): void {
  const victim = state.players.get(victimId)
  if (!victim || !victim.alive) return
  const victimCls = classOf(victim.skin)
  // Bollwerk (Cuby-Ult): weniger Schaden waehrend die Ult laeuft.
  let rest = victim.ultTicks > 0 ? amount * victimCls.ult.damageTakenMult : amount
  const dealt = rest
  if (victim.shield > 0) {
    const absorbed = Math.min(victim.shield, rest)
    victim.shield -= absorbed
    rest -= absorbed
  }
  victim.hp -= rest
  // Ult-Aufladung: Schaden austeilen und einstecken laedt (gedeckelt auf ULT_MAX).
  chargeUlt(state.players.get(killerId), dealt * ULT_PER_DAMAGE_DEALT)
  chargeUlt(victim, dealt * ULT_PER_DAMAGE_TAKEN)
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
  victim.root = 0
  const killer = state.players.get(killerId)
  if (killer) {
    killer.kills += 1
    killer.score += KILL_SCORE
    chargeUlt(killer, ULT_PER_KILL)
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

/** Pro Tick: Status-Zaehler herunterzaehlen, passive Aufladung, Geisterwelt beenden. */
function tickStatus(ctx: SimContext, state: ArenaState): void {
  const passive = ctx.tick % ULT_PASSIVE_TICKS === 0
  for (const [id, player] of state.players) {
    if (!player.alive) continue
    if (player.stun > 0) player.stun--
    if (player.root > 0) player.root--
    if (player.ultTicks > 0) {
      player.ultTicks--
      if (player.ultTicks === 0 && ctx.ghostTarget.has(id)) endRealmsOf(ctx, state, id)
    }
    if (passive) chargeUlt(player, 1)
  }
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
      target.root = 0
    }
    ctx.ghostTarget.delete(booId)
  }
}

/** Platziert `p` direkt neben `target` (auf der Seite, von der `p` kommt), ohne in Waenden zu landen. */
function placeNextTo(p: Player, target: Player): void {
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
  for (const o of OBSTACLES) resolveRect(p, PLAYER_RADIUS, o)
}

/** Ult-Wuensche abarbeiten: nur bei voller Ladung, lebend, nicht betaeubt und ohne laufende Ult. */
function handleUlts(ctx: SimContext, state: ArenaState): void {
  if (ctx.ultReq.size === 0) return
  for (const id of ctx.ultReq) {
    const caster = state.players.get(id)
    if (!caster || !caster.alive || caster.ult < ULT_MAX || caster.ultTicks > 0 || caster.stun > 0)
      continue
    const def = classOf(caster.skin).ult
    if (def.range > 0) {
      // Zielauswahl entlang der Zielrichtung (gleiche Funktion wie die Client-Markierung).
      const aim = ctx.inputs.get(id)?.aim ?? caster.aim
      let best: Player | null = null
      let bestId = ''
      let bestScore = Infinity
      for (const [otherId, other] of state.players) {
        if (otherId === id || !other.alive || other.realm !== 0) continue
        const score = ultTargetScore(caster.x, caster.y, aim, def.range, other.x, other.y)
        if (score < bestScore) {
          bestScore = score
          best = other
          bestId = otherId
        }
      }
      if (!best) continue // kein Ziel: Ladung bleibt, Wunsch verfaellt
      placeNextTo(caster, best)
      if (def.kind === 'pounce') {
        best.stun = Math.max(best.stun, def.stunTicks)
      } else {
        const realm = ctx.nextRealm
        ctx.nextRealm = ctx.nextRealm >= 255 ? 1 : ctx.nextRealm + 1
        caster.realm = realm
        best.realm = realm
        best.root = def.durationTicks
        caster.ultTicks = def.durationTicks
        ctx.ghostTarget.set(id, bestId)
      }
    } else {
      caster.ultTicks = def.durationTicks
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
    bot.skin = Math.floor(Math.random() * SKIN_COUNT)
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
    // Klassenreichweite: Kurzstrecken-Bots (Assassins) muessen naeher ran, Sniper schiessen frueher.
    const reach = classRange(classOf(bot.skin))
    const aim = Math.atan2(nearest.y - bot.y, nearest.x - bot.x)
    const visible = lineOfSight(bot, nearest)
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
    if (bot.ult >= ULT_MAX && nearestDist < 450 && visible) ctx.ultReq.add(id)
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

function lineOfSight(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  for (const t of [0.25, 0.5, 0.75]) {
    const x = a.x + (b.x - a.x) * t
    const y = a.y + (b.y - a.y) * t
    if (insideObstacle(x, y, 0)) return false
  }
  return true
}
