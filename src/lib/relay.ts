/**
 * Erkennt, ob der eingebaute ShortsFactory-Server vorhanden ist.
 *
 * Läuft die App über `npm start` (Pi/Heimserver) oder hinter dem eingebauten
 * Server, antwortet `/api/health` mit `{ ok: true, service: "shortsfactory" }`.
 * Läuft sie dagegen als REINE STATISCHE Seite (vite preview, GitHub Pages,
 * beliebiger Static-Host), fällt sie automatisch in den Server-losen Modus:
 * Browser-TTS, Zernio direkt aus dem Browser, lokales Passwort-Gate.
 *
 * Das Ergebnis wird 60 Sekunden gecacht; `force` prüft sofort neu.
 */

const HEALTH_ENDPOINT = "/api/health";

let cached: { at: number; ok: boolean } | null = null;

export async function probeBackend(force = false): Promise<boolean> {
  if (!force && cached && Date.now() - cached.at < 60_000) return cached.ok;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(HEALTH_ENDPOINT, {
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    clearTimeout(timer);
    const data = (await res.json().catch(() => null)) as { ok?: boolean; service?: string } | null;
    const ok = Boolean(res.ok && data?.ok && data?.service === "shortsfactory");
    cached = { at: Date.now(), ok };
    return ok;
  } catch {
    cached = { at: Date.now(), ok: false };
    return false;
  }
}

/** Was zuletzt geprüft wurde (ohne Netzwerk — nur für Anzeigen). */
export function lastProbe(): boolean | null {
  return cached ? cached.ok : null;
}
