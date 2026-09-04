# Playtest-Triage (M5-05) – Top-3 als GitHub-Issues anlegen

> `gh` fehlt auf diesem Rechner und Issue-Anlage braucht Login. Entweder je Issue 2 Klicks auf GitHub, oder `gh auth login` und nächste Session anlegen lassen.

## Issue 1: Join-Limit 5/min/IP blockt legitime NAT-Bursts

- Beobachtung (M5-03-Flood): Von 50 Bots kamen nur 5 durch, Rest `RATE_LIMITED` — korrekt per Spec, aber derselbe Effekt trifft echte Spieler hinter einem NAT (WG, Klassenzimmer, LAN-Playtest): 6 Freunde im selben WLAN können nicht gemeinsam joinen.
- Vorschlag: Limit auf 15/min/IP mit Burst-Toleranz, oder Key aus IP+Nickname statt nur IP.
- Code: `apps/server/src/rooms/ArenaRoom.ts` (`join:${clientIp}`), Konstanten nach `packages/shared` ziehen.

## Issue 2: Fehlende ENV-Vars scheitern spät und irreführend

- Beobachtung (M5-04): Lokale `.env` hatte kein `JWT_SECRET` (nur `.env.example`), Prod-Boot warf — maskiert als `400 INVALID_NICKNAME`, weil der `/auth/guest`-Catch-all alles schluckt.
- Vorschlag: Startup-Validierung in `apps/server/src/index.ts` (Pflicht-Vars prüfen, fail-fast mit klarer Meldung) + getrennte Fehlercodes (`INVALID_NICKNAME` vs `AUTH_FAILED`) statt Catch-all-400.

## Issue 3: `VITE_SERVER_URL` nur Buildzeit — LAN-Playtest braucht Rebuild

- Beobachtung (M5-04): Compose-`environment` wirkt nicht auf den Vite-Build; LAN-IP erfordert Rebuild mit Build-Arg (per `ARG` + Doku entschärft, aber Stolperfalle).
- Vorschlag: Runtime-Config — `apps/client` liest `?server=`-Query-Param oder `/config.json` (vom selben Origin) als Override für `VITE_SERVER_URL`, mit Build-Wert als Fallback.
