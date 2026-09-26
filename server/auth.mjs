/**
 * ShortsFactory v4 — Passwort-Gate (eingebauter Server, kein Vercel nötig)
 *
 * Die Onepage-Seite fragt hier an, ob und wann sie rein darf. Alles läuft
 * serverseitig, damit eine IP wirklich gesperrt werden kann:
 *
 *   GET  /api/auth?action=status   → Ist ein Passwort gesetzt? Ist diese IP gesperrt?
 *   POST /api/auth  {action:"unlock", password}
 *                                  → prüft das Passwort. Erfolg = signiertes Sitzungs-Token.
 *   POST /api/auth  {action:"check", token}
 *                                  → ist ein Token noch gültig?
 *   POST /api/auth  {action:"lock"} → Zähler dieser IP vergessen.
 *
 * Konfiguration über Umgebungsvariablen oder `.env` im Projektroot:
 *   APP_PASSWORD           Klartext-Passwort — empfohlen, bleibt serverseitig
 *   APP_PASSWORD_HASH      Alternative: SHA-256 des Passworts
 *   APP_MAX_ATTEMPTS       Fehlversuche bis zur Sperre (Standard 5)
 *   APP_LOCKOUT_MINUTES    Sperr-Stufen in Minuten (Standard 5,15,60,360,1440)
 *   APP_SESSION_TTL        Gültigkeit des Tokens in Sekunden (Standard 43200 = 12 h)
 */

import {
  authenticateRequest,
  clientIp,
  createToken,
  gateConfigured,
  gateMode,
  humanizeMinutes,
  maxAttempts,
  passwordMatches,
  rateLimitState,
  rateLimitStore,
  registerFailure,
  registerSuccess,
  sessionTtlSeconds,
  lockoutStepsMinutes,
  verifyToken,
} from "./gate.mjs";

const noStore = (res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-sf-auth");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
};

/** Antwort für den Status — nie das Passwort, nie den Hash. */
const statePayload = (state) => ({
  ok: true,
  configured: true,
  mode: "server",
  gateMode: gateMode(),
  store: rateLimitStore(),
  maxAttempts: maxAttempts(),
  schedule: lockoutStepsMinutes(),
  locked: state.locked,
  retryAfterSeconds: state.retryAfterSeconds,
  lockedUntil: state.lockedUntil,
  attemptsLeft: state.attemptsLeft,
  failures: state.failures,
  level: state.level,
  nextLockoutMinutes: state.nextLockoutMinutes,
  sessionTtlSeconds: sessionTtlSeconds(),
});

function safeParse(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  noStore(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const json = (status, payload) => res.status(status).json(payload);

  const ip = clientIp(req);
  const body = typeof req.body === "string" ? safeParse(req.body) : (req.body ?? {});
  const action = String(req.query?.action || body?.action || "").toLowerCase();

  /* ---- Gate aus? Dann braucht die Seite kein Passwort. ---- */
  if (!gateConfigured()) {
    return json(200, {
      ok: true,
      configured: false,
      mode: "off",
      store: rateLimitStore(),
      hint: "Kein Passwort gesetzt — APP_PASSWORD in der .env fehlt. Anleitung: docs/EINRICHTUNG.md",
    });
  }

  /* ---- STATUS: darf diese IP gerade? ---- */
  if (req.method === "GET" || action === "status") {
    const state = await rateLimitState(ip);
    return json(200, statePayload(state));
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Nur GET (Status) oder POST (unlock/check/lock)." });
  }

  /* ---- LOCK: Client hat sich abgemeldet → Zähler dieser IP vergessen ---- */
  if (action === "lock") {
    await registerSuccess(ip);
    return json(200, { ok: true, cleared: true });
  }

  /* ---- CHECK: ist ein vorhandenes Token noch gültig? ---- */
  if (action === "check") {
    const token = body?.token || req.headers?.["x-sf-auth"] || "";
    const result = verifyToken(token);
    if (result.ok) return json(200, { ok: true, valid: true, expiresAt: result.claims.exp * 1000 });
    const legacy = authenticateRequest(req);
    if (legacy.ok) return json(200, { ok: true, valid: true, legacy: true });
    return json(401, { ok: false, valid: false, error: "TOKEN_UNGUELTIG", reason: result.reason });
  }

  /* ---- UNLOCK: Passwort prüfen ---- */
  const before = await rateLimitState(ip);
  if (before.locked) {
    res.setHeader("Retry-After", String(before.retryAfterSeconds));
    return json(429, {
      ...statePayload(before),
      ok: false,
      error: "GESPERRT",
      message: `Zu viele Fehlversuche. Diese IP ist noch ${humanizeMinutes(
        before.retryAfterSeconds / 60
      )} gesperrt.`,
    });
  }

  const password = String(body?.password ?? "");
  if (!password.trim()) {
    return json(400, { ok: false, error: "LEER", message: "Bitte ein Passwort eingeben." });
  }

  if (!passwordMatches(password)) {
    const state = await registerFailure(ip);
    if (state.locked) {
      res.setHeader("Retry-After", String(state.retryAfterSeconds));
      return json(429, {
        ...statePayload({ ...state, attemptsLeft: state.attemptsLeft }),
        ok: false,
        error: "GESPERRT",
        message: `${state.maxAttempts} Fehlversuche in Folge — diese IP ist jetzt für ${humanizeMinutes(
          state.nextLockoutMinutes
        )} gesperrt. Jede weitere Sperre wird länger.`,
      });
    }
    return json(401, {
      ...statePayload({
        ...state,
        locked: false,
        retryAfterSeconds: 0,
        lockedUntil: null,
        nextLockoutMinutes: state.nextLockoutMinutes,
      }),
      ok: false,
      error: "FALSCH",
      message: `Falsches Passwort. Noch ${state.attemptsLeft} Versuch${
        state.attemptsLeft === 1 ? "" : "e"
      } bis zur Sperre.`,
    });
  }

  /* ---- Erfolg ---- */
  await registerSuccess(ip);
  const token = createToken();
  return json(200, {
    ok: true,
    token,
    expiresAt: Date.now() + sessionTtlSeconds() * 1000,
    expiresInSeconds: sessionTtlSeconds(),
    maxAttempts: maxAttempts(),
    schedule: lockoutStepsMinutes(),
    store: rateLimitStore(),
    message:
      "Freigeschaltet. Das Passwort wird bei jedem Neuladen der Seite erneut verlangt — das Token liegt nur im Arbeitsspeicher des Tabs.",
  });
}
