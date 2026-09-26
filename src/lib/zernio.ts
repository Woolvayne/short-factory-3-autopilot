/**
 * Zernio Versandweg — zwei Wege, automatisch gewählt:
 *
 *   1. **Eingebauter Server** (`npm start` auf dem Pi/Heimserver): Der API-Key
 *      liegt als `ZERNIO_API_KEY` in der `.env` des Servers und verlässt ihn
 *      nie. Der Browser redet same-origin mit `/api/zernio` — Passwort-Gate
 *      inklusive, Upload-Relay als Notnagel für blockierte Direktuploads.
 *   2. **Rein statische Seite** (kein Server): Der Key wird einmal im Panel
 *      `06 · Versand` eingetippt und liegt im localStorage DIESES Geräts;
 *      alle Aufrufe gehen danach direkt an `https://zernio.com/api/v1`.
 *
 * Der Rest ist identisch: presign → PUT-Upload → `POST /v1/posts` (sofort,
 * geplant oder Entwurf), dazwischen exakt `SHIP_GAP_MS` = 3 Sekunden Takt.
 * Die Zeitrechnerei (Europe/Berlin, Slot-Pläne) ist unverändert.
 *
 * API-Doku: https://docs.zernio.com · https://zernio.com/llms.txt
 */

import { gateHeaders, notifyGateExpired } from "./gate";
import { probeBackend } from "./relay";
import { sleep } from "./media";
import type { LocalRenderItem } from "./types";

const RELAY_ENDPOINT = "/api/zernio";
const RELAY_UPLOAD_ENDPOINT = "/api/zernio/upload";
const DIRECT_BASE_URL = "https://zernio.com/api/v1";

/** Pflicht-Pause zwischen zwei Videos — exakt 3 Sekunden. */
export const SHIP_GAP_MS = 3000;

export const SHIP_TIMEZONE = "Europe/Berlin";

export interface ZernioAccount {
  id: string;
  platform: string;
  username?: string;
  displayName?: string;
  profileId?: string;
  isActive?: boolean;
}

export interface ZernioStatus {
  ok: boolean;
  configured: boolean;
  accounts: ZernioAccount[];
  /** "relay" = Key auf dem Server (.env) · "direct" = Key in der App (localStorage) */
  via?: "relay" | "direct";
  gate?: boolean;
  error?: string;
  /** true, wenn der Browser Zernio gar nicht erreicht hat (Netzwerk/CORS) */
  unreachable?: boolean;
}

export type ShipMode = "now" | "slots" | "flex" | "custom";

export interface ShipConfig {
  /** Zernio API-Key (`sk_…`) für den Server-losen Modus — nur localStorage. Bei vorhandenem Server leer lassen: dann gilt die Server-.env. */
  apiKey: string;
  mode: ShipMode;
  /**
   * Uhrzeiten (Europe/Berlin, "HH:mm") für den Slot-Modus — Standard
   * `["06:00","20:00"]`. Beliebig erweiterbar: ein Video um 6 Uhr, das nächste
   * um 20 Uhr, dann der nächste Tag … bis alle 10 durch sind.
   */
  slotTimes: string[];
  /**
   * Eigene Zeiten pro Video (Modus `custom`): 10 × `datetime-local`
   * ("YYYY-MM-DDTHH:mm"), leerer Eintrag = sofort.
   */
  customTimes: string[];
  /** Startzeit (datetime-local Wert) für den Flex-Modus */
  flexStart: string;
  /** Abstand zwischen zwei Videos im Flex-Modus, in Minuten */
  flexIntervalMinutes: number;
  captionTemplate: string;
  hashtags: string;
  asDraft: boolean;
  /** Fester Post-Titel (YouTube ≤ 100 Zeichen) — leer = Titel aus dem Idea-Feld */
  titleOverride: string;
}

const SHIP_CFG_KEY = "shortsfactory.zernio.ship.v2";

export const DEFAULT_CAPTION_TEMPLATE = `{title}

{excerpt}

{hashtags}`;

/** Standard-Sendezeiten: ein Video um 6 Uhr, das nächste um 20 Uhr. */
export const DEFAULT_SLOT_TIMES = ["06:00", "20:00"];

