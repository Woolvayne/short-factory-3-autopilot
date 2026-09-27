# ShortsFactory · Autopilot

**Ein Clip rein, zehn Shorts raus — 100 % im Browser, kein Server, kein Install.**
Kein Cloud-Deploy, kein Node-Prozess, kein Raspberry-Pi-Setup: Die App ist eine einzige
HTML-Datei, die überall läuft, wo ein aktueller Browser läuft — vom Gaming-PC bis zum
zehn Jahre alten Laptop.

```
npm install       # einmalig, nur zum BAUEN (nicht zum Benutzen nötig)
npm run build     # baut dist/index.html — eine einzige Datei, das war's
```

Danach reicht: **`dist/index.html` doppelklicken** (öffnet sich direkt im Browser) — oder die
Datei auf einen beliebigen Static-Host legen (GitHub Pages, Netlify, ein USB-Stick, …). Fertig.
Kein Terminal, kein Port, kein `.env`, kein „Server neu starten“.

> **Live-Vorschau (Sandbox):** Die App läuft gerade hier via `npm run preview` — Test-Host:
> `https://8080-<sandboxId>.e2b.app` (siehe Prozess-Panel). Für den echten Einsatz reicht die
> einzelne `dist/index.html`, ganz ohne laufenden Prozess.

> **📖 Einrichtung (Deutsch, Schritt für Schritt):** [docs/EINRICHTUNG.md](docs/EINRICHTUNG.md)
> · **Details & Technik:** [docs/ANLEITUNG.md](docs/ANLEITUNG.md)

---

## Was das Ding macht

1. **10 Ideen** — per KI (Qwen/Mistral-Key, nur im Browser) oder mit dem eingebauten
   Offline-Generator.
2. **10 Skripte + 10 Stimmen** — eine freie Sprach-Engine läuft direkt im Browser, kein Key,
   kein Server nötig.
3. **10 Videos rendern** — komplett **im Browser** (Canvas + MediaRecorder): Untertitel im
   Wort-Takt, Reddit-Intro-Karte, Hintergrund-Gameplay, Musik. Ein Video nach dem anderen —
   leichtgewichtig genug für schwache Hardware, ohne dass die Qualität leidet.
4. **Versand über Zernio** — Panel `06 · ZERNIO VERSAND`: sofort, geplante Slots (06/20 Uhr),
   eigene Zeiten pro Video oder flexible Serie mit Abstand. Pflichtpause von 3 Sekunden zwischen
   jedem Video ist eingebaut. Der API-Key bleibt im Browser-Speicher dieses Geräts.
5. **AUTOPILOT** — Panel `AP`: **ein Knopf**, dann läuft alles obige automatisch. Danach geht
   **alle N Minuten** eine **Sendewelle** mit X Videos an Zernio raus (z. B. alle 60 Min je 2 —
   frei einstellbar), mit Live-Countdown, Wellen-Anzeige und Protokoll. Optional
   **Endlos-Loop**: Nach dem Versand startet der nächste Zyklus mit frischen Ideen.
   ⚠️ Wichtig: Der **Tab muss offen bleiben** — Fabrik, Render-Mühle und Versand-Uhr laufen im
   Browser. Die App fordert dafür automatisch einen **Wake-Lock** an, damit der Bildschirm
   während des Laufs nicht einschläft (unterstützt der Browser das nicht, bitte den
   Auto-Standby des Geräts kurz manuell deaktivieren).

## Architektur auf einen Blick

```
dist/index.html   ← eine einzige Datei (Vite-Singlefile-Bundle), ~180 KB gzip
   │
   ▼
läuft NUR im Browser — keine Backend-Aufrufe außer:
   ├─ freie Sprach-Engine (Text → Sprache, kein Key)
   ├─ optional: Qwen/Mistral (KI-Texte, nur mit eigenem Key)
   └─ Zernio-API (Versand, nur mit eigenem Key)
```

- **Kein Server**: Passwortschutz, API-Keys und Einstellungen liegen ausschließlich im
  `localStorage` dieses Geräts. Niemand außer dir sieht sie.
- **Läuft auf jeder Kartoffel**: Ein React-Build ohne schwere Video-Bibliotheken, das Rendern
  passiert sequenziell (ein Video nach dem anderen) direkt im Canvas des Tabs — das reicht für
  alte Laptops, Tablets, oder einen Raspberry Pi mit aktuellem Browser, ohne dass die
  Video-Qualität sinkt.
- **Kein Tracking, keine Cloud-Abhängigkeit**: Videos verlassen dein Gerät nur dorthin, wo sie
  hingehören (Zernio-API, Sprach-Engine, optional KI-Provider).

## Voraussetzungen

| Was | Wofür |
| --- | --- |
| Ein aktueller Browser (Chrome/Edge/Firefox/Safari) | **die ganze App** — mehr braucht es nicht |
| Node.js ≥ 18 | **nur** zum einmaligen Bauen (`npm run build`), nicht zum Benutzen |
| Zernio-Account + API-Key (`sk_…`) | Versand (Panel 06), im Browser eingetragen |
| (Optional) Qwen-/Mistral-Key | echte KI-Ideen/Skripte statt Offline-Generator |

## Schnellstart

```bash
npm install          # einmalig, nur für den Build
npm run build         # erzeugt dist/index.html
```

Danach `dist/index.html` im Browser öffnen (Doppelklick) oder irgendwo statisch hosten. Zum
Entwickeln/Testen mit Hot-Reload: `npm run dev`.

## Projekt-Layout

```
src/        die React-App (Fabrik-Hall + alle Panels) — läuft komplett im Browser
docs/       deutsche Anleitungen
dist/       Build-Ergebnis: eine einzige index.html (wird von `npm run build` erzeugt; in .gitignore)
```

## Scripts

| Befehl | Zweck |
| --- | --- |
| `npm run build` | baut die eine `dist/index.html` — das eigentliche Ergebnis |
| `npm run dev` | Vite-Devserver mit Hot-Reload (für die Entwicklung) |
| `npm run preview` | testet den fertigen Build lokal über HTTP |
| `npm run typecheck` | TypeScript-Prüfung |
