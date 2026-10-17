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

## ADR-003: Grosse Arena (2800x1600), Folgekamera, langsamere Sim
- Status: akzeptiert (2026-10-14)
- Entscheidung: Arena 1600x900 -> 2800x1600; `PLAYER_SPEED` 220 -> 165, `PROJECTILE_SPEED` 600 -> 400 (TTL 2200 ms,
  Reichweite ~880 px), Pickups haeufiger (9 s, max. 5), Bot-Reichweiten leicht erhoeht.
  - Karte "Prism Plaza": ein Viertel + Mittellinien in `shared/constants.ts`, die anderen Viertel per Spiegelung (Symmetrie bleibt Test-Invariante).
  - Client: Kamera folgt dem eigenen Spieler (Zoom ~1600x900 Welteinheiten sichtbar, auf kleinen Handys enger), Arena einmal als Offscreen-Layer
    (max. 1.25 px/Einheit) + separater Viewport-Hintergrund. `worldToScreen` nutzt die Kamera (Maus-Zielen bleibt korrekt).
- Konsequenz: Sim-Konstanten kommen weiter nur aus `shared`; `PROTOCOL_V` bleibt 1.

## ADR-004: Boost-Felder + fluessige Eigenbewegung
- Status: akzeptiert (2026-10-14)
- Entscheidung:
  - 8 symmetrische Boost-Felder (`BOOST_PADS`, shared): wer drueberlaeuft, ist `BOOST_TICKS` (2 s) lang `BOOST_SPEED_MULT` (x1.7) schneller;
    auf dem Feld stehen frischt auf. Die Schrittfunktion `stepPlayer` (shared/physics) wird von Server-Sim UND Client-Prediction genutzt,
    der Boost-Zaehler (`Player.boost`, uint8) ist additiv im State (PROTOCOL_V bleibt 1) und fliesst in die Reconciliation ein.
  - Server verbraucht pro Tick genau EINEN Input aus einer Warteschlange (max. 6); ohne frischen Input steht der Spieler still statt
    "den letzten Input zu wiederholen" -> Server und Prediction bleiben bei Netz-Jitter in Phase (vorher: periodische 1-Schritt-Korrekturen = Ruckeln).
    Input-Toleranz 45/s (statt 35) gegen Frame-Hitches.
  - Client: Input-/Prediction-Tick laeuft per Akkumulator im Render-Loop (nicht setInterval), die eigene Figur wird zwischen den 30-Hz-Schritten
    interpoliert; Reconciliation-Fehler werden weich ausgeblendet (Snap ab 90 px); Frame-Zeit aus `document.timeline.currentTime` (vsync-genau).
- Messung (Headless, simulierte 30-70 ms Latenz mit Jitter): Eigengeschwindigkeit konstant 165 px/s (stdev ~0 statt ~19 px/s).

## ADR-005: Accounts (Email + Passwort), Login-Seite und Lobby
- Status: akzeptiert (2026-10-15)
- Entscheidung:
  - Einstieg ist jetzt eine Login-Seite (Tabs Anmelden / Registrieren / Gast). Nach dem Login kommt die **Lobby**: Figur + Farbe per Pfeil-Buttons,
    Spielername aus dem Konto (kein Namensfeld mehr), Button "Match beitreten". Der Look wird am Konto gespeichert (`PATCH /me/skin`).
  - Server: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `PATCH /me/skin`, `GET /me` (erweitert um `isGuest`, `skin`, `email`).
    Passwoerter mit **scrypt** (Node-eigen, N=2^15, Salt pro Konto, Parameter im Hash), Konstantzeit-Vergleich, Dummy-Hash bei unbekannter Email
    (kein Timing-Orakel), generische 401 `INVALID_CREDENTIALS`. Email normalisiert (trim + lowercase), Passwort 8-128 Zeichen.
  - Session bleibt der bestehende httpOnly-Cookie (JWT, `na_guest`); Konten 7 Tage, Gaeste 24 h. Kein Token/Passwort im `localStorage`.
  - Rate-Limits: Register 10 / 10 min / IP, Login 20 / min / IP und 8 / 5 min / Email.
  - Der Spielername im Raum kommt aus der **Session**, nicht mehr aus den Join-Optionen (Konto-Namen koennen nicht gefaelscht werden).
  - Prisma: `User.email` (unique), `passwordHash`, `skin` (Migration `20261015090000_accounts`). Ohne DB (`DB_ENABLED=false`) laufen Konten
    **nur im Speicher** und sind nach einem Server-Neustart weg -> fuer dauerhafte Konten Postgres anbinden (docs/DEPLOY-FREE.md).
- Bewusst nicht (P2): Email-Verifizierung, Passwort-Reset, OAuth, Konto loeschen. Registrierung ohne Bestaetigung ist ok, solange keine Mails verschickt werden.
- Konsequenz: `PROTOCOL_V` bleibt 1; Gast-Flow (`/auth/guest`) bleibt unveraendert nutzbar.

