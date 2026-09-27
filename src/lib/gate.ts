/**
 * Onepage-Passwort-Gate — läuft komplett im Browser dieses Geräts, kein
 * Server nötig: Passwort als SHA-256 im localStorage, Fehlversuch-Sperre mit
 * eskalierenden Zeiten (5 → 15 → 60 → 360 → 1440 min).
 *
 * Das Sitzungs-Token liegt NUR im Arbeitsspeicher des Tabs → jedes Neuladen
 * (F5) verlangt das Passwort erneut. Ohne gesetztes Passwort ist die App
 * offen (kein Gate).
 */

export type GateMode = "local" | "off";

/** Standard-Sperrstufen (Minuten). */
export const DEFAULT_LOCKOUT_MINUTES = [5, 15, 60, 360, 1440];
const LOCAL_MAX_ATTEMPTS = 5;

const LOCAL_HASH_KEY = "shortsfactory.gate.v1";
const LOCAL_RATE_KEY = "shortsfactory.gate.rate.v1";

export interface GateStatus {
  /** "local" = Schutz auf diesem Gerät aktiv · "off" = offen */
  mode: GateMode;
  requirePassword: boolean;
  locked: boolean;
  retryAfterSeconds: number;
  lockedUntil: number | null;
  attemptsLeft: number;
  failures: number;
  level: number;
  maxAttempts: number;
  schedule: number[];
  nextLockoutMinutes: number;
  store: "browser";
  sessionTtlSeconds: number;
  error?: string;
}

export const FALLBACK_STATUS: GateStatus = {
  mode: "off",
  requirePassword: false,
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

/** Wird aktuell nirgends mehr ausgelöst (kein Server-Gate mehr) — bleibt für
 * eventuelle künftige Nutzung/Kompatibilität exportiert. */
export const GATE_EXPIRED_EVENT = "shortsfactory:gate-expired";

export function notifyGateExpired(): void {
  try {
    window.dispatchEvent(new Event(GATE_EXPIRED_EVENT));
  } catch {
    /* kein Fenster (SSR/Tests) — egal */
  }
}

/** Header für evtl. eigene API-Aufrufe (aktuell ungenutzt, da alles direkt im Browser läuft). */
export function gateHeaders(): Record<string, string> {
  const token = isUnlocked() ? sessionToken : null;
  return token ? { "x-sf-auth": token } : {};
}

/* ------------------------------------------------------------------ */
/*  Krypto-Helfer                                                        */
/* ------------------------------------------------------------------ */

/** SHA-256 hex — braucht einen secure context (HTTPS, localhost oder file://). */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "crypto.subtle fehlt — die Passwort-Prüfung läuft nur über HTTPS, localhost oder eine lokal geöffnete Datei."
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
/*  Zähler pro Gerät                                                     */
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
/*  Öffentliche API                                                      */
/* ------------------------------------------------------------------ */

/** Kein Passwort gesetzt → offen. Sonst lokaler Schutz auf diesem Gerät. */
export async function fetchGateStatus(): Promise<GateStatus> {
  return hasGatePassword() ? localStatus() : { ...FALLBACK_STATUS };
}

export type UnlockResult =
  | { ok: true; token: string; message?: string }
  | { ok: false; status: GateStatus; message: string; code: "FALSCH" | "GESPERRT" | "FEHLER" | "LEER" };

/** Prüft das Passwort lokal gegen den gespeicherten Hash + lokales Rate-Limit. */
export async function unlock(password: string): Promise<UnlockResult> {
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
      mode === "local"
        ? "Lokaler Schutz: Passwort als Hash auf DIESEM Gerät (kein Server, kein Upload). Ändern/Entfernen: Einstellungen → APP."
        : "Kein Passwort gesetzt → die App ist offen. Schutz optional: unter Einstellungen → APP setzen.",
  };
};
