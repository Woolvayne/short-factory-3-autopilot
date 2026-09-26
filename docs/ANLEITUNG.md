# Anleitung — technischer Überblick & Betrieb (Deutsch)

Die Fabrik besteht aus **genau einem Node-Prozess** (`server/`) plus einer Single-File-Frontend-App
(`dist/index.html`). Diese Datei erklärt, wie alles zusammenspielt, und sammelt Betriebs-Wissen.

---

## 1 · Architektur

```
Browser (die Fabrik-UI)
   │  same-origin fetch
   ▼
server/index.mjs  ← ein http-Server, kein Framework
   ├─ dist/index.html + Assets ausliefern (SPA-Fallback, MIME, Traversal-Schutz)
   ├─ GET  /api/health        → { ok, service:"shortsfactory", version:4, auth, zernio }
   ├─ /api/auth               → server/auth.mjs   (Passwort-Gate, IP-Rate-Limit in-memory)
   ├─ POST /api/tts           → server/tts.mjs    (Edge-Read-Aloud-Relay, Paket `ws`)
   ├─ /api/zernio             → server/zernio.mjs (status/presign/publish/post-status + Gate)
   └─ PUT/POST /api/zernio/upload → Upload-Relay für Storage-Direktuploads (512 MB)
```

- `.env` wird von **`server/env.mjs` geladen, noch bevor irgendein Handler-Modul importiert wird**
  (ESM-Auswertungsreihenfolge) — darum steht der Import ganz oben in `server/index.mjs`.
- **Kein `dist/` da?** `scripts/start.mjs` baut automatisch (`npx vite build`, einmalig) und
  startet danach. Zum selbst bauen: `npm run build`.
- Der Server bindet an **`0.0.0.0`** → im Heimnetz direkt unter `http://<IP>:8080` erreichbar.
  `PORT` (Standard 8080) und `HOST` sind per Env änderbar.

### Frontend: Relay zuerst, Fallback als Bonus

Das Frontend erkennt den Server an **`/api/health`** (JSON-Marker `service: "shortsfactory"`,
60 s Cache, `src/lib/relay.ts`). Ergebnis:

| Bereich | Mit Server (`npm start`) | Ohne Server (rein statisch) |
| --- | --- | --- |
| Stimmen | **`/api/tts`-Relay**: Edge-Stimmen, echte Wort-Timings | Browser-Engine (StreamElements → WAV), Timings geschätzt |
| Zernio | **Relay**: Key bleibt in der Server-`.env` | **Direktmodus**: Key in Panel 06 (Browser-Speicher) |
| Passwort | **serverseitig** (`APP_PASSWORD`, IP-Limit) | lokaler Schutz (Einstellungen → APP) |

Damit ist „der eine Knopf“ die volle Erfahrung — und eine statisch gehostete Kopie bleibt
ehrlich nutzbar.

## 2 · Passwort-Gate (serverseitig)

- `server/gate.mjs` hält die Rate-Limit-Daten **in-memory** (ein Prozess = ein Store; KV/Redis
  entfällt). Hash gespeicherter IP-Adressen (gesalzen), nie Klartext.
- Verschärfte Eskalation: `APP_LOCKOUT_MINUTES` (Standard `5,15,60,360,1440`), `APP_MAX_ATTEMPTS`
  (5), `APP_SESSION_TTL` (12 h).
- Token: HMAC-signiert (Secret erzeugt sich beim Start aus Passwort/Hash + Zufall — **Server-
  Neustart macht alle Sitzungen ungültig**, gewollt). Lebt im Browser nur im Tab-Speicher:
  **F5 = neu anmelden**.
- `APP_PASSWORD` (Klartext, empfohlen) **oder** `APP_PASSWORD_HASH` (SHA-256,
  `npm run password:hash`). Timing-safe Vergleich.
- API-Route `/api/zernio` verlangt das Token (`x-sf-auth` Header), sobald ein Gate konfiguriert
  ist; 401 → App zieht automatisch zurück zur Passwort-Seite (`GATE_EXPIRED_EVENT`).

## 3 · Stimmen (TTS)

- `server/tts.mjs` spricht Microsoft **Edge Read Aloud** (WebSocket, Paket `ws`): PCM-Audio
  24 kHz + **Sentence-/Word-boundary-Timings** → liefert `audioBase64` + `words[]` ans Frontend.
- Text wird in ≤ 4.096-Byte-SSML-Häppchen sequenziert; das Frontend setzt Stücke wieder
  zusammen (CBR-Kompensation) und bekommt so exakte Untertitel-Timings.
- Ohne Server springt die **Browser-Engine** ein (StreamElements → PCM-WAV, geschätzte Timings
  anhand Stretch-Faktor) — die Render-Pipeline ist identisch.
- Stimmenliste: `src/lib/settings.ts` (`VOICES`) — Edge-Voice-IDs; die Browser-Engine mappt sie
  intern auf ihre Stimmen (`FALLBACK_VOICE_MAP` in `src/lib/tts.ts`).

