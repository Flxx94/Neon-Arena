#!/bin/sh
# Neon Arena – Server-Start fuer Free-Hosting (Render) und Docker Compose.
# - Prisma-Migration nur wenn DB aktiv (DB_ENABLED != false UND DATABASE_URL gesetzt).
#   Im Free-Start ohne DB (DB_ENABLED=false) wird sie uebersprungen – der Server
#   laeuft dann im degradierten Memory-Modus (Sessions/Limits), Spiel voll nutzbar,
#   /leaderboard antwortet 503.
# - Danach Node mit dem von Render injizierten $PORT (Fallback 2567).
set -e
if [ "${DB_ENABLED:-true}" != "false" ] && [ -n "$DATABASE_URL" ]; then
  echo "[server] running prisma migrate deploy..."
  (cd apps/server && ./node_modules/.bin/prisma migrate deploy) || \
  (cd /app/apps/server && ./node_modules/.bin/prisma migrate deploy) || \
  echo "[server] WARN: migrate deploy fehlgeschlagen, starte trotzdem"
else
  echo "[server] DB deaktiviert (DB_ENABLED=false oder keine DATABASE_URL) – Skip Migration, Memory-Modus"
fi
echo "[server] listening on :${PORT:-2567}"
exec node apps/server/dist/index.js
