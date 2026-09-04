# PROJECT_PLAN.md – Neon Arena (Multiplayer-Online-Webgame)

> Stand: 2026-09-04 · Status: Planung (kein produktiver Code) · Autor: Planung mit AI-Assistenz
> Ziel: modular, erweiterbar, performant, sicher. Server ist bei allen wichtigen Spieldaten autoritativ.

---

## 1. Spielidee

**Arbeitstitel: Neon Arena** – 2D Top-Down Multiplayer-Arena im Browser (.io-like).

- **Spieler:** 8–12 pro Raum, kurze Runden (~3 Minuten).
- **Steuerung:** WASD + Maus (Zielen/Schießen). Kein Account-Zwang im MVP (Gast + Nickname).
- **Ziel:** Meiste Punkte / letzter Überlebender gewinnt. Kills geben Punkte, Pickups (HP, Shield, Weapon-Upgrade) spawnen periodisch.
- **Map:** 1 Map im MVP (rechteckige Arena mit Hindernissen), 1 Modus (Deathmatch mit Timer).
- **Bots:** füllen Räume auf, wenn zu wenig echte Spieler da sind (schaltbar).
- **Art-Style:** Neon-Vektor-Look (Canvas-Primitive, Glow via ShadowBlur sparsam) – billig zu rendern, gut lesbar.

### MVP-Scope (drin)
1. Laufen, Zielen, Schießen, Kollision (Spieler/Wände/Projektile), HP/Schaden/Respawn.
2. Autoritativer Server (30 Hz Simulation), Delta-Snapshots an Clients (20 Hz).
3. Room-System + simples Matchmaking (Join → freier Raum oder neuer Raum).
4. Killfeed, Scoreboard, Runden-Timer, Sieger-Anzeige.
5. Gast-Identität (Nickname + signiertes Gast-Token), Leaderboard persistent.
6. Minimale Soundeffekte (WebAudio, synthetisiert – keine Assets nötig).
7. Health-/Metrics-Endpunkte, FPS-Debug-Overlay (`?debug=1`).

### Non-Goals MVP (explizit draußen)
- Kein 3D, keine persistente Open World / MMO.
- Kein Skin-Shop, kein Battle-Pass, keine Echtgeld-Systeme.
- Kein Mobile-Touch (kommt als P2), kein Gamepad.
- Kein Passwort-Login / OAuth im MVP (nur Gast; Accounts als P1).
- Kein Kernel-Level-Anti-Cheat (nur serverseitige Validierung + Rate-Limits).

---

## 2. Empfohlener Tech-Stack (mit Begründung)

| Bereich | Empfehlung | Warum |
|---|---|---|
| Sprache | **TypeScript überall** | Eine Sprache, geteilte Typen fürs Netzprotokoll, weniger Serialisierungs-Bugs |
| Monorepo | **pnpm Workspaces + Turborepo** | `client`/`server`/`shared` teilen Code; ein Repo, ein `pnpm dev`; Turborepo cacht Builds/Tests |
| Client-Build | **Vite** | Schneller Dev-Server, kleines Prod-Bundle, kein Framework-Overhead nötig |
| Client-Rendering | **Plain HTML5 Canvas 2D (eigener Mini-Renderer)** | **Entscheidung:** kein Phaser im MVP. Begründung: (1) Bundle <150 KB statt ~1 MB, (2) Netzcode (Prediction/Interpolation) bleibt explizit und lernbar, (3) kein Engine-Lock-in. Phaser/Pixi als P2-Option für mehr Content (Partikel, Tilemaps) sauber nachrüstbar, da Rendering hinter `Renderer`-Interface gekapselt wird |
| Server-Runtime | **Node.js 22 + TypeScript** | performant genug für 30 Hz-Räume dieser Größe, größtes Ökosystem, gleiches Tooling wie Client |
| Multiplayer-Framework | **Colyseus** | Rooms, autoritativer State, Delta-Sync, Redis-Presence out of the box; spart ~60 % Eigenbau gegenüber raw `ws`. Alternative `uWebSockets.js + Eigenbau` wäre schneller, aber teurer in Dev-Zeit |
| Validierung | **Zod (in `packages/shared`)** | Ein Schema für Client+Server → Client kann nie ungültige Messages schicken, die der Server akzeptiert |
| Persistenz-DB | **PostgreSQL** (Start: Neon/Supabase Free-Tier) | User, Matches, Leaderboard – relational passt, später einfach auf eigenen Server umziehbar |
| Ephemeral/Session | **Redis** (Start: Upstash Free-Tier) | Rooms, Matchmaking-Queue, Rate-Limits, Pub/Sub für Multi-Node-Betrieb |
| ORM | **Prisma** (ab M4) | Typsichere Queries, Migrationen; im MVP-Skeleton noch raw SQL ok, Prisma ab Persistenz-Meilenstein |
| Auth MVP | **Signierte Gast-JWT in httpOnly-Cookie** | Kein Passwort-Handling, kein OAuth-Aufwand; Upgrade-Pfad zu Accounts bleibt offen |
| Tests | **Vitest (Unit) + Playwright (1 Smoke-Test)** | Vitest schnell für Sim-Logik; Playwright beweist „2 Clients sehen sich“ |
| Lasttests | **k6 (später, M5)** | 50 Bot-Clients gegen Staging, misst Tick-Zeiten |
| Container | **Docker + Docker Compose** | `client`, `server`, `postgres`, `redis` lokal mit einem Befehl; Prod nutzt dieselben Images |
| CI/CD | **GitHub Actions** | lint + typecheck + test + build pro Push; Preview-Deploy pro PR |
| Hosting MVP | **Client statisch (Cloudflare Pages), Server als Container (Fly.io/Render)** | Gratis-/Low-Cost-Start, später Hetzner-VPS + Coolify für Fixkosten |

