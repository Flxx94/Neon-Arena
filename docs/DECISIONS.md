# DECISIONS.md – Architecture Decision Records

## ADR-001: Plain Canvas 2D statt Phaser im MVP
- Status: akzeptiert (2026-09-04)
- Kontext: MVP braucht billiges Rendering, expliziten Netzcode (Prediction/Interpolation), kleines Bundle.
- Entscheidung: eigener Mini-Renderer hinter `Renderer`-Interface in `apps/client/src/game`.
- Konsequenz: Bundle <150 KB gzip, kein Engine-Lock-in; Phaser/Pixi als P2-Option nachruestbar (siehe P2-05).

## ADR-002: UI v3 "Toy Arcade" (Theme, Figuren, Map, Sound)
- Status: akzeptiert (2026-10-13)
- Entscheidung: komplett neuer Look (dicke Tinten-Outlines, Cel-Shading, Hard-Shadows) mit zwei Themes
  (`dark` = Night Grid, `light` = Day Arcade; Auto folgt dem OS, Wahl in `localStorage`, nur Kosmetik).
  - 6 prozedurale Figuren x 8 Farben (`game/models.ts`, Skin = `model + color * 6`, `shared/skins.ts`).
    Skin reist als optionales Join-Feld (Zod-Range-Check) und als `uint8` im State; Gameplay liest ihn nie.
  - Neue Karte "Prism Plaza" (`OBSTACLES` in shared, 20 symmetrische Hindernisse). Dekor nur im Client (`game/map.ts`).
    Test `map.test.ts` sichert Symmetrie, freie Mitte/Schusslinien und Zusammenhang der Spielflaeche.
  - Sound: weiter WebAudio ohne Assets (Rauschen/Filter/Hall, Panning nach Abstand, generative Musik).
  - Effekte: Partikel, Schockwellen, Screenshake, schwebende Zahlen; Aim wird quantisiert (0.05 rad) im State gesendet.
  - Bots weichen quer aus, damit sie an den neuen Hindernissen nicht haengen bleiben.
- Bewusst nicht: externe Webfonts (DSGVO/LAN) -> System-Rundschrift-Stack. Bundle bleibt weit unter 150 KB gzip (~37 KB).
- Konsequenz: `PROTOCOL_V` bleibt 1 (additive Felder: alte Clients ignorieren sie).
