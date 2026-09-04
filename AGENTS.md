# AGENTS.md – Neon Arena

> Current state (2026-09-04): M5 done (`milestone/M5`) — MVP COMPLETE (local-only per Entscheidung). Version-gate + reload UI, XSS-E2E, 50-bot flood (p95 0.57 ms, report `docs/LOADTEST.md`), prod compose + `docs/DEPLOY.md` (LAN), triage drafts `docs/ISSUES.md`. 42 unit tests + 2 Playwright green. Prod stack runs on this machine.
>
> ## Persistenz (M4)
> - DB/Redis sind OPTIONAL: `getDb()`/`getRedis()` return null when `NODE_ENV=test`, `DB_ENABLED=false`, or URL missing — server runs degraded (memory sessions/limits). Tests never need Docker.
> - Prisma 6.19.3 pinned (bare `prisma` resolves 8.0.0-rc!). `apps/server/prisma/` holds schema+migrations; Docker server runs `prisma migrate deploy` on boot; `prisma generate` is part of the Docker build.
> - Guest flow: `POST /auth/guest` → JWT+cookie+session (+User row if DB); client `ensureGuest()` (`/me` first for reload identity) sends `userId` in join options; room rejects unknown ids (`INVALID_GUEST`). `JWT_SECRET` must exist in local `.env` too (not just `.env.example`) or production boot throws.
> - Rate limits: `ratelimit/limiter.ts` (memory sliding / redis fixed-window). Input >35/s ignored, >120/s → `leave(4400)`; join 5/min/IP (`RATE_LIMITED`); HTTP guest route 429s.
> - jose: `setExpirationTime` needs a string like `'24h'` (number = epoch seconds → instantly expired).
>
> ## Layout (M2/M3)
> - Sim: `apps/server/src/sim/{state.ts,engine.ts,metrics.ts}` — pure `update(ctx, state)` over Colyseus Schema state, wired via `setSimulationInterval` in `ArenaRoom`. Unit-test through real Schema classes (needs the decorator/tsconfig flags below).
> - Shared physics (`packages/shared/src/physics.ts`) is used by BOTH server sim and client prediction — keep them in sync, never duplicate constants.
> - Turbo `test` depends on `^build`: server/client tests import `@neon-arena/shared` from `dist`, so stale builds cause phantom `is not a function` failures. Always verify via Turbo tasks, never bare `vitest`/`exec`.
> - Colyseus 0.16 client facts: room id is `room.roomId` (not `.id`); reconnect is `client.reconnect(room.reconnectionToken)` (single token); `room.leave(false)` = abrupt (grace path), `leave()` = consented. Reconnect tests need retry (server registers grace async).
> - MapSchema: iterate via `for...of`/`.entries()`/`.values()`/`.get()` (all delegated to `$items`) — never assume native-Map identity.
> - Room broadcasts Sim-Events drained via `drainEvents(ctx)` in the sim tick (`killfeed`/`round` messages); round/score/pickups also ride state sync.
>
> Env quirks on this machine: `pnpm` was installed via `npm i -g pnpm` (repo pins 9.12 via `packageManager`); Git + Docker Desktop paths are in User PATH (old shells need re-login or per-command prepend); for local `pnpm dev` / E2E first `docker compose -f infra/docker-compose.yml down` (ports 5173/2567 collide otherwise, and Playwright `reuseExistingServer` would test the stale Compose bundle).
>
> ## Colyseus pins (do not upgrade blindly)
> - Server: `@colyseus/core@0.16.20` + `@colyseus/ws-transport@0.16.5` + `@colyseus/schema@^3`, client `colyseus.js@0.16`. Wiring: `new Server({ transport: new WebSocketTransport({ server: httpServer }) })` + `await gameServer.listen(port)` (binds `/matchmake` routes; manual `httpServer.listen` leaves 404s).
> - Do NOT go to 0.18: no matching JS client (`colyseus.js` stops at 0.16 → `consumeSeatReservation` crash), and `@colyseus/core@0.16.25` / `colyseus@0.16.2+` publishes are broken (`workspace:` refs).
> - Server tsconfig MUST keep `experimentalDecorators: true` + `useDefineForClassFields: false` (else schema field initializers bypass the change-tracking setter via [[Define]] and state encoding crashes on `$childType`). Same flags mirrored in `apps/server/vitest.config.ts` (`esbuild.tsconfigRaw`) because Vitest doesn't take them from tsconfig.