### Performance-Budgets (verbindlich für MVP)
- RTT EU: <100 ms · Initial-JS: <150 KB gzip · 60 fps bei ≤50 Entities.
- Server: 1 vCPU trägt ~4 Räume à 12 Spieler bei 30 Hz (zu verifizieren in M5).

---

## 3. Architektur

```
┌─────────────┐   WebSocket (Colyseus, 20 Hz Snapshot + Events)   ┌──────────────────────┐
│   Browser   │  ───────────────────────────────────────────────  │     Game-Server      │
│ Canvas 2D   │   nur Inputs hoch: {seq, dx, dy, aim, fire}       │  Node + Colyseus     │
│ Prediction +│  ───────────────────────────────────────────────  │  autoritative Sim    │
│ Interpolation│                                                  │  30 Hz fixed step    │
└─────────────┘                                                  └──────┬───────┬───────┘
                                                                        │       │
                                                              Redis (Rooms,     │ Postgres
                                                              Queue, Pub/Sub,   │ (Users, Matches,
                                                              Rate-Limits)      │  Leaderboard)
```

- **Client:** rendert 60 fps, predicted eigene Bewegung, interpoliert Gegner (100 ms Puffer), reconciliert bei Server-Korrektur via `seq`-ACK.
- **Server:** einzige Wahrheit für Position, HP, Damage, Kills, Pickups, Kollision, Cooldowns. Client-Inputs werden geclampft + validiert.
- **Shared-Package:** `protocol.ts` (Message-Typen), `constants.ts` (Tick-Raten, Speeds, Budgets), `schemas.ts` (Zod-Schemas). Niemals Netz-Strings doppelt definieren.
- **Skalierungspfad:** mehrere Server-Nodes via Redis-Presence; später Trennung in `gateway` (WS) + `sim-worker` möglich, im MVP ein Prozess.

---

## 4. Multiplayer-System (Detail)

- **Tick-Modell:** Server-Simulation `30 Hz` fixed timestep; Broadcast `20 Hz` Delta-Snapshots; Client-Render `60 fps` entkoppelt.
- **Nachrichten:** `0x01 Input` (Client→Server, 30/s max), `0x02 Snapshot` (Server→Client, Delta), `0x03 Event` (Kill/Pickup/RoundEnd). Binär oder JSON? Start: JSON (Debug-freundlich), Wechsel auf binär (MessagePack) als P1-Optimierung, Protokoll-Version im Handshake (`PROTOCOL_V = 1`), alte Clients werden gekickt.
- **Prediction & Reconciliation:** nur eigene Bewegung wird vorhergesagt; Server antwortet mit ACK-`seq`; bei Abweichung >Epsilon: Snap + Replay noch offener Inputs.
- **Interpolation:** Gegner mit 100 ms Verzögerungs-Buffer rendern → weiche Bewegung trotz 20 Hz.
- **Lag-Compensation:** serverseitiger Rewind (~100 ms) für Trefferprüfung bei Hitscan/Projektilen.
- **Rooms:** max 12 Spieler, `maxIdle 60 s`, dynamische Erstellung; Matchmaking: Join → ältester nicht-voller Raum, sonst neuer. Skill-Wertung erst P2.
- **Reconnect:** 15 s Grace-Period mit gleichem Gast-Token → Rejoin in denselben Raum.
- **Anti-Desync:** deterministische Sim-Konstanten aus `shared`, Server-Clamps (Speed, Fire-Rate, Positions-Bounds), Server-seitiger Raycast/Kreis-Kollision – nie Client-Treffer übernehmen.

