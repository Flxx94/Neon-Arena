# Loadtest-Report (M5-03)

- Datum: 2026-09-04 · Umgebung: Windows-PC, Dev-Server (`tsx`), Node 24, keine DB/Redis (Memory-Stores)
- Methode: `apps/server/flood.mts` — 50 echte Colyseus-Clients (Gast-Flow inkl. `/auth/guest`), 10-Min-Ramp (1 Join/12 s wegen Join-Limit 5/min/IP) + 2 Min Steady-State mit allen 50, zufällige Inputs 10/s mit Feuerwahrscheinlichkeit 0,5
- Hinweis: k6 aus TASKS.md wurde ersetzt — k6 spricht kein Colyseus-Protokoll (Matchmaking + State-Sync). Node-Skript ist der pragmatische Ersatz.

## Ergebnis

- Joins: 50/50, 0 Fehler · Send-Fehler: 0 · Room-Crashes: 0
- `tickMsP95` (Server-Sim, aus `/metrics`, 6642 Samples):
  - gesamt: **0,53 ms**
  - Steady-State (alle 50 aktiv): **0,57 ms**
  - max: 1,45 ms
- Budget 5 ms (M2-01): **eingehalten (Faktor ~9 Luft)**.

## Auffälligkeit

- Join-Limit 5/min/IP greift auch für legitime Bursts (z. B. mehrere Spieler hinter einem NAT / Test-Skripte). Für öffentliche Räume ggf. auf 10–15/min erhöhen — siehe Issue-Liste (M5-05).
