# Einrichtung — Schritt für Schritt (Deutsch)

Die komplette Fabrik läuft **100 % im Browser** — kein Server, kein Node-Prozess im Betrieb,
kein Deploy, keine Cloud-Funktionen. Das fertige Ergebnis ist **eine einzige HTML-Datei**, die du
öffnest wie jede andere Webseite auch.

```
┌───────────────────────────────────────────────────────┐
│  npm install && npm run build   (einmalig, nur bauen)  │
│  → erzeugt dist/index.html                             │
│  → Datei doppelklicken ODER irgendwo statisch hosten    │
│  → fertig, kein Server läuft mit                        │
└───────────────────────────────────────────────────────┘
```

---

## 1 · Die App bauen (einmalig)

Zum **Bauen** brauchst du kurz Node.js (Version 18 oder neuer) — **zum Benutzen später nicht
mehr**. Prüfen mit `node --version`.

```bash
cd short-factory-3-autopilot       # das Repo-Verzeichnis
npm install                        # einmalig: Dependencies
npm run build                      # erzeugt dist/index.html
```

Das dauert je nach Rechner ein paar Sekunden bis wenige Minuten (auf sehr schwacher Hardware
etwas länger) — und das **nur einmal**. Danach liegt in `dist/` genau eine Datei: `index.html`.
Diese Datei ist die komplette App, ca. 600 KB groß, keine weiteren Abhängigkeiten.

## 2 · Die App öffnen

Es gibt keinen Server, der „läuft“ — such dir einen der folgenden Wege aus:

- **Am einfachsten:** `dist/index.html` per Doppelklick im Dateimanager öffnen — der Browser
  startet die App direkt als lokale Datei (`file://…`). Für die eigene Nutzung völlig
  ausreichend.
- **Im Heimnetz teilen:** die Datei/den `dist/`-Ordner auf einen beliebigen simplen
  Static-Webserver legen (z. B. `npx serve dist` für einen Testlauf) und die URL im Browser
  jedes Geräts im Netz öffnen.
- **Dauerhaft online:** `dist/index.html` auf einen kostenlosen Static-Host hochladen (GitHub
  Pages, Netlify, Cloudflare Pages, …) — dann ist die App unter einer festen URL erreichbar,
  auch ohne dass irgendein eigener Rechner dafür laufen muss.

In allen drei Fällen ist es **dieselbe Datei mit derselben Funktion** — es gibt keinen
„Server-Modus“ mehr, der mehr könnte.

## 3 · Passwortschutz (optional, lokal auf diesem Gerät)

- Unter **Einstellungen → APP** kannst du ein Passwort setzen — geprüft wird per SHA-256 direkt
  im Browser dieses Geräts, kein Server ist beteiligt.
- Nach **5 Fehlversuchen in Folge** wird dieses Gerät gesperrt: **5 min → 15 min → 1 h → 6 h →
  24 h** (jede weitere Sperre eskaliert). Der Zähler lebt im `localStorage` des Browsers.
- **Nach jedem Neuladen (F5) wird das Passwort erneut verlangt** — das Sitzungs-Token lebt nur
  im Arbeitsspeicher des Tabs (kein Cookie).
- Der Button **SPERREN** oben rechts sperrt die App sofort wieder.
- Ohne gesetztes Passwort ist die Seite offen — das ist ein ehrlicher Sichtschutz für ein Gerät,
  kein Ersatz für echte Zugriffskontrolle bei einer öffentlich gehosteten Kopie.

**Passwort ändern/entfernen:** jederzeit unter Einstellungen → APP.

## 4 · Zernio-Versand (API-Key)

1. Account auf **zernio.com** → API-Bereich → Key kopieren (Format `sk_…`).
2. In der App: Panel **06 · ZERNIO VERSAND** → Feld **API-KEY** → Key eintragen.
3. In Zernio mindestens **einen Social-Account verbinden** (TikTok, YouTube, Instagram, …).
4. Panel 06 zeigt grün „ZERNIO VERBUNDEN“ und listet deine Accounts.

