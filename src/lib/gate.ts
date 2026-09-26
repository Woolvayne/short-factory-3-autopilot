/**
 * Onepage-Passwort-Gate — zwei Wege, automatisch gewählt:
 *
 *   1. **Eingebauter Server** (`npm start`, Pi/Heimserver): Die Prüfung läuft
 *      serverseitig über `/api/auth` — Passwort aus `APP_PASSWORD` /
 *      `APP_PASSWORD_HASH` (`.env`), IP-Rate-Limit mit eskalierenden Sperren.
 *   2. **Rein statische Seite** (kein Server erreichbar): Lokaler Schutz auf
 *      diesem Gerät — Passwort als SHA-256 im localStorage, gleiche Sperrlogik
 *      im Browser (Einstellungen → APP). Ehrlicher Sichtschutz ohne Server.
 *
 * In beiden Fällen gilt: Das Sitzungs-Token liegt NUR im Arbeitsspeicher des
 * Tabs → jedes Neuladen (F5) verlangt das Passwort erneut.
 */

import { probeBackend } from "./relay";

export type GateMode = "server" | "local" | "off";

/** Standard-Sperrstufen (Minuten). */
export const DEFAULT_LOCKOUT_MINUTES = [5, 15, 60, 360, 1440];
const LOCAL_MAX_ATTEMPTS = 5;

const LOCAL_HASH_KEY = "shortsfactory.gate.v1";
const LOCAL_RATE_KEY = "shortsfactory.gate.rate.v1";

export interface GateStatus {
  /** "server" = /api/auth aktiv · "local" = Schutz nur auf diesem Gerät · "off" = offen */
  mode: GateMode;
  requirePassword: boolean;
  serverReachable: boolean;
  locked: boolean;
  retryAfterSeconds: number;
  lockedUntil: number | null;
  attemptsLeft: number;
  failures: number;
  level: number;
  maxAttempts: number;
  schedule: number[];
  nextLockoutMinutes: number;
  store: "redis" | "memory" | "browser";
  sessionTtlSeconds: number;
  error?: string;
}

export const FALLBACK_STATUS: GateStatus = {
  mode: "off",
  requirePassword: false,
  serverReachable: false,
  locked: false,
  retryAfterSeconds: 0,
  lockedUntil: null,
  attemptsLeft: 5,
  failures: 0,
  level: 0,
  maxAttempts: 5,
  schedule: DEFAULT_LOCKOUT_MINUTES,
  nextLockoutMinutes: DEFAULT_LOCKOUT_MINUTES[0],
  store: "browser",
  sessionTtlSeconds: 12 * 3600,
};

/* ------------------------------------------------------------------ */
/*  Sitzung: NUR im Arbeitsspeicher (Reload = neues Passwort)          */
/* ------------------------------------------------------------------ */

let sessionToken: string | null = null;
let sessionExpiresAt = 0;

export function isUnlocked(): boolean {
  if (!sessionToken) return false;
  if (sessionExpiresAt && Date.now() >= sessionExpiresAt) {
    sessionToken = null;
    return false;
  }
  return true;
}

export function lock(): void {
  sessionToken = null;
  sessionExpiresAt = 0;
}

/**
 * Wird ausgelöst, wenn eine Route hinter dem Server-Gate `401` meldet (Token
 * abgelaufen) — die App zeigt dann wieder die Passwort-Seite.
 */
export const GATE_EXPIRED_EVENT = "shortsfactory:gate-expired";

export function notifyGateExpired(): void {
  try {
    window.dispatchEvent(new Event(GATE_EXPIRED_EVENT));
  } catch {
    /* kein Fenster (SSR/Tests) — egal */
  }
}

/** Header für Routen hinter dem Server-Gate (`/api/zernio`). */
export function gateHeaders(): Record<string, string> {
  const token = isUnlocked() ? sessionToken : null;
  return token ? { "x-sf-auth": token } : {};
}

/* ------------------------------------------------------------------ */
/*  Krypto-Helfer (lokaler Modus)                                       */
/* ------------------------------------------------------------------ */

/** SHA-256 hex — braucht einen secure context (HTTPS oder localhost). */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "crypto.subtle fehlt — die Passwort-Prüfung läuft nur über HTTPS oder localhost."
    );
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Längenunabhängiger Vergleich, damit Timing nichts verrät. */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/*  Lokaler Passwort-Speicher (Einstellungen → APP)                     */
/* ------------------------------------------------------------------ */

export function hasGatePassword(): boolean {
  try {
    return Boolean(localStorage.getItem(LOCAL_HASH_KEY));
  } catch {
    return false;
  }
}

