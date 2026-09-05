# DEPLOY-FREE.md – Neon Arena kostenlos online spielen (Cloudflare Pages + Render Free)

> Stand: Free-Tier ohne eigenen PC, ohne Datenbank (Memory-Modus).
> Kosten: 0 € (Render Free, Cloudflare Pages Free).
> Limits: Render Free schläft nach ~15 min ohne Traffic (HTTP **und** WebSocket) ein;
> der nächste Join danach braucht ~30–60 s Cold-Start (Render zeigt solange eine Lade-Seite).
> Bestenliste ist ohne DB offline (`/leaderboard` → 503, Seite zeigt „Bestenliste offline“).
> Dein PC muss nach dem Deploy **nicht** laufen.

## Überblick

| Teil | Wohin | Was |
|---|---|---|
| Multiplayer-Server (`apps/server`, Colyseus WS) | **Render Free**, Region Frankfurt, 1 Instance, Docker aus `infra/Dockerfile.server` | `node apps/server/dist/index.js` via `infra/start-server.sh` (nutzt Render-`$PORT`, Migration nur mit DB) |
| Frontend (`apps/client`, Vite statisch) | **Cloudflare Pages**, Build `apps/client` | Env `VITE_SERVER_URL=https://<dein-service>.onrender.com` (**Buildzeit!**) |

Mehrere Spieler verbinden sich gleichzeitig über `wss://<dein-service>.onrender.com` – Free läuft mit genau 1 Instance (kein Sticky-Session-Bedarf, max 12 pro Raum, Matchmaking „ältester nicht-voller Raum“).

## Voraussetzungen

1. Repo auf GitHub pushen (Render + Pages bauen aus Git).
2. Starkes Secret erzeugen (nie committen):
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

## Schritt 1 – Server auf Render deployen

**Variante A – Blueprint (empfohlen):**

1. https://dashboard.render.com → **New → Blueprint** → Repo `Neon Arena` wählen, Branch `main`.
2. Im Feld **Blueprint Path** `infra/render.yaml` eintragen (Render sucht sonst nur im Repo-Root und findet nichts).
   Render erkennt dann den Service `neon-arena-server` (Docker, Free, Frankfurt, 1 Instance, Health-Check `/health`).
3. Beim Anlegen `JWT_SECRET` (dein Secret aus Voraussetzung 2) und vorläufig `CLIENT_URL=https://DEIN-PROJEKT.pages.dev` eintragen (wird nach Schritt 2 korrigiert).
4. **Apply** → URL notieren, z. B. `https://neon-arena-server.onrender.com`.

**Variante B – manuell:**

1. https://dashboard.render.com → **New → Web Service** → Repo wählen.
2. Runtime: **Docker**, Dockerfile-Pfad `infra/Dockerfile.server`, Build-Kontext Repo-Root (`.`).
3. Region: **Frankfurt** · Instance: **Free** (genau 1 Instance, kein Scaling auf Free).
4. Health-Check-Pfad: `/health`.
5. Environment variables (Vorlage: `infra/render.env.example` – `PORT` **nicht** setzen, injiziert Render selbst):
   - `NODE_ENV=production`
   - `CLIENT_URL=https://DEIN-PROJEKT.pages.dev` (Platzhalter, nach Schritt 2 korrigieren)
   - `JWT_SECRET=<dein Secret>`
   - `APP_VERSION=0.1.0`, `BOTS_ENABLED=true`, `DB_ENABLED=false`
   - `DATABASE_URL` / `REDIS_URL` **nicht** setzen, `COOKIE_SAMESITE` leer lassen (Prod-Default `none`)
6. **Deploy** → URL notieren.

**Prüfen:** `https://<dein-service>.onrender.com/health` → `{"status":"ok",...}` (beim allerersten Aufruf ggf. ~30–60 s Cold-Start abwarten).

## Schritt 2 – Frontend auf Cloudflare Pages deployen

1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → Repo wählen.
2. Build-Einstellungen (Root **muss Repo-Root** sein – der Client braucht `@neon-arena/shared` aus dem pnpm-Workspace):
   - Root directory: `/` (leer lassen = Repo-Root, **nicht** `apps/client`)
   - Build command: `npx pnpm@9.12.0 install --no-frozen-lockfile && npx pnpm@9.12.0 build`
     (baut via Turborepo erst `shared`, dann den Client; Alternative falls pnpm 9 vorinstalliert: `pnpm install && pnpm build`)
   - Output directory: `apps/client/dist`
   - Env (Production): `VITE_SERVER_URL=https://<dein-service>.onrender.com` (deine URL aus Schritt 1!)
