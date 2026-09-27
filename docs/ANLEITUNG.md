# Anleitung — technischer Überblick & Entwicklung (Deutsch)

Die Fabrik ist **eine reine Frontend-App** (`src/`), die zu **einer einzigen HTML-Datei**
(`dist/index.html`) gebaut wird. Es gibt keinen mitlaufenden Server, keinen Node-Prozess im
Betrieb und keine Cloud-Funktion — alles passiert im Browser des Geräts, das gerade geöffnet ist.

---

## 1 · Architektur

```
Browser (die Fabrik-UI, dist/index.html)
   │
   ├─ Ideen/Skripte:  KI-Provider (Qwen/Mistral, optionaler eigener Key) ODER Offline-Generator
   ├─ Stimmen:        freie Sprach-Engine, direkt aus dem Browser angesprochen (kein Key)
   ├─ Rendern:        Canvas + MediaRecorder — komplett lokal, kein Upload nötig
   └─ Versand:        Zernio-API direkt aus dem Browser (eigener API-Key, im localStorage)
```

- **Build**: `vite build` mit `vite-plugin-singlefile` — JS/CSS werden vollständig in
  `dist/index.html` inline gebündelt. Das Ergebnis ist eine einzelne, portable Datei
  (~600 KB, ~180 KB gzip).
- **Kein Server-Ordner mehr**: Frühere Versionen hatten einen kleinen Node-Server für
  Passwort-Gate, TTS-Relay und Zernio-Relay (gedacht auch für den Betrieb auf einem
  Raspberry Pi). Der wurde vollständig entfernt — alle drei Aufgaben laufen jetzt direkt im
  Browser (siehe unten), damit die App wirklich nur noch eine Webseite ist, die überall läuft.
- **Alles bleibt auf dem Gerät**: Passwort-Hash, API-Keys und Einstellungen liegen ausschließlich
  im `localStorage` des jeweiligen Browsers.

## 2 · Passwort-Gate (`src/lib/gate.ts`)

- Passwort wird als **SHA-256** im `localStorage` gespeichert, nie im Klartext.
- Fehlversuch-Sperre pro Gerät: `DEFAULT_LOCKOUT_MINUTES = [5, 15, 60, 360, 1440]`,
  `LOCAL_MAX_ATTEMPTS = 5`. Zähler liegen ebenfalls im `localStorage`.
- Sitzungs-Token lebt nur im Arbeitsspeicher des Tabs (`sessionToken`-Variable) — ein Reload
  verlangt das Passwort erneut.
- Ohne gesetztes Passwort ist die App offen (`GateMode = "off"`).

## 3 · Stimmen (`src/lib/tts.ts`)

- Spricht den freien Web-TTS-Endpunkt von StreamElements direkt aus dem Browser an (kein Key).
- Wort-Timings werden aus der gemessenen Audio-Dauer geschätzt (Gewichtung nach Buchstabenzahl
  und Satzzeichen, `estimateWordTimings`).
- Sprechtempo ±40 % wird per `OfflineAudioContext` offline in die Audiodatei gerendert
  (`stretchBuffer`), das Ergebnis wird als PCM-WAV weitergereicht.
- Stimmenliste: `src/lib/settings.ts` (`VOICES`); `FALLBACK_VOICE_MAP` in `src/lib/tts.ts` mappt
  sie auf die tatsächlich verfügbaren Browser-Stimmen.

## 4 · Zernio-Versand (`src/lib/zernio.ts`)

- Upload-Weg: Video-Blob → `media/presign` → **direkter PUT** an den Storage →
  `POST /v1/posts` mit `mediaItems`. Alles direkt aus dem Browser, kein Zwischenserver.
- **3 s Pflichtpause** zwischen je zwei Videos (`SHIP_GAP_MS`), auch im Autopilot eingehalten.
- Sendepläne (Panel 06): SOFORT · SLOT-ZEITEN („06 & 20 UHR“, bis 10 Zeiten, Übernacht-fähig)
  · EIGENE ZEITEN pro Video · FLEXIBEL (Start + Abstand in Minuten). Zeitzone: **Europe/Berlin**.
- `fetchPostStatus` kann danach den Versandstatus eines Posts prüfen.