/** Lokales Passwort setzen/ersetzen (SHA-256 im localStorage). */
export async function setGatePassword(password: string): Promise<void> {
  const hash = await sha256Hex(password);
  try {
    localStorage.setItem(LOCAL_HASH_KEY, hash);
  } catch {
    /* private mode */
  }
}

/** Lokalen Passwort-Schutz entfernen (Gate danach offen). */
export function clearGatePassword(): void {
  try {
    localStorage.removeItem(LOCAL_HASH_KEY);
    localStorage.removeItem(LOCAL_RATE_KEY);
  } catch {
    /* private mode */
  }
}

/* ------------------------------------------------------------------ */
/*  Lokaler Modus — Zähler pro Gerät                                    */
/* ------------------------------------------------------------------ */

interface LocalRateState {
  fails: number;
  level: number;
  lockedUntil: number;
}

function readLocalRate(): LocalRateState {
  try {
    const raw = localStorage.getItem(LOCAL_RATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalRateState>;
      return {
        fails: Number(parsed.fails ?? 0),
        level: Number(parsed.level ?? 0),
        lockedUntil: Number(parsed.lockedUntil ?? 0),
      };
    }
  } catch {
    /* kaputtes JSON → neu */
  }
  return { fails: 0, level: 0, lockedUntil: 0 };
}

function writeLocalRate(state: LocalRateState): void {
  try {
    localStorage.setItem(LOCAL_RATE_KEY, JSON.stringify(state));
  } catch {
    /* private mode */
  }
}

function localStatus(): GateStatus {
  const rate = readLocalRate();
  const retryAfterSeconds = Math.max(0, Math.ceil((rate.lockedUntil - Date.now()) / 1000));
  return {
    ...FALLBACK_STATUS,
    mode: "local",
    requirePassword: true,
    locked: retryAfterSeconds > 0,
    retryAfterSeconds,
    lockedUntil: rate.lockedUntil || null,
    failures: rate.fails,
    attemptsLeft: Math.max(0, LOCAL_MAX_ATTEMPTS - rate.fails),
    level: rate.level,
    store: "browser",
  };
}

/* ------------------------------------------------------------------ */
/*  Server-Kommunikation                                                */
/* ------------------------------------------------------------------ */

const AUTH_ENDPOINT = "/api/auth";

const asStatus = (data: Record<string, unknown> | null): GateStatus => ({
  mode: "server",
  requirePassword: true,
  serverReachable: true,
  locked: Boolean(data?.locked),
  retryAfterSeconds: Number(data?.retryAfterSeconds ?? 0),
  lockedUntil: data?.lockedUntil ? Number(data.lockedUntil) : null,
  attemptsLeft: Number(data?.attemptsLeft ?? FALLBACK_STATUS.maxAttempts),
  failures: Number(data?.failures ?? 0),
  level: Number(data?.level ?? 0),
  maxAttempts: Number(data?.maxAttempts ?? FALLBACK_STATUS.maxAttempts),
  schedule:
    Array.isArray(data?.schedule) && data.schedule.length
      ? (data.schedule as number[]).map(Number)
      : DEFAULT_LOCKOUT_MINUTES,
  nextLockoutMinutes: Number(data?.nextLockoutMinutes ?? DEFAULT_LOCKOUT_MINUTES[0]),
  store: (data?.store === "redis" ? "redis" : "memory") as GateStatus["store"],
  sessionTtlSeconds: Number(data?.sessionTtlSeconds ?? FALLBACK_STATUS.sessionTtlSeconds),
});

/**
 * Fragt zuerst den eingebauten Server; ist er nicht da (oder ohne Passwort
 * konfiguriert), greift der lokale Modus.
 */
export async function fetchGateStatus(): Promise<GateStatus> {
  if (await probeBackend()) {
    try {
      const res = await fetch(`${AUTH_ENDPOINT}?action=status`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (data && data.configured) return asStatus(data);
        /* Server da, aber kein Server-Passwort → ggf. lokaler Schutz */
        return hasGatePassword()
          ? { ...localStatus(), serverReachable: true }
          : { ...FALLBACK_STATUS, serverReachable: true };
      }
    } catch {
      /* fällt auf lokal zurück */
    }
  }
  return hasGatePassword() ? localStatus() : { ...FALLBACK_STATUS };
}

export type UnlockResult =
  | { ok: true; token: string; message?: string }
  | { ok: false; status: GateStatus; message: string; code: "FALSCH" | "GESPERRT" | "FEHLER" | "LEER" };