---

## 5. Datenbank

### PostgreSQL (persistent)
- `users(id UUID PK, nickname TEXT, is_guest BOOL, created_at)` – MVP nur Gäste.
- `matches(id UUID PK, room_id TEXT, started_at, ended_at, winner_id FK)`.
- `match_players(match_id FK, user_id FK, kills INT, deaths INT, score INT)`.
- Leaderboard als View (`SUM(score)`, Top 100) – später materialized bei Last.
- Migrationen via Prisma ab M4; Connection-Pool (PgBouncer oder Prisma-Pool, max ~10).

### Redis (ephemeral)
- `rooms:*` (Metadaten, Spielerzahl), `queue:*` (Matchmaking), `ratelimit:ip:*` (Sliding Window), `session:*` (Gast-Token → User, TTL 24 h), Pub/Sub für Cross-Node-Room-Events.

### Datenfluss
Join → Gast-Token prüfen/erstellen (Redis+Postgres) → Room zuweisen (Redis) → Sim läuft (In-Memory) → Rundenende → Ergebnis nach Postgres schreiben (async, non-blocking).

---

## 6. Sicherheit

1. **Auth:** Gast-JWT (ed25519/HS256, 24 h TTL) in `httpOnly + Secure + SameSite=Lax`-Cookie; nie im `localStorage`.
2. **Transport:** Prod nur `wss/https`; CORS-Whitelist (kein `*`); Helmet-Header auf HTTP-Routen.
3. **Validierung:** jede Client-Message durch Zod-Schema; unbekannte Felder strippen; Overflows (Nickname ≤16 Zeichen, alphanumerisch + `_-`) strippen/escapen – nie `innerHTML` für Nicknames.
4. **Rate-Limits (Redis):** Input ≤30/s, Join ≤5/min/IP, Chat (falls P2) ≤5/s.
5. **Autorität:** Schaden/Bewegung/Cooldowns nur Server; Speed-Hack via Positions-Clamp + Teleport-Distanz-Check pro Tick; Fire-Rate serverseitig erzwungen.
6. **Version-Gate:** `PROTOCOL_V`-Mismatch → Kick mit „Bitte neu laden“.
7. **Logging:** keine PII (kein IP-Log im Klartext, Hash-Salz), strukturierte Logs (pino), Error-Tracking (Sentry) erst P1.
8. **Secrets:** nur via Env (`.env` nie committen, `.env.example` einchecken); CI-Secrets in GitHub Secrets.

---

## 7. Deployment & Betrieb

- **Lokal:** `docker-compose up` startet `client:5173`, `server:2567`, `postgres:5432`, `redis:6379`. Ein Befehl, keine manuelle DB-Einrichtung.
- **MVP-Prod:** Client → Cloudflare Pages (statisch); Server → Fly.io/Render (Docker-Image aus CI); DB → Neon/Supabase; Redis → Upstash.
- **Später (Prod-Fixkosten):** 1× Hetzner VPS (CX22+) + Coolify: alle Container dort, Cloudflare davor (DNS+CDN+DDoS). Kosten ~5–10 €/Monat.
- **CI (GitHub Actions):** `lint → typecheck → test → build`, Docker-Image bauen/pushen, Preview-Deploy pro PR, Prod-Deploy nur von `main`.
- **Beobachtbarkeit MVP:** `/health` (up, version), `/metrics` (rooms, players, tick_ms p95), Client-Overlay `?debug=1` (fps, rtt, tick). Alerts erst P1 (Uptime-Kuma/BetterStack).

---

## 8. Ordnerstruktur (Monorepo)