## 5 · Autopilot (`src/lib/autopilot.ts`, `src/components/AutopilotPanel.tsx`)

- Logik komplett im Frontend (`src/App.tsx`).
- Zyklus: **Ideen → Skripte+Stimmen → Rendern → Sendewellen**. Wellen = `done` Units aufgeteilt
  in `perWave`-Häppchen, Abstand `intervalMinutes`; `firstWaveNow` startet sofort, sonst erst
  nach einem vollen Intervall.
- `loopForever` räumt nach dem Versand den Tisch ab (Blobs, Stimmen-Cache, Versand-Stände),
  mischt die Clips neu und startet den nächsten Zyklus mit frischen Ideen.
- STOPP bricht Vorbereitung, Render-Loop, Versand-Queue und Wellen-Warten sauber ab.

### Wake-Lock (`src/lib/wakeLock.ts`)

- Solange gerendert wird oder der Autopilot läuft, fordert `App.tsx` per
  `navigator.wakeLock.request("screen")` einen **Screen Wake Lock** an — das Betriebssystem
  dimmt/sperrt den Bildschirm währenddessen nicht.
- Wird der Tab versteckt (Browser-Wechsel), gibt der Browser den Lock automatisch frei; beim
  Zurückkehren fordert `wakeLock.ts` ihn automatisch neu an (`visibilitychange`-Listener).
- Unterstützt der Browser die API nicht (ältere Firefox-/Safari-Versionen), zeigt
  `AutopilotPanel.tsx` das klar an („KEIN WAKE-LOCK“) — die App funktioniert trotzdem, nur ohne
  automatischen Schutz vor OS-Standby.
- Rendern selbst läuft **sequenziell** (ein Video nach dem anderen, siehe `renderIndexes` in
  `src/App.tsx`), das hält Last und Speicherbedarf auch auf schwacher Hardware niedrig.

## 6 · Bedien-Anleitung (normaler Weg, ohne Autopilot)

1. **00 · Machine Settings** — Stimme, Story-Stil/Länge/Temperatur, Captions, Intro-Karte,
   Video-Qualität. Optional: Qwen-/Mistral-Key (bleibt im Browser) für echte KI-Texte.
2. **01 · Ideas** — zehn Titel tippen, KI ×10 (mit Keys) oder Offline-Generator füllt sie.
3. **02 · Clip Mill** — EIN langes Video importieren (Datei oder Link) → wird in 10 verschiedene
   Momente geschnitten (CLIPS-Tab: Länge/Auto/`REROLL`). Alternativ 10 einzelne Dateien laden.
4. **03 · Music** — optional Hintergrund-Musik.
5. **04 · Assembly** — **PREPARE** (Skripte + Stimmen) → **RENDER ALL**.
6. **05 · Output Bay** — Vorschau, einzeln herunterladen, als ZIP (`BUILD ZIP`) — oder → Zernio.
7. **06 · Zernio Versand** — Sendeplan wählen, Versand starten. Protokoll & Status pro Video.

## 7 · Betrieb & Hosting

Es gibt keinen Prozess, den man „am Laufen halten“ müsste. Optionen:

- **Lokal**: `dist/index.html` per Doppelklick öffnen.
- **Im Heimnetz teilen**: `npx serve dist` (oder ein beliebiger anderer simpler Static-Server)
  auf einem Gerät starten, im Netz von jedem anderen Gerät per Browser öffnen.
- **Dauerhaft online, ohne eigenen Rechner**: `dist/index.html` auf GitHub Pages, Netlify,
  Cloudflare Pages o. Ä. hochladen.
- **Update**: `git pull && npm install && npm run build`, danach die neue `dist/index.html`
  erneut verteilen/hochladen.

## 8 · Entwicklung

- `npm run dev` — Vite-Devserver mit Hot-Reload (für UI-Arbeit).
- `npm run typecheck`, `npm run build` — Qualitätstore.
- `npm run preview` — testet den fertigen Build lokal über HTTP.
- Ordner: `src/` (die gesamte App), `docs/` (diese Doku).
- Frühere Server- (`server/`), Start-Skript- (`scripts/start.mjs`, `start.sh`) und
  Vercel-/Supabase-Reste wurden **vollständig entfernt** — es gibt keinen Backend-Pfad mehr.
