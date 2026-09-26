/**
 * ShortsFactory v4 — der EINE Server für alles. Ein Kommando genügt:
 *
 *     npm start          (baut dist/ bei Bedarf nach und startet hierher)
 *
 * Läuft auf jedem einfachen Rechner — auch einem Raspberry Pi: nur Node.js
 * (≥ 18) plus die eine Laufzeit-Dependency `ws`. Kein Express, kein Vercel,
 * keine Cloud.
 *
 * Was dieser eine Prozess kann:
 *   • liefert die fertig gebaute App aus (dist/index.html — Singlefile-Bundle)
 *   • /api/health  → Lebenszeichen, damit das Frontend den Server erkennt
 *   • /api/auth    → Onepage-Passwortgate mit IP-Rate-Limit (serverseitig)
 *   • /api/tts     → Edge-Read-Aloud-Relay (Stimmen + echte Wort-Timings)
 *   • /api/zernio  → Versand an Zernio (Key bleibt auf dem Server, .env)
 *   • /api/zernio/upload → Upload-Relay, falls Storage den Browser-Direktupload blockt
 *
 * Konfiguration: optional als `.env` im Projektroot (wird hier eingelesen):
 *   APP_PASSWORD / APP_PASSWORD_HASH, ZERNIO_API_KEY, PORT (Standard 8080), HOST
 */

import "./env.mjs"; /* MUSS der erste Import bleiben: lädt die .env vor allen Handlern */

import http from "node:http";
import { existsSync, statSync, createReadStream } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseQuery, readBody, wrapRes } from "./http.mjs";
import authHandler from "./auth.mjs";
import ttsHandler from "./tts.mjs";
import zernioHandler from "./zernio.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist");

const PORT = Math.max(1, Number.parseInt(process.env.PORT ?? "", 10) || 8080);
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** Statische Datei aus dist/ ausliefern (mit Pfad-Traversal-Schutz). */
function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  let filePath = normalize(join(DIST, urlPath));
  if (!filePath.startsWith(DIST)) {
    res.statusCode = 403;
    return res.end("forbidden");
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    /* SPA-Fallback: alles Nicht-Dateiartige → index.html */
    filePath = join(DIST, "index.html");
    if (!existsSync(filePath)) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end(
        "dist/index.html fehlt — erst einmal bauen: `npm run build` (oder einfach `npm start`, das baut automatisch)."
      );
    }
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream");
  res.setHeader("Cache-Control", filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable");
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (reqRaw, resRaw) => {
  const res = wrapRes(resRaw);
  const req = reqRaw;
  const pathname = (req.url || "/").split("?")[0];
  req.query = parseQuery(req.url || "/");

  try {
    /* ---------------- API-Routen ---------------- */
    if (pathname === "/api/health") {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        ok: true,
        service: "shortsfactory",
        version: 4,
        time: new Date().toISOString(),
        auth: Boolean(process.env.APP_PASSWORD || process.env.APP_PASSWORD_HASH),
        zernio: Boolean((process.env.ZERNIO_API_KEY || "").trim()),
      });
    }

    if (pathname === "/api/auth") {
      req.body = (await readBody(req, 64 * 1024)).toString("utf8");
      return await authHandler(req, res);
    }

    if (pathname === "/api/tts") {
      req.body = (await readBody(req, 1 * 1024 * 1024)).toString("utf8");
      return await ttsHandler(req, res);
    }

    if (pathname === "/api/zernio/upload" || pathname.startsWith("/api/zernio/upload")) {
      /* roher Video-Upload — der handler liest den Stream selbst (512 MB) */
      req.body = undefined;
      return await zernioHandler(req, res);
    }

    if (pathname === "/api/zernio") {
      req.body = (await readBody(req, 1 * 1024 * 1024)).toString("utf8");
      return await zernioHandler(req, res);
    }

    if (pathname.startsWith("/api/")) {
      return res.status(404).json({ ok: false, error: `Unbekannte Route: ${pathname}` });
    }

    /* ---------------- Statische App ---------------- */
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);

    res.statusCode = 405;
    res.end("method not allowed");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === "PAYLOAD_TOO_LARGE") {
      return res.status(413).json({ ok: false, error: "Request-Body zu groß für diese Route." });
    }
    console.error("[server]", message);
    return res.status(500).json({ ok: false, error: `Serverfehler: ${message.slice(0, 200)}` });
  }
});

server.listen(PORT, HOST, () => {
  const maskKey = (v) => (v ? `${v.slice(0, 4)}…${v.slice(-4)} (${v.length} Zeichen)` : "—");
  console.log("");
  console.log("  ┌──────────────────────────────────────────────────────────┐");
  console.log("  │  SHORTSFACTORY v4 — ein Server, ein Knopfdruck            │");
  console.log("  └──────────────────────────────────────────────────────────┘");
  console.log("");
  console.log(`  App läuft:        http://localhost:${PORT}`);
  console.log(`  Im Heimnetz auch: http://<IP-DES-GERÄTS>:${PORT}`);
  console.log(
    `  Passwort-Gate:    ${(process.env.APP_PASSWORD || process.env.APP_PASSWORD_HASH) ? "AKTIV" : "aus (APP_PASSWORD optional in .env)"}`
  );
  console.log(`  ZERNIO_API_KEY:   ${maskKey((process.env.ZERNIO_API_KEY || "").trim())}`);
  console.log(
    `  App-Bundle:       ${existsSync(join(DIST, "index.html")) ? "dist/index.html ✔" : "FEHLT — `npm run build` ausführen"}`
  );
  console.log("");
  console.log("  Beenden: Strg+C");
  console.log("");
});
