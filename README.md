# ShortsFactory · Autopilot

**Ein Clip rein, zehn Shorts raus — auf Knopfdruck, mit einem eigenen kleinen Server.**
Kein Cloud-Deploy, kein Vercel, keine Funktionen: **ein Befehl** startet die komplette Fabrik auf
deinem Rechner — sie läuft sogar auf einem **Raspberry Pi**.

```
npm start          # oder doppelklickbar/kurz:  ./start.sh
```

Beim allerersten Start baut `npm start` die App automatisch (auf einem Pi einmalig ~1–2 Minuten).
Dann im Browser öffnen: **http://localhost:8080** (im Heimnetz: `http://<IP-des-Geräts>:8080`).

> **Live-Vorschau (Sandbox):** Die App läuft gerade hier — Entwicklungs-Test-Host:
> `https://8080-<sandboxId>.e2b.app` (Port 8080, siehe Prozess-Panel). Dorthin zeigt die
> Browser-Vorschau dieser Sitzung.

> **📖 Einrichtung (Deutsch, Schritt für Schritt):** [docs/EINRICHTUNG.md](docs/EINRICHTUNG.md)
> · **Details & Troubleshooting:** [docs/ANLEITUNG.md](docs/ANLEITUNG.md)

---

## Was das Ding macht

1. **10 Ideen** — per KI (Qwen/Mistral-Key, nur im Browser) oder mit dem eingebauten
   Offline-Generator.
2. **10 Skripte + 10 neurale Stimmen** — Edge-Read-Aloud-Stimmen mit echten Wort-Timings
   (der eingebaute Server spricht sie aus). Läuft die App ausnahmsweise rein statisch ohne
   Server, springt automatisch eine Browser-Stimmen-Engine ein.
3. **10 Videos rendern** — komplett **im Browser** (Canvas + MediaRecorder): Untertitel im
   Wort-Takt, Reddit-Intro-Karte, Hintergrund-Gameplay, Musik. Kein Server-Codieren — darum
   reicht auch ein Pi als Ablage-Ort.
4. **Versand über Zernio** — Panel `06 · ZERNIO VERSAND`: sofort, geplante Slots (06/20 Uhr),
   eigene Zeiten pro Video oder flexible Serie mit Abstand. Pflichtpause von 3 Sekunden zwischen
   jedem Video ist eingebaut.
5. **AUTOPILOT** — Panel `AP`: **ein Knopf**, dann läuft alles obige automatisch. Danach geht
   **alle N Minuten** eine **Sendewelle** mit X Videos an Zernio raus (z. B. alle 60 Min je 2 —
   frei einstellbar), mit Live-Countdown, Wellen-Anzeige und Protokoll. Optional
   **Endlos-Loop**: Nach dem Versand startet der nächste Zyklus mit frischen Ideen.
   ⚠️ Wichtig: Der **Tab muss offen bleiben** — Fabrik, Render-Mühle und Versand-Uhr laufen im
   Browser. Beim Rendern sollte der Tab im Vordergrund sein.

## Architektur auf einen Blick

```
npm start
  └─ scripts/start.mjs ── baut dist/ (einmalig) → startet server/index.mjs
       └─ server/ … genau EIN Node-Prozess, Abhängigkeiten: Node ≥ 18 + `ws`
            ├─ statische App (dist/index.html — Vite-Singlefile-Bundle)
            ├─ /api/health   Lebenszeichen (Frontend erkennt: „Server da“)
            ├─ /api/auth     Passwort-Gate (APP_PASSWORD, IP-Rate-Limit in-memory)
            ├─ /api/tts      Edge-Read-Aloud-Relay (Stimmen + Wort-Timings)
            └─ /api/zernio   Zernio-Relay (ZERNIO_API_KEY bleibt auf dem Rechner)
```

- **Ein Kommando**: `npm start` (baut bei Bedarf vorher `vite build`).
- **Raspberry-Pi-tauglich**: ARM, wenig RAM — der Server serviert nur Dateien und reicht API-Calls
  weiter; die Bildschirm-Arbeit (Rendern) macht der Browser des davor sitzenden Menschen.
- **Graceful Degradation**: Läuft die App rein statisch (irgendein Webserver, kein Node),
  erkennt das Frontend das über `/api/health` und schaltet automatisch um: Browser-Stimmen,
  Zernio-Direktmodus mit App-Key, lokaler Passwortschutz.
- **Alles bleibt zu Hause**: Videos, Keys und Passwort verlassen deinen Rechner nur dorthin, wo
  sie hingehören (Zernio-API, Stimmen-Endpoint, optional KI-Provider). Kein Tracking.

## Voraussetzungen

| Was | Wofür |
| --- | --- |
| **Node.js ≥ 18** | der eingebaute Server (`npm install && npm start`) |
| Moderner Browser (Chrome/Edge) | die Fabrik selbst + Hardware-näheres Rendern |
| Zernio-Account + API-Key (`sk_…`) | Versand (Panel 06), optional im `.env` |
| (Optional) Qwen-/Mistral-Key | echte KI-Ideen/Skripte statt Offline-Generator |

## Schnellstart

```bash
npm install          # einmalig
cp .env.example .env # optional: APP_PASSWORD / ZERNIO_API_KEY eintragen
npm start            # → http://localhost:8080
```

Auf dem **Raspberry Pi**: Repo klonen/kopieren → `./start.sh` → Fertig. Pi-spezifische Tipps
(Autostart via systemd, Internet-Freigabe, Chromium im Kiosk-Modus): [docs/ANLEITUNG.md](docs/ANLEITUNG.md).

## Projekt-Layout

```
server/     der eine Node-Server (kein Framework)
scripts/    start.mjs (Auto-Build) · hash-password.mjs (APP_PASSWORD_HASH-Werkzeug)
src/        die React-App (Fabrik-Hall + alle Panels)
docs/       deutsche Anleitungen
dist/       Build-Ergebnis (wird von npm start erzeugt/bedient; in .gitignore)
```

## Scripts

| Befehl | Zweck |
| --- | --- |
| `npm start` | **der Knopf**: baut bei Bedarf + startet den Server |
| `./start.sh` | Pi-/Linux-Variante: installiert sogar Dependencies mit |
| `npm run dev` | Vite-Devserver (nur Frontend-Entwicklung) |
| `npm run build` | produziert dist/index.html |
| `npm run typecheck` | TypeScript-Prüfung |
| `npm run password:hash` | SHA-256 für `APP_PASSWORD_HASH` |
