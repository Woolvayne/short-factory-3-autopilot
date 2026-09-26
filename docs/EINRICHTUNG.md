# Einrichtung — Schritt für Schritt (Deutsch)

Die komplette Fabrik läuft mit **einem Befehl auf deinem eigenen Rechner** — auch auf einem
**Raspberry Pi**. Keine Cloud, kein Deploy, keine Serverless-Funktionen mehr.

```
┌──────────────────────────────────────────────┐
│  npm start   (oder: ./start.sh)              │
│  → baut die App einmal automatisch           │
│  → startet den eingebauten Server            │
│  → http://localhost:8080 im Browser öffnen   │
└──────────────────────────────────────────────┘
```

---

## 1 · Voraussetzungen

**Nur Node.js (Version 18 oder neuer).** Prüfen mit `node --version`.

- **Raspberry Pi OS / Debian / Ubuntu:**
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **macOS:** `brew install node` (oder Installer von nodejs.org)
- **Windows:** Installer von nodejs.org (LTS), danach PowerShell neu öffnen.

## 2 · Fabrik holen & starten

```bash
cd short-factory-3-autopilot       # das Repo-Verzeichnis
npm install                        # einmalig: Dependencies
npm start                          # startet alles
```

Beim ersten Start erscheint „dist/index.html fehlt — baue die App einmalig…“ — das ist normal
(auf dem Pi ~1–2 Minuten, danach nie wieder, solange du nicht neu bauen willst: `npm run build`).

Fertig — Browser auf: **http://localhost:8080**. Aus dem Heimnetz erreichst du die Fabrik auch
unter `http://<IP-deines-Geräts>:8080` (z. B. `http://192.168.1.60:8080`).

### Der extra-einfache Pi-Knopf

```bash
./start.sh
```

Das Skript prüft Node, installiert die Dependencies, wenn sie fehlen, baut die App und startet
den Server. Ein Doppelklick-/Ein-Befehl-Erlebnis für sehr einfache Rechner.

## 3 · Die .env anlegen (optional, aber empfohlen)

```bash
cp .env.example .env
nano .env        # (oder ein beliebiger Editor)
```

| Variable | Zweck |
| --- | --- |
| `APP_PASSWORD` | **Passwortschutz** vor der ganzen Seite (empfohlen, sobald die Fabrik im Netz erreichbar ist) |
| `APP_PASSWORD_HASH` | Alternative: SHA-256 statt Klartext → `npm run password:hash` |
| `APP_MAX_ATTEMPTS` | Fehlversuche bis zur IP-Sperre (Standard **5**) |
| `APP_LOCKOUT_MINUTES` | Sperr-Stufen, eskalierend (Standard **5,15,60,360,1440**) |
| `APP_SESSION_TTL` | Sitzungsdauer in Sekunden (Standard **43200** = 12 h) |
| `ZERNIO_API_KEY` | API-Key von zernio.com → aktiviert den Versand (Panel 06) |
| `PORT` | Port des Servers (Standard **8080**) |

**Nach jeder .env-Änderung:** Server einmal neu starten (`Strg+C`, dann wieder `npm start`).

## 4 · Passwortschutz (APP_PASSWORD)

- Eine einzige Seite liegt vor der App: Passwort rein → Fabrik öffnet sich.
- Geprüft wird **serverseitig** — das Passwort liegt nie im Browser-Bundle.
- Nach **5 Fehlversuchen in Folge** wird die **IP** gesperrt: **5 min → 15 min → 1 h → 6 h →
  24 h** (jede weitere Sperre eskaliert). Die Zähler laufen **im Server-Prozess** — ein Neustart
  setzt sie zurück.
- **Nach jedem Neuladen (F5) wird das Passwort erneut verlangt** — das Sitzungs-Token lebt nur
  Arbeitsspeicher des Tabs (kein Cookie, kein localStorage).
- Der Button **SPERREN** oben rechts sperrt die App sofort wieder.
- Ohne `APP_PASSWORD` öffnet sich die Seite direkt („offen“).

**Passwort ändern:** neuen Wert in die `.env` → `npm start` neu aufrufen. Kein Rebuild nötig.

### Lokal verstehen: was passiert ohne Server-Passwort?

Gibt es kein `APP_PASSWORD`, ist die App offen. Du kannst zusätzlich in der App unter
`00 → APP` einen **lokalen Schutz für dieses Gerät** setzen (SHA-256 im Browser, mit
Fehlversuch-Sperre). Das ist ein ehrlicher Sichtschutz — die Server-Variante ist der echte
IP-Schutz und darum die Empfehlung.