3. **Deploy** → URL notieren, z. B. `https://neon-arena.pages.dev`.
4. **Wichtig – danach zurück zu Render:** `CLIENT_URL` exakt auf die Pages-URL setzen
   (ggf. Kommaliste: `https://neon-arena.pages.dev,https://xyz.pages.dev`), Service redeployen (bei Blueprint: Wert in Render ändern, neuer Deploy läuft automatisch).
   Grund: CORS-Whitelist + Gast-Cookie (`SameSite=None; Secure`) gelten nur für diese Origin.
5. Optional: eigene Domain in Pages unter **Custom domains** verbinden und dann ebenfalls in `CLIENT_URL` aufnehmen.

> Hinweis: `VITE_SERVER_URL` wirkt zur **Buildzeit**. Bei neuer Server-URL: Pages-Env ändern → **Retry deployment**.

## Schritt 3 – Zu zweit testen (Internet, zwei Netze ideal)

1. `https://<dein-projekt>.pages.dev` auf zwei Geräten (z. B. Handy + PC, gern verschiedene Netze) öffnen.
2. Verschiedene Nicknames (`1–16 Zeichen, a-z 0-9 _ -`) → **Spielen** → beide sehen sich bewegen.
3. Schießen/Kill/Respawn prüfen; Reload → Identität bleibt (Cookie `SameSite=None; Secure`).
4. Debug: URL mit `?debug=1` zeigt fps/Spieler.
5. Bestenliste: `https://<dein-projekt>.pages.dev/leaderboard.html?server=https://<dein-service>.onrender.com`
   → erwartet ohne DB: „Bestenliste offline (keine DB).“ – kein Fehler, by design.

## Schritt 4 – Warmhalten gegen Sleep (optional, kostenlos)

Render Free schläft nach ~15 min ohne eingehenden Traffic ein (aktive WS-Verbindungen zählen als Traffic – solange jemand spielt, bleibt er wach). Dagegen hilft ein externer Ping:
- https://uptimerobot.com (Free) → **HTTP(s) Monitor**, URL `https://<dein-service>.onrender.com/health`, Intervall **10–14 min** (innerhalb des 15-min-Fensters).
- Effekt: Server bleibt wach; ohne Ping hat der erste Spieler nach Pause ~30–60 s Cold-Start (Render-Lade-Seite, danach normal).

## Update-Flow

```powershell
git pull
# ... ändern, lokal pnpm check/build testen ...
git push   # Render + Pages bauen automatisch neu (Blueprint erkennt render.yaml-Änderungen)
```

## Troubleshooting

| Symptom | Ursache / Fix |
|---|---|
| Erster Aufruf hängt ~30–60 s / Render-Lade-Seite | Cold-Start nach Sleep – normal auf Free, abwarten oder UptimeRobot-Ping (Schritt 4) einrichten. |
| `CORS error` / Join schlägt fehl | `CLIENT_URL` in Render = exakte Pages-URL? Komma ohne Leerzeichen ok (wird getrimmt). Danach Redeploy. |
| Nach Reload „neuer Gast“ / Rejoin klappt nicht | Cookie blockiert? Prod braucht `SameSite=None; Secure` (ist Default in `production`). Nur über `https://` testen, nie `http://`. |
| `PROTOCOL_MISMATCH` / „bitte neu laden“ | Client/Server-Version auseinander → beide neu deployen, Browser hard reload. |
| `JWT_SECRET fehlt (production)` im Log | `JWT_SECRET` in Render-Env setzen + redeployen. |
| `/leaderboard` → 503 | By design ohne DB. Mit DB: Render Postgres + Upstash Redis anlegen, `DB_ENABLED=true` + URLs setzen, redeployen. |
| Build Pages findet `shared` nicht | Root directory muss `/` (Repo-Root) sein, Output `apps/client/dist` – siehe Schritt 2. |

## Zurück auf lokal (falls nötig)

`docs/DEPLOY.md` (Docker Compose, LAN-Playtest) bleibt unverändert gültig. Vor `pnpm dev`/Playwright: Prod-Stack stoppen (`docker compose -f infra/docker-compose.prod.yml down`), sonst Port-Kollision 5173/2567.