export const DEFAULT_SHIP_CONFIG: ShipConfig = {
  apiKey: "",
  mode: "now",
  slotTimes: [...DEFAULT_SLOT_TIMES],
  customTimes: [],
  flexStart: "",
  flexIntervalMinutes: 720,
  captionTemplate: DEFAULT_CAPTION_TEMPLATE,
  hashtags: "#shorts #redditstories #storytime #viral #fyp",
  asDraft: false,
  titleOverride: "",
};

export const FLEX_INTERVALS: { id: number; label: string }[] = [
  { id: 15, label: "15 MIN" },
  { id: 30, label: "30 MIN" },
  { id: 60, label: "1 STD" },
  { id: 120, label: "2 STD" },
  { id: 360, label: "6 STD" },
  { id: 720, label: "12 STD" },
  { id: 1440, label: "1 TAG" },
];

/** Ein-Klick-Vorlagen für die Sendezeiten (Panel 06 → „06 & 20 UHR“). */
export const SHIP_TIME_PRESETS: { id: string; label: string; sub: string; times: string[] }[] = [
  { id: "classic", label: "06 & 20", sub: "Standard", times: ["06:00", "20:00"] },
  { id: "primet", label: "09 & 18", sub: "Bürozeiten", times: ["09:00", "18:00"] },
  { id: "noon", label: "12 & 19", sub: "Mittag + Abend", times: ["12:00", "19:00"] },
  { id: "triple", label: "3× TÄGLICH", sub: "08/14/20", times: ["08:00", "14:00", "20:00"] },
];

/** Höchstzahl eigener Sendezeiten (10 Videos) */
export const MAX_SLOT_TIMES = 10;

export function loadShipConfig(): ShipConfig {
  try {
    const raw =
      localStorage.getItem(SHIP_CFG_KEY) ?? localStorage.getItem("shortsfactory.zernio.ship.v1");
    if (!raw) return { ...DEFAULT_SHIP_CONFIG, slotTimes: [...DEFAULT_SLOT_TIMES] };
    const parsed = JSON.parse(raw) as Partial<ShipConfig>;
    return {
      ...DEFAULT_SHIP_CONFIG,
      ...parsed,
      apiKey: String(parsed.apiKey ?? "").trim(),
      slotTimes:
        Array.isArray(parsed.slotTimes) && parsed.slotTimes.length
          ? parsed.slotTimes
          : [...DEFAULT_SLOT_TIMES],
      customTimes: Array.isArray(parsed.customTimes) ? parsed.customTimes : [],
    };
  } catch {
    return { ...DEFAULT_SHIP_CONFIG, slotTimes: [...DEFAULT_SLOT_TIMES] };
  }
}

export function saveShipConfig(cfg: ShipConfig): void {
  try {
    localStorage.setItem(SHIP_CFG_KEY, JSON.stringify(cfg));
  } catch {
    /* private mode — nicht schlimm */
  }
}

/* ------------------------------------------------------------------ */
/*  Zeit-Fenster (Europe/Berlin) — ohne Kalender, nur Rechnerei          */
/* ------------------------------------------------------------------ */

interface BerlinParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function berlinParts(date: Date = new Date()): BerlinParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHIP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    minute: Number(map.minute),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Berliner Uhrzeit → UTC-Millisekunden (DST-fest durch Nachkontrolle). */
export function berlinWallToMs(year: number, month: number, day: number, hour: number, minute: number): number {
  const approx = Date.UTC(year, month - 1, day, hour, minute, 0);
  const seen = berlinParts(new Date(approx));
  let diff = hour * 60 + minute - (seen.hour * 60 + seen.minute);
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return approx + diff * 60_000;
}

