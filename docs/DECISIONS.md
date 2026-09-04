# DECISIONS.md – Architecture Decision Records

## ADR-001: Plain Canvas 2D statt Phaser im MVP
- Status: akzeptiert (2026-09-04)
- Kontext: MVP braucht billiges Rendering, expliziten Netzcode (Prediction/Interpolation), kleines Bundle.
- Entscheidung: eigener Mini-Renderer hinter `Renderer`-Interface in `apps/client/src/game`.
- Konsequenz: Bundle <150 KB gzip, kein Engine-Lock-in; Phaser/Pixi als P2-Option nachruestbar (siehe P2-05).