## ADR-006: Charakter-Klassen (Werte + eine Attacke je Figur)
- Status: akzeptiert (2026-10-15)
- Entscheidung:
  - `shared/classes.ts` ist die einzige Quelle: pro Modell (Index = `skinModel(skin)`) Rolle (Damage Dealer / Tank / Assassin), Leben, Tempo,
    genau eine Attacke (Cooldown in Ticks, Schaden, Projektil-Tempo/-Radius/-Lebensdauer) plus Sonderverhalten. Blobby entspricht der bisherigen Einheitswaffe.
  - Sonderverhalten kostet O(1) pro Treffer, keine zusaetzlichen Entities: Boo = Lifesteal 30 %, Kitty = Rueckenschaden x1.7 (Ziel schaut vom Schuetzen weg),
    Hexo = Sniper (schnell, weit), Cuby = grosse langsame Wuerfel, Zappy = kurzreichweitige Blitze.
  - `stepPlayer` bekommt das Klassen-Tempo (Server und Client-Prediction), Max-HP leitet jeder aus dem Skin ab (Spawn, Respawn, Pickup, HUD, Lebensbalken).
    Einziges neues Netzfeld: `Projectile.kind` (uint8, additiv; PROTOCOL_V bleibt 1) fuer Optik/Sound.
  - Balance: `classPower` (DPS x Leben x Tempo, Lifesteal/Rueckenbonus gewichtet) liegt in +-30 % des Mittels (Test); Cooldown >= 6 Ticks und
    max. gleichzeitige Projektile je Spieler <= Standardwaffe (Test) -> Serverlast nicht hoeher als vorher. Bots nutzen Klassenreichweite.
  - Lobby zeigt Rolle, Attackenname, Kurzbeschreibung und Wertebalken.

## ADR-007: Ultra-Attacken, Charakterwechsel beim Tod, Zielbalken
- Status: akzeptiert (2026-10-16)
- Entscheidung:
  - Jede Figur hat genau eine Ult (`UltDef` in `shared/classes.ts`). Ladung `Player.ult` (uint16, 0..`ULT_MAX`=1000): Schaden austeilen (+1.5/Schaden),
    einstecken (+0.8/Schaden), Kill (+100), passiv +1 alle 8 Ticks. Tod: 35 % der Ladung gehen verloren; eine **volle** Leiste bleibt voll, bis sie benutzt wird.
    Rundenstart setzt Ladung und Status zurueck.
  - Ausloesen: `input.ult` (optional, idempotent; Q bzw. Touch-Button). Der Server prueft Ladung, Leben, Betaeubung und laufende Ult; der Client sendet
    den Wunsch ~350 ms mit, bis die Ladung faellt. Alle Zaehler (`ultTicks`, `stun`, `root` als uint8, `realm`) liegen additiv im State, `PROTOCOL_V` bleibt 1.
  - Ults: Blobby Blasenflut (Feuerrate x2.5), Cuby Bollwerk (20 % Schaden), Zappy Blitzrausch (+60 % Tempo, flottere Waffe), Hexo Todesnadel
    (naechster Schuss riesig, x2.4 Schaden), Boo Geisterwelt, Kitty Schattensprung.
  - Geisterwelt (Boo): Zielauswahl entlang der Zielrichtung (`ultTargetScore`, gleiche Funktion auf Server und Client fuer die Markierung), Boo springt neben das Ziel;
    beide bekommen dieselbe `realm`-Nummer. Treffer, Kollision und Pickups gelten nur innerhalb derselben `realm`; der Client blendet fremde Welten aus und
    zeichnet dunkle Welt + Geister-Partikel. Ziel ist 5 s gewurzelt (`root`), Boo 1.5x schneller. Ende bei Ablauf oder Tod/Verlassen eines Beteiligten.
  - Schattensprung (Kitty): Sprung neben das anvisierte Ziel (650 px, Zielkegel), 2 s Betaeubung (`stun`: weder Bewegung noch Schuss).
  - Prediction: Tempo = `effectiveSpeed(klasse, ultTicks)`; bei `stun`/`root` sagt der Client keine Bewegung voraus (Teleports > 90 px werden gesnappt).
  - Charakterwechsel: Nachricht `skin` (Zod-validiert, 5/s) nur waehrend man tot ist; wirkt beim Respawn (HP/Waffe/Tempo der neuen Klasse).
  - Zielbalken: transparenter Streifen vom eigenen Charakter in Zielrichtung (Laenge = Waffenreichweite, an Waenden per Strahltest gekappt).
- Serverlast: alle Ult-Pfade sind O(Spieler) einmalig beim Ausloesen bzw. O(1) pro Treffer/Tick; keine neuen Entities. Einzige Dauerlast: Status-Zaehler pro lebendem Spieler.

## ADR-008: Ult-Rework und Ult-Joystick mit Pre-Aim
- Status: akzeptiert (2026-10-17)
- Entscheidung:
  - Ults ersetzt (`UltKind` rocket/slam/beam/field/ghost/pounce): Hexo **Weltenstrahl** (breiter, schneller Strahl ueber die ganze Karte, ignoriert Hindernisse, One-Shot),
    Zappy **Elektrofeld** (Gegner im Radius 50 % langsamer, Tick-Schaden, leichtes Autoaim), Cuby **Riesenwuerfel** (Einschlag = One-Shot, Schockwelle mit Rueckstoss),
    Blobby **Raketenflug** (fliegt ueber Hindernisse, explodiert ueber Gegnern = One-Shot im Radius + Kugelsalve, Respawn an anderer Stelle). Boo und Kitty unveraendert.
  - One-Shot = `ONE_SHOT` Schaden ohne Ult-Ladung (`charge=false`). Rakete laeuft rein serverseitig (immun, kein Schiessen, kein Client-Prediction).
  - Ausloesen: Input `ult` plus optional `ua` (Winkel) und `ud` (Distanz 0..1); idempotent wie zuvor. `PROTOCOL_V` bleibt 1.
  - Ult-Joystick (`UltControl.ts`): Tippen = sofort mit aktuellem Ziel, Ziehen ueber die Totzone = Pre-Aim-HUD je Ult-Art, Loslassen loest aus, zurueck zur Mitte + Loslassen
    bricht ab. Desktop: Q halten = Pre-Aim zur Maus, loslassen = ausloesen, Esc = abbrechen.
- Serverlast: unveraendert O(Spieler) pro Ausloesung; Feld/Rakete O(Spieler) pro Tick nur waehrend aktiver Ult.