/** UTC-Millisekunden → "YYYY-MM-DDTHH:mm:00" in Berlin (so will es Zernio). */
export function msToBerlinWall(ms: number): string {
  const p = berlinParts(new Date(ms));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00`;
}

export interface Slot {
  /** null = sofort veröffentlichen */
  ms: number | null;
  /** "2026-09-24T06:00:00" in Europe/Berlin, null = sofort */
  wall: string | null;
  /** menschenlesbar: "HEUTE 20:00" · "MORGEN 06:00" · "FR 26.09. 06:00" · "SOFORT" */
  label: string;
  /** true = die eingestellte Zeit lag in der Vergangenheit und wurde auf „jetzt“ vorgezogen */
  bumped?: boolean;
  /** true = der Slot war schon belegt und wurde in der Queue nach hinten geschoben */
  shifted?: boolean;
}

const WEEKDAYS = ["SO", "MO", "DI", "MI", "DO", "FR", "SA"];

export function formatSlotLabel(ms: number | null): string {
  if (ms === null) return "SOFORT";
  const now = berlinParts();
  const then = berlinParts(new Date(ms));
  const dayDiff = Math.round(
    (Date.UTC(then.year, then.month - 1, then.day) - Date.UTC(now.year, now.month - 1, now.day)) /
      86_400_000
  );
  const time = `${pad(then.hour)}:${pad(then.minute)}`;
  if (dayDiff === 0) return `HEUTE ${time}`;
  if (dayDiff === 1) return `MORGEN ${time}`;
  const weekday = WEEKDAYS[new Date(Date.UTC(then.year, then.month - 1, then.day)).getUTCDay()];
  return `${weekday} ${pad(then.day)}.${pad(then.month)}. ${time}`;
}

function parseTime(hhmm: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** "YYYY-MM-DDTHH:mm" aus einem <input type="datetime-local"> */
export function parseDateTimeLocal(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  return berlinWallToMs(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

export function defaultFlexStart(nowMs: number = Date.now()): string {
  const ms = nowMs + 10 * 60_000;
  const p = berlinParts(new Date(ms));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Rechnet die Sendezeiten für `count` Videos aus.
 * - `now`    → zehnmal SOFORT
 * - `slots`  → abwechselnd die eingestellten Uhrzeiten (Standard 06:00 / 20:00,
 *              Europe/Berlin), immer der nächste freie Zeitpunkt
 * - `flex`   → Startzeit + fester Abstand
 * - `custom` → eigene Zeit pro Video (`cfg.customTimes[unitIndex]`, leer = sofort)
 */
export function computeSlots(cfg: ShipConfig, count: number, nowMs: number = Date.now()): Slot[] {
  const out: Slot[] = [];
  const minFuture = nowMs + 2 * 60_000;

  if (cfg.mode === "now") {
    for (let i = 0; i < count; i++) out.push({ ms: null, wall: null, label: "SOFORT" });
    return out;
  }

  /* Eigene Zeit pro Video — leere Eingabe heißt „sofort“ */
  if (cfg.mode === "custom") {
    const times = Array.isArray(cfg.customTimes) ? cfg.customTimes : [];
    for (let i = 0; i < count; i++) {
      const parsed = parseDateTimeLocal(String(times[i] ?? ""));
      if (parsed === null) {
        out.push({ ms: null, wall: null, label: "SOFORT" });
        continue;
      }
      if (parsed <= minFuture) {
        out.push({
          ms: minFuture,
          wall: msToBerlinWall(minFuture),
          label: formatSlotLabel(minFuture),
          bumped: true,
        });
        continue;
      }
      out.push({ ms: parsed, wall: msToBerlinWall(parsed), label: formatSlotLabel(parsed) });
    }
    return out;
  }

  if (cfg.mode === "flex") {
    const interval = Math.max(1, cfg.flexIntervalMinutes) * 60_000;
    let start = parseDateTimeLocal(cfg.flexStart || defaultFlexStart());
    if (start === null) start = nowMs + 10 * 60_000;
    if (start <= minFuture) {
      /* Start liegt in der Vergangenheit → auf den nächsten freien Takt vorspulen */
      start += Math.ceil((minFuture - start) / interval) * interval;
    }
    for (let i = 0; i < count; i++) {
      const ms = start + i * interval;
      out.push({ ms, wall: msToBerlinWall(ms), label: formatSlotLabel(ms) });
    }
    return out;
  }

  /* slots: täglich 06:00 & 20:00 (anpassbar) */
  const times = (cfg.slotTimes.length ? cfg.slotTimes : DEFAULT_SHIP_CONFIG.slotTimes)
    .map((t) => parseTime(t))
    .filter((t): t is { hour: number; minute: number } => t !== null)
    .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  const slots = times.length ? times : [{ hour: 6, minute: 0 }, { hour: 20, minute: 0 }];

  const today = berlinParts(new Date(nowMs));
  for (let dayOffset = 0; out.length < count && dayOffset < 400; dayOffset++) {
    const base = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset, 12));
    const day = {
      year: base.getUTCFullYear(),
      month: base.getUTCMonth() + 1,
      day: base.getUTCDate(),
    };
    for (const time of slots) {
      if (out.length >= count) break;
      const ms = berlinWallToMs(day.year, day.month, day.day, time.hour, time.minute);
      if (ms <= minFuture) continue;
      out.push({ ms, wall: msToBerlinWall(ms), label: formatSlotLabel(ms) });
    }
  }
  return out;
}

/** Millisekunden → "YYYY-MM-DDTHH:mm" für ein <input type="datetime-local">. */
export function msToDateTimeLocal(ms: number): string {
  const p = berlinParts(new Date(ms));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Füllt die 10 eigenen Zeiten aus den Slot-Uhrzeiten (Standard 06:00 / 20:00):
 * erst heute 06:00, heute 20:00, morgen 06:00 … — nur zukünftige Zeiten.
 */
export function fillCustomTimes(
  slotTimes: string[],
  count = 10,
  nowMs: number = Date.now()
): string[] {
  const times = slotTimes.length ? slotTimes : DEFAULT_SLOT_TIMES;
  const slots = computeSlots(
    { ...DEFAULT_SHIP_CONFIG, slotTimes: times, mode: "slots" },
    count,
    nowMs
  );
  return slots.map((slot) => msToDateTimeLocal(slot.ms ?? nowMs + 10 * 60_000));
}

/** „06:00 & 20:00“ — Kurzanzeige für Beschriftungen. */
export const slotTimesLabel = (times: string[]): string => {
  const list = (times.length ? times : DEFAULT_SLOT_TIMES).filter(Boolean);
  if (list.length === 0) return "SOFORT";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(" · ")} & ${list[list.length - 1]}`;
};

