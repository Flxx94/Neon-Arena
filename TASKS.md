# TASKS.md – Neon Arena (Aufgaben nach Priorität & Milestones)

> Legende: **P0** = MVP-kritisch · **P1** = wichtig, nach MVP-Release ok · **P2** = später.
> IDs sind stabil (`M<MS>-<NN>`). Jede Aufgabe hat ein Akzeptanzkriterium („Done-wenn“).
> Reihenfolge innerhalb eines Milestones = empfohlene Abarbeitung.

---

## Milestone M0 – Setup & Tooling [P0] (~0,5 Wochen) — DONE (2026-09-04, `milestone/M0`)

- [x] **M0-01 [P0]** Monorepo anlegen (`pnpm` Workspaces + `turbo.json`, Pakete `apps/client`, `apps/server`, `packages/shared`)
  Done-wenn: `pnpm install` + `pnpm dev` startet beide Apps ohne Fehler. → verifiziert (Client :5173 → 200, Server :2567 läuft).
- [x] **M0-02 [P0]** TypeScript strict, ESLint, Prettier, `.env.example` einrichten
  Done-wenn: `pnpm check` (lint + typecheck) läuft und ist grün. → verifiziert.
- [x] **M0-03 [P0]** Docker Compose (`client`, `server`, `postgres`, `redis`) + Dockerfiles
  Done-wenn: `docker-compose up` → Client :5173, Server :2567, DBs erreichbar. → Dateien angelegt, `docker` auf diesem Rechner nicht verfügbar, Verify offen.
- [x] **M0-04 [P0]** CI-Skelett (GitHub Actions: install → lint → typecheck → test → build)
  Done-wenn: Push auf Branch lässt CI grün durchlaufen. → `.github/workflows/ci.yml` angelegt, lokal alle Schritte grün; Push ausstehend (kein Remote).
- [x] **M0-05 [P0]** Server `/health` (up, version) und `/metrics`-Stub (rooms, players, tick_ms)
  Done-wenn: `curl localhost:2567/health` antwortet 200 mit JSON. → verifiziert (Unit-Test + Live-Curl).

---

## Milestone M1 – Netz-Skeleton (Shared-Protokoll + Join/Move) [P0] (~1 Woche)

- [ ] **M1-01 [P0]** `packages/shared`: `protocol.ts` (Message-Typen, `PROTOCOL_V=1`), `constants.ts` (Tick-Raten, Speeds), `schemas.ts` (Zod: Join, Input)
  Done-wenn: Client+Server importieren Typen ohne Duplikate; Unit-Test validiert Beispiel-Messages.
- [ ] **M1-02 [P0]** Colyseus-Room `ArenaRoom`: Join/Leave, Spielerliste, Snapshot-Broadcast 20 Hz
  Done-wenn: 2 Browser-Tabs joinen, sehen einander in der Spielerliste.
- [ ] **M1-03 [P0]** Client-Net-Layer: Verbinden, Snapshot-Buffer, Input-Senden (30/s, mit `seq`)
  Done-wenn: Bewegung in Tab A erscheint <200 ms in Tab B (lokal).
- [ ] **M1-04 [P0]** Nickname-Eingabe + Spawn (zufällige Position, kein Overlap)
  Done-wenn: 2 Tabs mit verschiedenen Nicknames spawnen sichtbar unterschiedlich.
- [ ] **M1-05 [P0]** Playwright-Smoke: „2 Clients joinen und bewegen sich“
  Done-wenn: `pnpm test:e2e` grün in CI.

---

## Milestone M2 – Autoritative Core-Simulation [P0] (~1–2 Wochen)

- [ ] **M2-01 [P0]** Fixed-Timestep GameLoop serverseitig (30 Hz), Konstanten aus `shared`
  Done-wenn: `tick_ms` p95 < 5 ms bei 12 Spielern (lokal gemessen).
- [ ] **M2-02 [P0]** Bewegung + Kreis-Kollision (Spieler↔Spieler, Spieler↔Wand/Hindernis), Positions-Clamps
  Done-wenn: kein Durchdringen von Wänden bei 5-min-Dauertest (manuell).