## 4 · Zernio-Versand

- Upload-Weg: Video-Blob → `media/presign` → **direkter PUT** an den Storage →
  `POST /v1/posts` mit `mediaItems`. Blockiert der Browser den PUT (CORS), greift automatisch das
  **Upload-Relay** `/api/zernio/upload` (nur mit Relay-signiertem Link).
- **3 s Pflichtpause** zwischen je zwei Videos (`SHIP_GAP_MS`), auch im Autopilot eingehalten.
- Sendepläne (Panel 06): SOFORT · SLOT-ZEITEN („06 & 20 UHR“, bis 24 Zeiten, `dd.MM.` über Nacht)
  · EIGENE ZEITEN pro Video · FLEXIBEL (Start + Abstand in Minuten). Zeitzone: **Europe/Berlin**.
- `post-status` kann danach papierlos geprüft werden („sent“ vs. „scheduled“ vs. Fehler).

## 5 · Autopilot

- Logik komplett im Frontend (`src/App.tsx`, Panel `src/components/AutopilotPanel.tsx`,
  Zustand/Planung `src/lib/autopilot.ts`).
- Zyklus: **Ideen → Skripte+Stimmen → Rendern → Sendewellen**. Wellen = `done` Units aufgeteilt
  in `perWave`-Häppchen, Abstand `intervalMinutes`; `firstWaveNow` startet sofort sonst erst nach
  einem vollen Intervall.
- `loopForever` räumt nach dem Versand den Tisch ab (Blobs, Stimmen-Cash, Versand-Stände),
  mischt die Clips neu und startet den nächsten Zyklus mit frischen Ideen.
- STOPP bricht Vorbereitung, Render-Loop, Versand-Queue und Wellen-Warten sauber ab.
- **Tab-Anforderung:** Autopilot lebt im Browser — Tab offen lassen; während des Renderns im
  Vordergrund halten (MediaRecorder drosselt im Hintergrund). „Videos pro Sendung“ und „Abstand“
  lassen sich nur im Ruhezustand ändern.

## 6 · Bedien-Anleitung (normaler Weg, ohne Autopilot)

1. **00 · Machine Settings** — Stimme, Story-Stil/Länge/Temperatur, Captions, Intro-Karte,
   Video-Qualität. Optional: Qwen-/Mistral-Key (bleibt im Browser) für echte KI-Texte.
2. **01 · Ideas** — zehn Titel tippen KI ×10 (mit Keys) oder Offline-Generator füllt sie.
3. **02 · Clip Mill** — EIN langes Video importieren (Datei oder Link) → wird in 10 verschiedene
   Momente geschnitten (CLIPS-Tab: Länge/Auto/`REROLL`). Alternativ 10 einzelne Dateien laden.
4. **03 · Music** — optional Hintergrund-Musik.
5. **04 · Assembly** — **PREPARE** (Skripte + Stimmen) → **RENDER ALL**.
6. **05 · Output Bay** — Vorschau, einzeln herunterladen, als ZIP (`BUILD ZIP`) — oder → Zernio.
7. **06 · Zernio Versand** — Sendeplan wählen, Versand starten. Protokoll & Status pro Video.

## 7 · Betrieb (Pi, Autostart, Fernzugriff)

### Autostart auf dem Pi (systemd)

```ini
# /etc/systemd/system/shortsfactory.service
[Unit]
Description=ShortsFactory Autopilot
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/pi/short-factory-3-autopilot
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=pi
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now shortsfactory
journalctl -u shortsfactory -f   # Logs
```

### Fernzugriff (optional)

Der Server spricht HTTP ohne TLS — für den Zugriff von außen **Tailscale** (WireGuard, kein
Port-Forwarding) oder einen Reverse-Proxy mit HTTPS (Caddy: `caddy reverse-proxy --from
fabrik.de --to :8080`) vorziehen. Mit `APP_PASSWORD` ist die Seite dabei zusätzlich geschützt.

### Update

```bash
git pull
npm install          # falls Abhängigkeiten geändert wurden
npm run build        # neues Bundle
systemctl restart shortsfactory   # bzw. Strg+C & npm start
```

## 8 · Entwicklung

- `npm run dev` — Vite-Devserver (Frontend-Hot-Reload, für UI-Arbeit). APIs brauchen
  `npm start` parallel (gleicher Origin-Probe → statischer Fallback-Merker im Health-Check
  verhindert Verwechslung mit dem Vite-SPA-Fallback).
- `npm run typecheck`, `npm run build` — Qualitätstore.
- Ordner: `server/` (Node), `src/` (React-App), `scripts/` (start/hash), `docs/` (diese Doku).
- Ehemalige Vercel-Function (`api/`) und Supabase wurden **vollständig entfernt** — es gibt
  keinen Cloud-Pfad mehr.