/** Prüft eine "HH:mm"-Eingabe. */
export function validSlotTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

/* ------------------------------------------------------------------ */
/*  Transport: Server-Relay (bevorzugt) oder direkter Browser-Call       */
/* ------------------------------------------------------------------ */

/** CORS/Netzwerk-Fehler erkennbar machen, damit die UI Klartext helfen kann. */
const UNREACHABLE_HINT =
  "Zernio ist aus dem Browser nicht erreichbar (Netzwerk/CORS). Prüfe die Internet-Verbindung und deaktiviere testweise Tracking-Blocker für diese Seite.";

const NETWORK_ERROR = "__NETWORK__";

function markUnreachable(e: unknown): Error {
  const err = new Error(UNREACHABLE_HINT);
  err.name = "UNREACHABLE";
  if (e instanceof Error && e.name === "AbortError") return new Error("Zernio-Anfrage abgebrochen (Timeout).");
  return err;
}

export const isUnreachableError = (e: unknown): boolean =>
  e instanceof Error && e.name === "UNREACHABLE";

/** Aufruf über das Server-Relay (Key bleibt auf dem Server). */
async function relayCall<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...gateHeaders(),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error(NETWORK_ERROR);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok === false) {
    /* 401 = Sitzungs-Token abgelaufen/fehlt → App zurück auf die Passwort-Seite. */
    if (res.status === 401) notifyGateExpired();
    throw new Error(
      typeof data?.error === "string" ? data.error : `Zernio-Route HTTP ${res.status}`
    );
  }
  return data as T;
}

const extractErrorMessage = (data: Record<string, unknown> | null, status: number): string =>
  (typeof (data?.error as { message?: string } | undefined)?.message === "string" &&
    (data?.error as { message?: string }).message) ||
  (typeof data?.error === "string" && (data.error as string)) ||
  (typeof data?.message === "string" && (data.message as string)) ||
  `Zernio HTTP ${status}`;