## 5 · Zernio-Versand (ZERNIO_API_KEY)

1. Account auf **zernio.com** → API-Bereich → Key kopieren (Format `sk_…`).
2. In die `.env` schreiben: `ZERNIO_API_KEY=sk_…` → Server neu starten.
3. In Zernio mindestens **einen Social-Account verbinden** (TikTok, YouTube, Instagram, …).
4. In der App: Panel **06 · ZERNIO VERSAND** zeigt grün „ZERNIO VERBUNDEN · SERVER (.env)“ und
   listet deine Accounts.

Der Key liegt **ausschließlich auf deinem Rechner** — der Browser sieht ihn nie; der eingebaute
Server reicht die Uploads/Posts weiter. (Ausnahme: Läuft die App rein statisch ohne Server,
kannst du den Key direkt in Panel 06 als **APP-KEY** eintragen — dann bleibt er im
Browser-Speicher dieses Rechners und der Browser spricht direkt mit zernio.com.)

**Sendeplan-Baukasten (Panel 06):** SOFORT · 06 & 20 UHR (Standard, frei anpassbar, bis zu 24
Zeiten) · EIGENE ZEIT pro Video · FLEXIBEL = Startzeit + Abstand. Zwischen jedem Versand liegen
**3 s Pflichtpause** (Plattform-freundlich).

## 6 · Autopilot — der eine Knopf für alles

Panel **AP · AUTOPILOT** oben in der Fabrik:

1. Einstellen: **Videos pro Sendung** (z. B. 2) und **Abstand** (z. B. 1 Std = alle 60 Minuten).
2. Optional: **erste Sendung sofort**, **Ideen automatisch nachfüllen**, **Endlos-Loop**.
3. **AUTOPILOT STARTEN** → die Fabrik produziert 10 Videos und versendet sie in Wellen —
   mit Live-Countdown zur nächsten Welle, Wellen-Matrix und Protokoll.
4. **AUTOPILOT STOPP** beendet jederzeit sauber (aktuelle Welle endet noch).

> ⚠️ **Der Tab muss offen bleiben** — Autopilot, Render-Mühle und die Versand-Uhr laufen im
> Browser. Während des Renderns sollte der Tab im Vordergrund sein (Browser drosseln
> Hintergrund-Tabs). Der Pi/Server darf zwischendurch schlafen/headless laufen, solange er die
> App ausliefert — aber der Browser-Tab macht die Arbeit.

## 7 · Raspberry-Pi-Kurzfassung

```bash
# Node.js (einmalig)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Fabrik
git clone <dieses-repo> && cd short-factory-3-autopilot
cp .env.example .env && nano .env     # APP_PASSWORD + ZERNIO_API_KEY eintragen
./start.sh                            # → http://<pi-ip>:8080
```

- Der **erste Build** dauert auf dem Pi 1–2 Minuten — danach startet alles in Sekunden.
- Die Fabrik rendert Videos im Browser vor dem Bildschirm, nicht auf dem Pi: **CPU/RAM des Pi
  werden kaum belastet** (Pi 3 reicht; Pi Zero 2 W geht auch, der Build ist dort nur geduldiger —
  im Zweifel einmal auf schnellerem Rechner `npm run build` ausführen und `dist/` mitkopieren).
- Autostart: `docs/ANLEITUNG.md → Kapitel 7` (systemd-Dienst).

## 8 · Troubleshooting

| Problem | Lösung |
| --- | --- |
| „dist/index.html fehlt“ | `npm run build` ausführen (oder einfach `npm start` — baut selbst) |
| Port 8080 belegt | `PORT=8090 npm start` (oder in die `.env`: `PORT=8090`) |
| Stimmen gehen nicht | Internet prüfen (Edge-Stimmen brauchen Netz); der Status-Text in `00 → VOICE` sagt, ob der Server-Relay oder die Browser-Engine aktiv ist |
| Zernio „NOCH NICHT VERBUNDEN“ | `ZERNIO_API_KEY` in die `.env` + Server neu starten → Panel 06 → Button **API** |
| „Key ok, aber kein Social-Account“ | auf zernio.com/dashboard einen Account verbinden |
| „IP GESPERRT“ beim Login | Countdown abwarten (Standard: 5 min, eskalierend) — oder Server neu starten (setzt In-Memory-Zähler zurück) |
| Nach Deploy-Änderungen nichts passiert | immer: `Strg+C` → `npm start` (Env wird beim Start gelesen) |

Weiterführend: **[docs/ANLEITUNG.md](ANLEITUNG.md)** (Autostart, Internet-Freigabe/Tailscale,
Hardware-Hinweise, technischer Überblick).