- [ ] **M2-03 [P0]** Schießen (Projektil oder Hitscan – Entscheidung in M2, Empfehlung: Projektil mit Server-Rewind 100 ms), Fire-Rate-Limit serverseitig
  Done-wenn: Feuern über Limit wird serverseitig verworfen (Unit-Test).
- [ ] **M2-04 [P0]** HP/Schaden/Tod/Respawn (3 s), Spawn-Schutz 2 s
  Done-wenn: Kill → Respawn-Zyklus funktioniert in 2 Tabs reproduzierbar.
- [ ] **M2-05 [P0]** Client Prediction (eigene Bewegung) + Reconciliation via `seq`-ACK
  Done-wenn: bei 100 ms simulierter Latenz kein „Rubber-Banding“ >1 Tile (Sichtprüfung `?debug=1`).
- [ ] **M2-06 [P0]** Renderer-Interface + `CanvasRenderer`, Input (WASD+Maus), HUD (HP, Timer-Platzhalter)
  Done-wenn: 60 fps bei 50 Entities lokal (Overlay zeigt fps).
- [ ] **M2-07 [P1]** Synthetisierte Soundeffekte (Schuss, Hit, Tod via WebAudio)
  Done-wenn: Sounds schaltbar (Mute-Button), keine externen Assets.

---

## Milestone M3 – Echter Multiplayer (Rooms, Modi, Feel) [P0] (~1 Woche)

- [ ] **M3-01 [P0]** Room-Lifecycle: dynamische Erstellung, max 12 Spieler, `maxIdle 60 s`, Grace-Reconnect 15 s
  Done-wenn: 13. Spieler landet in neuem Raum; Reconnect innert 15 s behält Score.
- [ ] **M3-02 [P0]** Matchmaking: Join → ältester nicht-voller Raum, sonst neu
  Done-wenn: 8 sequentielle Joins verteilen sich korrekt (Test-Skript).
- [ ] **M3-03 [P0]** Runden-System: 3-min-Timer, Punkte (Kill=100, Assist/Überleben-Bonus), Sieger-Screen
  Done-wenn: Runde endet automatisch, Sieger wird allen angezeigt, neuer Countdown startet.
- [ ] **M3-04 [P0]** Killfeed + Scoreboard (live, sortiert)
  Done-wenn: Kills erscheinen <500 ms im Feed aller Clients.
- [ ] **M3-05 [P0]** Gegner-Interpolation (100 ms Buffer), Lag-Compensation-Sanity (keine „Hinter-die-Wand“-Kills im Normalfall)
  Done-wenn: 8-Spieler-Test wirkt flüssig (Sichtprüfung, 2 echte Clients + 6 Bots).
- [ ] **M3-06 [P1]** Bots (einfache Seek+Shoot-AI, Schwierigkeit konstant) zum Auffüllen
  Done-wenn: Raum mit 2 echten + 6 Bots läuft 10 min stabil.
- [ ] **M3-07 [P1]** Pickups (HP-Pack, Shield) mit Server-Spawn-Timer
  Done-wenn: Pickup-Effekt nur nach Server-Bestätigung sichtbar (kein Client-Fake).

---

## Milestone M4 – Persistenz & Identität [P1] (~1 Woche; Leaderboard = P0-Anteil)

- [ ] **M4-01 [P0]** Postgres-Schema + Prisma (`users`, `matches`, `match_players`), Migrationen
  Done-wenn: `prisma migrate deploy` läuft in Docker Compose fehlerfrei.
- [ ] **M4-02 [P0]** Gast-JWT (httpOnly-Cookie, 24 h) + Rejoin-Session in Redis
  Done-wenn: Reload behält Identität; fremdes Token wird abgewiesen (Test).
- [ ] **M4-03 [P0]** Rundenende → Ergebnis async nach Postgres (non-blocking für Sim)
  Done-wenn: Tick-Zeit steigt beim Schreiben nicht messbar (Vorher/Nachher-Log).