/** Direkter Aufruf der Zernio-API aus dem Browser (Key aus der App). */
async function directCall<T>(
  path: string,
  apiKey: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${DIRECT_BASE_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    throw markUnreachable(e);
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new Error(extractErrorMessage(data, res.status));
  return data as T;
}

const POSTING_PLATFORMS = new Set([
  "twitter",
  "instagram",
  "facebook",
  "youtube",
  "linkedin",
  "threads",
  "tiktok",
  "pinterest",
  "reddit",
  "bluesky",
  "googlebusiness",
  "telegram",
  "snapchat",
  "whatsapp",
  "discord",
  "slack",
]);

/* TikTok verlangt laut API-Doku zwingend diese Settings. */
const TIKTOK_SETTINGS = {
  privacy_level: "PUBLIC_TO_EVERYONE",
  allow_comment: true,
  allow_duet: true,
  allow_stitch: true,
  commercial_content_type: "none",
  content_preview_confirmed: true,
  express_consent_given: true,
  media_type: "video",
  auto_add_music: false,
  video_made_with_ai: false,
};

const normalizeAccounts = (payload: unknown): ZernioAccount[] => {
  const p = payload as Record<string, unknown> | null;
  const list: unknown[] = Array.isArray(p?.accounts)
    ? (p!.accounts as unknown[])
    : Array.isArray(p?.data)
      ? (p!.data as unknown[])
      : Array.isArray(p)
        ? (p as unknown[])
        : [];
  return list
    .map((a) => {
      const acc = (a ?? {}) as Record<string, unknown>;
      return {
        id: String(acc._id ?? acc.id ?? ""),
        platform: String(acc.platform ?? "").toLowerCase(),
        username: String(acc.username ?? ""),
        displayName: String(acc.displayName ?? ""),
        profileId: String(acc.profileId ?? ""),
        isActive: acc.isActive !== false,
      };
    })
    .filter((a) => a.id && a.platform);
};

const postableAccounts = (accounts: ZernioAccount[]) =>
  accounts.filter((a) => a.isActive && POSTING_PLATFORMS.has(a.platform));

/**
 * Status-Check: Key gültig? Welche Accounts sind verbunden?
 * Wählt automatisch Relay (Server-.env) oder Direktmodus (App-Key).
 */
export async function fetchZernioStatus(cfg: Pick<ShipConfig, "apiKey">): Promise<ZernioStatus> {
  /* Weg 1: eingebauter Server → Status inkl. ob ZERNIO_API_KEY in der .env liegt */
  if (await probeBackend()) {
    try {
      const data = await relayCall<{
        configured: boolean;
        accounts: ZernioAccount[];
        gate?: boolean;
      }>(`${RELAY_ENDPOINT}?action=status`);
      return {
        ok: true,
        configured: Boolean(data?.configured),
        accounts: Array.isArray(data?.accounts) ? data.accounts : [],
        gate: Boolean(data?.gate),
        via: "relay",
      };
    } catch (e) {
      return {
        ok: false,
        configured: false,
        accounts: [],
        via: "relay",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /* Weg 2: kein Server → Key aus der App (localStorage) */
  const key = cfg.apiKey.trim();
  if (!key) return { ok: true, configured: false, accounts: [], via: "direct" };
  try {
    const payload = await directCall<unknown>("/accounts", key);
    return {
      ok: true,
      configured: true,
      accounts: postableAccounts(normalizeAccounts(payload)),
      via: "direct",
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      configured: false,
      accounts: [],
      via: "direct",
      error: message,
      unreachable: isUnreachableError(e),
    };
  }
}

interface PresignResponse {
  uploadUrl: string;
  publicUrl: string;
  key?: string;
  sig?: string;
  expiresIn?: number;
}

async function presignMedia(
  cfg: Pick<ShipConfig, "apiKey">,
  filename: string,
  contentType: string,
  size: number
): Promise<PresignResponse> {
  if (await probeBackend()) {
    return relayCall<PresignResponse>(RELAY_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ action: "presign", filename, contentType, size }),
    });
  }
  const key = cfg.apiKey.trim();
  if (!key) throw new Error("Kein Zernio-API-Key — unter 06 · VERSAND eintragen (sk_…).");
  const data = await directCall<Record<string, unknown>>("/media/presign", key, {
    method: "POST",
    body: { filename, contentType, size },
  });
  const inner = (data?.data ?? {}) as Record<string, unknown>;
  const uploadUrl = String(
    data?.uploadUrl ?? data?.upload_url ?? inner.uploadUrl ?? inner.upload_url ?? ""
  );
  const publicUrl = String(
    data?.publicUrl ?? data?.public_url ?? inner.publicUrl ?? inner.public_url ?? ""
  );
  if (!uploadUrl || !publicUrl) {
    throw new Error("Zernio hat keine Upload-URL zurückgegeben.");
  }
  return {
    uploadUrl,
    publicUrl,
    key: String(data?.key ?? inner.key ?? ""),
    expiresIn: Number(data?.expiresIn ?? inner.expiresIn ?? 3600),
  };
}

export interface PublishInput {
  mediaUrl: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  content: string;
  title: string;
  hashtags: string[];
  tags?: string[];
  slot: Slot;
  asDraft: boolean;
  timezone?: string;
  platforms?: { platform: string; accountId?: string }[];
}

export interface PublishResult {
  postId: string | null;
  status: string;
  scheduledFor: string | null;
}

async function publishPost(
  cfg: Pick<ShipConfig, "apiKey">,
  input: PublishInput
): Promise<PublishResult> {
  /* Weg 1: Relay übernimmt Payload+Account-Auto-Auswahl wie bisher */
  if (await probeBackend()) {
    return relayCall<PublishResult>(RELAY_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({
        action: "publish",
        mediaUrl: input.mediaUrl,
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.size,
        content: input.content,
        title: input.title,
        hashtags: input.hashtags,
        tags: input.tags ?? [],
        platforms: input.platforms ?? [],
        isDraft: input.asDraft,
        scheduledFor: input.slot.wall ?? undefined,
        timezone: input.slot.wall ? (input.timezone ?? SHIP_TIMEZONE) : undefined,
      }),
    });
  }

  /* Weg 2: direkt — Payload hier im Browser bauen */
  const key = cfg.apiKey.trim();
  if (!key) throw new Error("Kein Zernio-API-Key — unter 06 · VERSAND eintragen (sk_…).");

  let platforms = Array.isArray(input.platforms)
    ? input.platforms
        .filter((p) => p && p.platform)
        .map((p) => ({
          platform: String(p.platform).toLowerCase(),
          ...(p.accountId ? { accountId: String(p.accountId) } : {}),
        }))
    : [];

  if (platforms.length === 0) {
    platforms = postableAccounts(
      normalizeAccounts(await directCall<unknown>("/accounts", key))
    ).map((a) => ({ platform: a.platform, accountId: a.id }));
  }
  if (platforms.length === 0) {
    throw new Error(
      "Kein verbundener Social-Account in Zernio gefunden — Accounts unter zernio.com verbinden und erneut versuchen."
    );
  }

  const hashtags = Array.isArray(input.hashtags)
    ? input.hashtags.map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean)
    : [];
  const tags = Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  const title = String(input.title || "").slice(0, 100);
  const content = String(input.content || title || "").slice(0, 4000);

  const payload: Record<string, unknown> = {
    content,
    platforms,
    mediaItems: [
      {
        type: "video",
        url: input.mediaUrl,
        ...(input.filename ? { filename: String(input.filename) } : {}),
        ...(input.mimeType ? { mimeType: String(input.mimeType) } : {}),
        ...(Number(input.size) ? { size: Number(input.size) } : {}),
      },
    ],
    ...(title ? { title } : {}),
    ...(hashtags.length ? { hashtags } : {}),
    ...(tags.length ? { tags } : {}),
    visibility: "public",
  };

  if (input.asDraft) {
    payload.isDraft = true;
  } else if (input.slot.wall) {
    payload.scheduledFor = input.slot.wall;
    payload.timezone = input.timezone ?? SHIP_TIMEZONE;
  } else {
    payload.publishNow = true;
  }

  if (platforms.some((p) => p.platform === "tiktok")) {
    payload.tiktokSettings = { ...TIKTOK_SETTINGS };
  }

  const data = await directCall<Record<string, unknown>>("/posts", key, {
    method: "POST",
    body: payload,
  });
  const inner = (data?.data ?? {}) as Record<string, unknown>;
  const post = (data?.post ?? inner.post ?? data?.data ?? data) as Record<string, unknown>;
  return {
    postId: (post?._id as string) ?? (post?.id as string) ?? null,
    status:
      String(post?.status ?? "") ||
      (payload.publishNow ? "publishing" : payload.isDraft ? "draft" : "scheduled"),
    scheduledFor: (post?.scheduledFor as string) ?? input.slot.wall ?? null,
  };
}