```
Neon Arena/
├── PROJECT_PLAN.md
├── TASKS.md
├── package.json              # pnpm Workspaces + Turbo
├── turbo.json
├── .env.example
├── apps/
│   ├── client/               # Vite + TS + Canvas
│   │   └── src/
│   │       ├── main.ts       # Bootstrap
│   │       ├── net/          # Colyseus-Client, Snapshot-Buffer, Reconciliation
│   │       ├── game/         # Entities, Renderer-Interface, CanvasRenderer, Input, Audio, Prediction
│   │       └── ui/           # HUD, Menüs, Scoreboard (DOM-Overlay über Canvas)
│   └── server/               # Node + Colyseus
│       └── src/
│           ├── index.ts      # Bootstrap, Routen (/health, /metrics)
│           ├── rooms/        # ArenaRoom (Join/Leave, Broadcast)
│           ├── sim/          # GameLoop, Physics, Combat, Pickups, Bots
│           ├── auth/         # Gast-JWT, Cookies
│           └── db/           # Postgres/Redis-Clients, Repos
├── packages/
│   └── shared/               # von Client+Server importiert
│       └── src/
│           ├── protocol.ts   # Message-Typen + PROTOCOL_V
│           ├── constants.ts  # Ticks, Speeds, Budgets
│           └── schemas.ts    # Zod-Schemas
├── infra/
│   ├── docker-compose.yml
│   └── Dockerfiles (client, server)
└── docs/
    └── DECISIONS.md          # ADR-Log (z. B. „Canvas statt Phaser“)
```

**Modul-Regeln:** `client` importiert nie aus `server` (und umgekehrt) – alles Geteilte liegt in `shared`. Rendering hinter `Renderer`-Interface, damit später Phaser/Pixi tauschbar ist.

---

## 9. Entwicklungsphasen & Milestones (MVP ~5–6 Wochen Teilzeit)

| Milestone | Inhalt | Dauer | Done-wenn |
|---|---|---|---|
| M0 Setup | Monorepo, Tooling, Docker Compose, CI-Skelett | 0,5 Wo | `docker-compose up` + `pnpm check` grün |
| M1 Net-Skeleton | Shared-Protokoll, Join/Leave, Echo-Bewegung | 1 Wo | 2 Browser-Tabs sehen sich bewegen |
| M2 Core-Sim | Bewegung/Kollision/Schuss/HP/Respawn, Reconciliation | 1–2 Wo | lokal spielbar ohne sichtbaren Desync |
| M3 Multiplayer | Rooms ≤12, Matchmaking, Killfeed/Scoreboard, Interpolation, Bots | 1 Wo | 8 echte+Bot-Spieler stabil 10 min |
| M4 Persistenz | Postgres+Redis, Gast-JWT, Match-Historie+Leaderboard | 1 Wo | Restart-verlustfreie Stats, Top-100-Seite |
| M5 Hardening+Release | Rate-Limits, Version-Gate, k6+Playwright, Prod-Deploy, Playtest | 1 Wo | Public-URL, 10 min Last ohne Crash |

P2 danach: Touch-Controls, 2. Map/Modus, Skins, OAuth-Accounts, Sound-Upgrade, Admin-Dashboard, Replays.

---

## 10. Fortschritt prüfen (so verifizierst du mich)

1. `pnpm dev` (bzw. `docker-compose up`) → http://localhost:5173 öffnen, **2 Tabs** = 2 Spieler müssen sich gegenseitig sehen/bewegen.
2. `pnpm check` (lint + typecheck + tests) muss grün sein – pro Milestone vorzeigen.
3. `GET /health` und `/metrics` (Räume, Spieler, `tick_ms` p95 < Budget).
4. `?debug=1`-Overlay: fps, rtt, Server-Tick im Blick.
5. Playtest-Checkliste (Join, Move, Shoot, Kill, Death/Respawn, RoundEnd, Reconnect, 12-Spieler-Last) – wird pro Milestone abgehakt (siehe TASKS.md).
6. Jeder Milestone endet mit Demo (Screen-Share oder Deploy-Preview-Link) + `git tag milestone/Mx`.

---

## 11. Annahmen & offene Entscheidungen

**Annahmen (getroffen, änderbar):**
- A1: Genre .io-Arena passt (von dir bestätigt).
- A2: Rendering plain Canvas 2D (Phaser erst P2-Option).
- A3: Colyseus als Netz-Framework (statt Eigenbau).
- A4: Hosting-Start auf Free-Tiers (Neon/Supabase, Upstash, Fly.io/Render, Cloudflare Pages).
- A5: Nur EU-Region im MVP (kein Multi-Region-Routing).
- A6: Solo-Dev-Tempo ~5–6 Wochen Teilzeit bis MVP-Release.

**Offen (deine Entscheidung, blockiert MVP nicht):**
- O1: Repo-Name/Ordner ok so („Neon Arena“)? Git initialisieren + GitHub-Remote?
- O2: Gast-only im MVP ok, oder sofort echte Accounts (OAuth/Discord)?
- O3: Budget-Limit für Hosting (strikt gratis vs. ~5–10 € Hetzner ok)?
- O4: Sound synthetisiert ok, oder lizenzfreie Assets gewünscht?
- O5: Releasing unter eigenem Namen – Lizenz (MIT vs. proprietär)?