- [ ] **M4-04 [P1]** Leaderboard-Seite (Top 100, aus View) + Match-Historie pro Spieler
  Done-wenn: nach 3 Runden sind Einträge sichtbar und korrekt summiert.
- [ ] **M4-05 [P1]** Rate-Limits in Redis (Input 30/s, Join 5/min/IP)
  Done-wenn: Flood-Test (k6/Node-Skript) wird mit 429/Disconnect beantwortet, legitimer Traffic unbeeinflusst.

---

## Milestone M5 – Hardening, Deploy, Playtest [P0] (~1 Woche)

- [ ] **M5-01 [P0]** Version-Gate (`PROTOCOL_V`-Mismatch → Kick „Bitte neu laden“) + CORS-Whitelist + Helmet
  Done-wenn: alter Client (V0 simuliert) wird abgelehnt; Security-Header per `curl -I` sichtbar.
- [ ] **M5-02 [P0]** Input-/Schema-Härtung: Zod überall, Nickname-Sanitizing (≤16, `[a-zA-Z0-9_-]`), kein `innerHTML`
  Done-wenn: `<script>`-Nickname wird als Text gerendert (Playwright-Assertion).
- [ ] **M5-03 [P0]** k6-Lasttest (50 Bots, 10 min) + Tick-Budget-Auswertung
  Done-wenn: `tick_ms` p95 im Budget, keine Room-Crashes; Report in `docs/`.
- [ ] **M5-04 [P0]** Prod-Deploy (Client statisch, Server-Container, DB/Redis managed) + Env/Secrets-Doku
  Done-wenn: Public-URL spielbar, `docker`-Image aus CI gebaut.
- [ ] **M5-05 [P0]** Öffentlicher Playtest (≥4 echte Spieler, 30 min) + Bug-Triage-Liste
  Done-wenn: Checkliste (Join/Move/Shoot/Kill/Respawn/RoundEnd/Reconnect) abgehakt, Top-3-Bugs als Issues angelegt.
- [ ] **M5-06 [P1]** Sentry (Server-Errors) + Uptime-Monitor
  Done-wenn: erzwungener Test-Error erscheint in Sentry, Alert bei Downtime aktiv.

---

## Backlog P2 (nach MVP – nicht einplanen, nur sammeln)

- [ ] **P2-01 [P2]** Touch-Controls (virtuelle Joysticks) + Mobile-Layout
- [ ] **P2-02 [P2]** 2. Map + 2. Modus (z. B. King of the Hill)
- [ ] **P2-03 [P2]** Echte Accounts (OAuth/Discord) + Profil-Seite + Nickname-Reservierung
- [ ] **P2-04 [P2]** Skins/Farben (nur kosmetisch, nie Pay-to-Win)
- [ ] **P2-05 [P2]** Renderer-Upgrade evaluieren (Phaser/Pixi für Partikel/Tilemaps) – ADR in `docs/DECISIONS.md`
- [ ] **P2-06 [P2]** Binär-Protokoll (MessagePack) + Bandbreiten-Messung vorher/nachher
- [ ] **P2-07 [P2]** Skill-Matchmaking (Elo-light) + Regionen-Auswahl
- [ ] **P2-08 [P2]** Replays / Killcam + Admin-Dashboard (Rooms kicken, Bannen)
- [ ] **P2-09 [P2]** Eigener Hetzner-VPS + Coolify-Migration (Fixkosten statt Free-Tiers)

---

## Arbeitsweise (gilt ab sofort)

1. Ein Milestone nach dem anderen, P0 zuerst; kein P2 vor MVP-Release ohne deine Freigabe.
2. Pro Aufgabe: erst betroffenen Code lesen → kleinste Änderung → `pnpm check` → Demo.
3. Jeder Milestone endet mit: Demo + `git tag milestone/Mx` + Abhaken hier in TASKS.md.
4. Blockiert? Aufgabe bleibt `in_progress`, Blocker als neue Aufgabe darunter notieren.