export async function fetchPostStatus(cfg: Pick<ShipConfig, "apiKey">, postId: string) {
  if (await probeBackend()) {
    return relayCall<{ postId: string; status: string }>(RELAY_ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ action: "post-status", postId }),
    });
  }
  const key = cfg.apiKey.trim();
  if (!key) throw new Error("Kein Zernio-API-Key — unter 06 · VERSAND eintragen (sk_…).");
  const data = await directCall<Record<string, unknown>>(
    `/posts/${encodeURIComponent(postId)}`,
    key
  );
  const inner = (data?.data ?? {}) as Record<string, unknown>;
  const post = (data?.post ?? inner.post ?? data?.data ?? {}) as Record<string, unknown>;
  return {
    postId,
    status: String(post?.status ?? "unknown"),
    platforms: (post?.platforms as unknown[]) ?? [],
  };
}

/* ------------------------------------------------------------------ */
/*  Upload: Browser → presignierte Storage-URL (PUT)                     */
/* ------------------------------------------------------------------ */

function xhrUpload(
  url: string,
  method: "PUT" | "POST",
  blob: Blob,
  headers: Record<string, string>,
  onProgress?: (ratio: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = 600_000;
    for (const [key, value] of Object.entries(headers)) {
      try {
        xhr.setRequestHeader(key, value);
      } catch {
        /* ungültiger Header-Name — ignorieren */
      }
    }
    if (xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(Math.min(1, e.loaded / e.total));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else
        reject(
          new Error(
            `Upload HTTP ${xhr.status}: ${String(xhr.responseText || "").slice(0, 180) || "ohne Antwort"}`
          )
        );
    };
    xhr.onerror = () => reject(new Error(NETWORK_ERROR));
    xhr.ontimeout = () => reject(new Error("Upload-Timeout nach 10 Minuten"));
    xhr.send(blob);
  });
}

