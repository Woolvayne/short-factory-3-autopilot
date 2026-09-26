/**
 * Lädt die `.env` aus dem Projektroot VOR allem anderen.
 *
 * Dieses Modul hat nur Seiteneffekte und muss in `server/index.mjs` als
 * ALLERERSTER Import stehen: ESM wertet Imports in Quellreihenfolge aus —
 * so sehen `gate.mjs` (APP_PASSWORD) und `zernio.mjs` (ZERNIO_API_KEY) die
 * Werte schon beim Modul-Load.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "./http.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(ROOT, { readFileSync, join });
