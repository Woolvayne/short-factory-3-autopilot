/**
 * Der EINE Start-Knopf: `npm start`
 *
 *   1. fehlt `dist/index.html`, wird die App einmal gebaut (vite) —
 *      auf einem Raspberry Pi dauert das einmal ~1–2 Minuten, danach nie wieder
 *   2. danach startet der eingebaute Server (App + /api/auth + /api/tts + /api/zernio)
 *
 * Mehr ist nicht nötig. Beenden mit Strg+C. Neu bauen: `npm run build`.
 */

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(ROOT, "dist", "index.html");

if (!existsSync(BUNDLE)) {
  console.log("");
  console.log("  dist/index.html fehlt — baue die App einmalig (das kann auf einem Pi eine Minute dauern)…");
  console.log("");
  const npm = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawnSync(npm, ["vite", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (child.status !== 0) {
    console.error("");
    console.error("  ✖ Build fehlgeschlagen. Lief `npm install` schon durch? Dann erneut: npm start");
    process.exit(child.status ?? 1);
  }
}

await import("../server/index.mjs");