/** Schickt das Passwort an `/api/auth` — oder prüft lokal, wenn kein Server da ist. */
export async function unlock(password: string): Promise<UnlockResult> {
  const server = await probeBackend();

  if (server) {
    try {
      const res = await fetch(AUTH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ action: "unlock", password }),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (data && typeof data.ok !== "undefined") {
        if (res.ok && data.ok && typeof data.token === "string") {
          sessionToken = data.token;
          sessionExpiresAt = Number(data.expiresAt ?? 0) || Date.now() + 12 * 3600 * 1000;
          return { ok: true, token: data.token, message: String(data.message ?? "") };
        }
        /* Server ohne konfiguriertes Passwort → lokal weiter */
        if (data.configured === false) return localUnlock(password);
        const status = asStatus(data);
        const raw = String(data?.error ?? "").toUpperCase();
        const code: "FALSCH" | "GESPERRT" | "LEER" | "FEHLER" =
          raw === "FALSCH" || raw === "GESPERRT" || raw === "LEER" ? raw : "FEHLER";
        const message =
          typeof data?.message === "string" && data.message
            ? data.message
            : code === "GESPERRT"
              ? "Zu viele Fehlversuche — diese IP ist vorübergehend gesperrt."
              : code === "LEER"
                ? "Bitte ein Passwort eingeben."
                : "Falsches Passwort.";
        return { ok: false, status, message, code };
      }
    } catch {
      /* fällt auf lokal zurück */
    }
  }

  return localUnlock(password);
}

/** Prüfung im lokalen Modus gegen den gespeicherten Hash + lokales Rate-Limit. */
async function localUnlock(password: string): Promise<UnlockResult> {
  const state = localStatus();
  if (state.locked) {
    return { ok: false, status: state, message: "Gesperrt — bitte warten.", code: "GESPERRT" };
  }
  if (!password.trim()) {
    return { ok: false, status: state, message: "Bitte ein Passwort eingeben.", code: "LEER" };
  }
  if (!hasGatePassword()) {
    sessionToken = "open";
    sessionExpiresAt = 0;
    return { ok: true, token: "open" };
  }

  const stored = (() => {
    try {
      return String(localStorage.getItem(LOCAL_HASH_KEY) ?? "");
    } catch {
      return "";
    }
  })();

  let match = false;
  for (const candidate of [password, password.trim()]) {
    if (stored && safeEqual(await sha256Hex(candidate), stored)) {
      match = true;
      break;
    }
  }

  const rate = readLocalRate();

  if (match) {
    sessionToken = "local-unlocked";
    sessionExpiresAt = Date.now() + FALLBACK_STATUS.sessionTtlSeconds * 1000;
    writeLocalRate({ fails: 0, level: rate.level, lockedUntil: 0 });
    return { ok: true, token: sessionToken };
  }

  rate.fails += 1;
  if (rate.fails >= LOCAL_MAX_ATTEMPTS) {
    const index = Math.min(rate.level, DEFAULT_LOCKOUT_MINUTES.length - 1);
    rate.lockedUntil = Date.now() + DEFAULT_LOCKOUT_MINUTES[index] * 60_000;
    rate.level = Math.min(rate.level + 1, DEFAULT_LOCKOUT_MINUTES.length);
    rate.fails = 0;
    writeLocalRate(rate);
    return {
      ok: false,
      status: localStatus(),
      message: `${LOCAL_MAX_ATTEMPTS} Fehlversuche in Folge — für ${humanizeMinutes(
        DEFAULT_LOCKOUT_MINUTES[index]
      )} gesperrt (auf diesem Gerät).`,
      code: "GESPERRT",
    };
  }
  writeLocalRate(rate);
  return {
    ok: false,
    status: localStatus(),
    message: `Falsches Passwort. Noch ${LOCAL_MAX_ATTEMPTS - rate.fails} Versuch(e) bis zur Sperre.`,
    code: "FALSCH",
  };
}

/* ------------------------------------------------------------------ */
/*  Anzeige-Helfer                                                      */
/* ------------------------------------------------------------------ */

export function humanizeMinutes(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} Tag(e) ${restHours} h` : `${days} Tag(e)`;
}

/** "4 min 12 s" bzw. "1 h 05 min" — für den Live-Countdown im Gate. */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return `${minutes} min ${String(rest).padStart(2, "0")} s`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
}

export const gateInfo = (status: GateStatus | null) => {
  const mode = status?.mode ?? "off";
  return {
    mode,
    enabled: mode !== "off",
    hint:
      mode === "server"
        ? "Serverseitiges Gate aktiv (APP_PASSWORD in der .env deines Servers). Jede falsche Eingabe zählt pro IP, das Token liegt nur im Tab-Speicher."
        : mode === "local"
          ? "Lokaler Schutz: Passwort als Hash auf DIESEM Gerät (kein Server). Ändern/Entfernen: Einstellungen → APP."
          : "Kein Passwort gesetzt → die App ist offen. Schutz optional: APP_PASSWORD in der .env (Server) oder lokal unter Einstellungen → APP.",
  };
};