Der Key liegt **ausschließlich im Browser-Speicher (`localStorage`) dieses Geräts** — der
Browser spricht direkt mit `zernio.com`, es gibt keinen Zwischenserver, der ihn sehen könnte.

**Sendeplan-Baukasten (Panel 06):** SOFORT · 06 & 20 UHR (Standard, frei anpassbar, bis zu 10
Zeiten) · EIGENE ZEIT pro Video · FLEXIBEL = Startzeit + Abstand. Zwischen jedem Versand liegen
**3 s Pflichtpause** (Plattform-freundlich).

## 5 · Autopilot — der eine Knopf für alles

Panel **AP · AUTOPILOT** oben in der Fabrik:

1. Einstellen: **Videos pro Sendung** (z. B. 2) und **Abstand** (z. B. 1 Std = alle 60 Minuten).
2. Optional: **erste Sendung sofort**, **Ideen automatisch nachfüllen**, **Endlos-Loop**.
3. **AUTOPILOT STARTEN** → die Fabrik produziert 10 Videos und versendet sie in Wellen —
   mit Live-Countdown zur nächsten Welle, Wellen-Matrix und Protokoll.
4. **AUTOPILOT STOPP** beendet jederzeit sauber (aktuelle Welle endet noch).

> ⚠️ **Der Tab muss offen bleiben** — Autopilot, Render-Mühle und Versand-Uhr laufen im
> Browser dieses Tabs. Die App fordert dafür automatisch einen **Screen-Wake-Lock** an (Anzeige
> im Panel: „BILDSCHIRM WACH (WAKE-LOCK)“), damit das Betriebssystem den Bildschirm während des
> Laufs nicht abdunkelt oder sperrt. Unterstützt dein Browser das nicht (Anzeige „KEIN
> WAKE-LOCK“), deaktiviere den Auto-Standby des Geräts kurz manuell (Energieeinstellungen).

## 6 · Auf schwacher Hardware (alter Laptop, Tablet, Raspberry Pi, …)

Es gibt keinen separaten „Pi-Modus“ mehr — die App ist einfach eine Webseite, und die läuft
überall dort, wo ein aktueller Browser läuft:

- Das Rendern passiert **ein Video nach dem anderen** (nicht parallel), das hält die
  CPU-/RAM-Last niedrig, ohne die Video-Qualität zu verringern.
- Ist die Hardware sehr schwach, hilft es, in **Einstellungen → VIDEO** die Auflösung auf
  „540p“/„720p“ zu stellen statt „Auto“/„1080p“ — die App wählt für Touch-Geräte ohnehin
  automatisch eine kleinere Auflösung.
- Bau die App einmal auf einem schnelleren Rechner (`npm run build`) und kopiere nur die fertige
  `dist/index.html` auf das schwache Gerät — dort muss dann gar nichts mehr installiert oder
  gebaut werden, nur ein Browser reicht.

## 7 · Troubleshooting

| Problem | Lösung |
| --- | --- |
| „dist/index.html fehlt“ | `npm run build` einmal ausführen |
| Stimmen gehen nicht | Internet-Verbindung prüfen (die Sprach-Engine braucht Netz) |
| Zernio „NOCH NICHT VERBUNDEN“ | API-Key im Panel 06 eintragen → Button **API** klicken |
| „Key ok, aber kein Social-Account“ | auf zernio.com/dashboard einen Account verbinden |
| „GESPERRT“ beim Login | Countdown abwarten, oder unter Einstellungen → APP das Passwort neu setzen |
| Bildschirm schläft während des Autopilots ein | Browser aktualisieren (Wake-Lock ab Chrome/Edge 84, Safari 16.4, Firefox 126) oder Auto-Standby im Betriebssystem deaktivieren |

Weiterführend: **[docs/ANLEITUNG.md](ANLEITUNG.md)** (technischer Überblick, Entwicklung).