## Where to start
- Work strictly in milestone order from `TASKS.md`: M0 → M5, P0 before P1, never P2 without approval.
- Per task: read affected code → smallest change → `pnpm check` → demo. Tick off in `TASKS.md`, end each milestone with `git tag milestone/Mx`.
- Open decisions (repo name/git init, guest-only vs OAuth, hosting budget, sounds, license) in `PROJECT_PLAN.md §11` are explicitly non-blocking — don't stall MVP on them.

## Planned structure (build this in M0, don't invent alternatives)
- `apps/client` (Vite + TS + plain Canvas 2D) / `apps/server` (Node 22 + Colyseus) / `packages/shared` (`protocol.ts`, `constants.ts`, `schemas.ts`) / `infra/` (compose + Dockerfiles) / `docs/DECISIONS.md`.
- Tooling: `pnpm` workspaces + Turborepo, TS strict, ESLint + Prettier, Vitest (unit) + Playwright (one smoke test) + k6 (M5 only), Prisma from M4 onward.

## Hard invariants (from PROJECT_PLAN.md, keep them)
- Server is authoritative for pos/HP/damage/kills/pickups/collision/cooldowns. Never trust client hits; clamp inputs, enforce fire-rate server-side.
- Net model: server sim 30 Hz fixed step, snapshots 20 Hz delta, client render 60 fps decoupled. Own movement predicted + reconciled via `seq`-ACK; enemies interpolated with 100 ms buffer; server rewind ~100 ms for hit checks.
- `PROTOCOL_V = 1` in handshake; mismatch → kick with "Bitte neu laden". Start with JSON, MessagePack is P2.
- Module rule: `client` never imports from `server` and vice versa — shared code goes in `packages/shared`. Rendering behind a `Renderer` interface (no Phaser in MVP: bundle budget <150 KB gzip, 60 fps at ≤50 entities, RTT EU <100 ms).
- Rooms: max 12 players, `maxIdle 60 s`, 15 s reconnect grace on same guest token. Matchmaking: oldest non-full room, else new. Round: 3-min timer, Kill = 100 pts.
- Security: guest JWT (24 h) in `httpOnly + Secure + SameSite=Lax` cookie, never `localStorage`; all client messages through Zod, strip unknown fields; nickname ≤16 chars `[a-zA-Z0-9_-]`, render as text, never `innerHTML`; prod only `wss/https`, CORS whitelist (no `*`); rate limits via Redis (Input ≤30/s, Join ≤5/min/IP); `.env` never committed, only `.env.example`.
- Persistence: Postgres (`users`, `matches`, `match_players`, leaderboard as view) + Redis (`rooms:*`, `queue:*`, `ratelimit:ip:*`, `session:*` TTL 24 h). Round results written async, non-blocking to sim.

## Commands (intended, verify once M0 lands)
- `pnpm install` + `pnpm dev` → both apps; `docker-compose up` → client :5173, server :2567, postgres :5432, redis :6379.
- `pnpm check` = lint + typecheck (+ tests) — must be green per milestone.
- Verify playability: open `http://localhost:5173` in 2 tabs (must see each other move), `curl localhost:2567/health` → 200 JSON, `?debug=1` overlay shows fps/rtt/tick. E2E: `pnpm test:e2e`.
- CI order (once `.github/workflows` exists): `lint → typecheck → test → build`; preview deploy per PR, prod only from `main`.