/**
 * Lädt ein Video zu Zernio und liefert die öffentliche URL für den Post.
 * Primär direkter PUT auf die presignierte Storage-URL (bis 5 GB). Läuft ein
 * eigener Server greift bei CORS-Ärger automatisch sein Upload-Relay.
 */
export async function uploadVideoBlob(
  cfg: Pick<ShipConfig, "apiKey">,
  blob: Blob,
  filename: string,
  contentType: string,
  onProgress?: (ratio: number) => void
): Promise<string> {
  const relay = await probeBackend();
  const presign = await presignMedia(cfg, filename, contentType, blob.size);

  try {
    await xhrUpload(presign.uploadUrl, "PUT", blob, { "Content-Type": contentType }, onProgress);
    return presign.publicUrl;
  } catch (e) {
    const network = e instanceof Error && e.message === NETWORK_ERROR;
    if (!network) throw e instanceof Error ? e : new Error(String(e));

    if (relay && presign.sig) {
      /* Notnagel: derselbe Upload durch den eigenen Server (kein Vercel-Limit) */
      await xhrUpload(
        RELAY_UPLOAD_ENDPOINT,
        "POST",
        blob,
        {
          ...gateHeaders(),
          "x-sf-target": presign.uploadUrl,
          "x-sf-sig": presign.sig,
          "x-sf-content-type": contentType,
        },
        onProgress
      );
      return presign.publicUrl;
    }

    throw new Error(
      "Der Storage-Upload ist aus dem Browser gescheitert (Netzwerk/CORS). Bitte Verbindung prüfen — oder mit dem eingebauten Server starten (`npm start`), dann greift das Upload-Relay."
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Beschriftung + Versand eines einzelnen Videos                        */
/* ------------------------------------------------------------------ */

export const shipFileName = (item: LocalRenderItem) =>
  `shortsfactory_${String(item.index + 1).padStart(2, "0")}.${
    item.mime?.includes("webm") ? "webm" : "mp4"
  }`;

export function parseHashtags(raw: string): string[] {
  return String(raw || "")
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

function excerptOf(story: string, max = 240): string {
  const text = String(story || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ")).trim()}…`;
}

export interface CaptionParts {
  content: string;
  title: string;
  hashtags: string[];
}

export function buildCaption(item: LocalRenderItem, cfg: ShipConfig): CaptionParts {
  const idea = (item.idea || "").trim();
  const hashtags = parseHashtags(cfg.hashtags);
  const override = (cfg.titleOverride || "").trim();
  const title = (override || idea || "Reddit Story").slice(0, 100);

  const content = (cfg.captionTemplate || DEFAULT_CAPTION_TEMPLATE)
    .replaceAll("{title}", title)
    .replaceAll("{idea}", idea)
    .replaceAll("{story}", (item.story || "").replace(/\s+/g, " ").trim())
    .replaceAll("{excerpt}", excerptOf(item.story || ""))
    .replaceAll("{hashtags}", hashtags.map((h) => `#${h}`).join(" "))
    .replaceAll("{index}", String(item.index + 1).padStart(2, "0"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { content: content.slice(0, 4000), title, hashtags };
}

export type ShipStage = "uploading" | "publishing";

export interface ShipHooks {
  slot: Slot;
  onStage?: (stage: ShipStage) => void;
  onProgress?: (ratio: number) => void;
}

export interface ShipResult {
  postId: string | null;
  status: string;
  scheduledFor: string | null;
  mediaUrl: string;
  slot: Slot;
}

export async function shipVideo(
  item: LocalRenderItem,
  cfg: ShipConfig,
  hooks: ShipHooks
): Promise<ShipResult> {
  if (!item.blob) throw new Error("Dieses Unit ist noch nicht gerendert.");
  if (!(await probeBackend()) && !cfg.apiKey.trim()) {
    throw new Error(
      "Kein Zernio-API-Key — entweder ZERNIO_API_KEY in die .env des Servers oder unten im Panel 06 eintragen (sk_…)."
    );
  }

  const filename = shipFileName(item);
  const contentType = item.mime?.split(";")[0] || "video/mp4";

  hooks.onStage?.("uploading");
  const mediaUrl = await uploadVideoBlob(cfg, item.blob, filename, contentType, hooks.onProgress);

  hooks.onStage?.("publishing");
  const caption = buildCaption(item, cfg);
  const result = await publishPost(cfg, {
    mediaUrl,
    filename,
    mimeType: contentType,
    size: item.blob.size,
    content: caption.content,
    title: caption.title,
    hashtags: caption.hashtags,
    tags: caption.hashtags,
    slot: hooks.slot,
    asDraft: cfg.asDraft,
  });

  return {
    postId: result.postId,
    status: result.status,
    scheduledFor: result.scheduledFor ?? hooks.slot.wall,
    mediaUrl,
    slot: hooks.slot,
  };
}

/** Wartet die Pflicht-Pause ab und meldet den Countdown (100-ms-Schritte). */
export async function shipGap(
  ms: number = SHIP_GAP_MS,
  onTick?: (remainingMs: number) => void,
  isCancelled?: () => boolean
): Promise<boolean> {
  const step = 100;
  for (let left = ms; left > 0; left -= step) {
    if (isCancelled?.()) return true;
    onTick?.(Math.max(0, left));
    await sleep(Math.min(step, left));
  }
  onTick?.(0);
  return Boolean(isCancelled?.());
}

export const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
  twitter: "X",
  threads: "Threads",
  pinterest: "Pinterest",
  reddit: "Reddit",
  bluesky: "Bluesky",
  linkedin: "LinkedIn",
  googlebusiness: "Google Business",
  telegram: "Telegram",
  snapchat: "Snapchat",
  whatsapp: "WhatsApp",
  discord: "Discord",
  slack: "Slack",
};

export const platformLabel = (p: string) => PLATFORM_LABELS[p?.toLowerCase()] ?? p ?? "—";
