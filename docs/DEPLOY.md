# DEPLOY.md – Neon Arena lokal betreiben (M5-04)

> Stand: local-only (kein Cloud-Deploy per Entscheidung). Alles läuft auf dem eigenen PC via Docker.

## Voraussetzungen

- Docker Desktop (läuft), Git, Node 20+ + pnpm (nur für Entwicklung)
- `.env` aus `.env.example` kopiert und `JWT_SECRET` mit starkem Zufallswert gesetzt:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## Start / Stop / Update

```powershell
# Start (baut Images, fährt Migrationen, startet alles)
docker compose -f infra/docker-compose.prod.yml up -d --build

# Status / Logs
docker compose -f infra/docker-compose.prod.yml ps
docker compose -f infra/docker-compose.prod.yml logs -f server

# Stop (Daten bleiben in Volumes)
docker compose -f infra/docker-compose.prod.yml down

# Update nach git pull
git pull
docker compose -f infra/docker-compose.prod.yml up -d --build
```

Erreichbar: Client http://localhost:5173 · Server http://localhost:2567/health · Bestenliste http://localhost:5173/leaderboard.html

## LAN-Playtest (andere Geräte im selben WLAN)

1. LAN-IP des PCs herausfinden: `ipconfig` (z. B. `192.168.1.50`)
2. Windows-Firewall: eingehend TCP **5173** und **2567** für privates Netzwerk erlauben:
   `New-NetFirewallRule -DisplayName "Neon Arena" -Direction Inbound -LocalPort 5173,2567 -Protocol TCP -Action Allow -Profile Private`
3. Am anderen Gerät: `http://192.168.1.50:5173` öffnen
4. Wichtig: Client spricht den Server über `VITE_SERVER_URL` an (**Buildzeit!**). Für LAN mit LAN-IP bauen:
   ```powershell
   $env:VITE_SERVER_URL = "http://192.168.1.50:2567"
   docker compose -f infra/docker-compose.prod.yml up -d --build
   ```

## Backup (Postgres)

```powershell
docker exec infra-postgres-1 pg_dump -U neon neon_arena > backup-neon-arena.sql
```

## Hinweise

- Free-Port-Kollision: `pnpm dev` und Playwright brauchen freie Ports 5173/2567 → vorher Prod-Stack stoppen (`down`).
- Uptime: `restart: unless-stopped` startet Container nach Reboot neu (wenn Docker Desktop Autostart hat).
- Kein TLS lokal (http/ws). Für öffentlichen Zugriff später: Cloudflare Tunnel oder Hetzner-VPS (siehe PROJECT_PLAN.md §7).
