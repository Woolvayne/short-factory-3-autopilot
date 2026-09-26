/**
 * Autopilot — ein Knopfdruck, der Rest läuft von allein.
 *
 * Der Autopilot orchestriert die komplette Linie ohne jede weitere Aktion:
 *
 *   IDEEN (KI/Offline) → SKRIPTE → STIMMEN → CLIPS → RENDER → SENDEWELLEN
 *
 * Danach versendet er in festen Abständen (Standard: alle 60 Minuten) eine
 * einstellbare Anzahl Videos an Zernio — mit sichtbarem Countdown, Wellen-
 * Fortschritt und Protokoll. Optional läuft er im ENDLOS-LOOP: nach dem
 * Versand aller Videos werden frische Ideen geschrieben und neue Clips
 * geschnitten — die Fabrik produziert also durchgehend weiter.
 *
 * Wichtig (ehrlich): Die Fabrik läuft zu 100 % im Browser. Autopilot und
 * stündlicher Versand funktionieren nur, solange dieser Tab geöffnet bleibt;
 * beim Schließen pausiert alles (ohne Datenverlust der Einstellungen).
 */

export interface AutopilotConfig {
  /** Videos pro Sendewelle (1–10) */
  perWave: number;
  /** Abstand zwischen zwei Wellen in Minuten (Standard 60 = stündlich) */
  intervalMinutes: number;
  /** erste Welle sofort nach dem Rendern senden (sonst erst nach Intervall) */
  firstWaveNow: boolean;
  /** nach dem Versand aller Videos automatisch den nächsten Zyklus starten */
  loopForever: boolean;
  /** leere Ideen-Felder automatisch per KI/Offline-Generator auffüllen */
  autoIdeas: boolean;
}

export const DEFAULT_AUTOPILOT_CONFIG: AutopilotConfig = {
  perWave: 2,
  intervalMinutes: 60,
  firstWaveNow: true,
  loopForever: false,
  autoIdeas: true,
};

const CFG_KEY = "shortsfactory.autopilot.v1";

export function loadAutopilotConfig(): AutopilotConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return { ...DEFAULT_AUTOPILOT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<AutopilotConfig>;
    return {
      ...DEFAULT_AUTOPILOT_CONFIG,
      ...parsed,
      perWave: Math.max(1, Math.min(10, Number(parsed.perWave ?? DEFAULT_AUTOPILOT_CONFIG.perWave))),
      intervalMinutes: Math.max(
        1,
        Number(parsed.intervalMinutes ?? DEFAULT_AUTOPILOT_CONFIG.intervalMinutes)
      ),
      firstWaveNow:
        typeof parsed.firstWaveNow === "boolean" ? parsed.firstWaveNow : DEFAULT_AUTOPILOT_CONFIG.firstWaveNow,
      loopForever:
        typeof parsed.loopForever === "boolean" ? parsed.loopForever : DEFAULT_AUTOPILOT_CONFIG.loopForever,
      autoIdeas:
        typeof parsed.autoIdeas === "boolean" ? parsed.autoIdeas : DEFAULT_AUTOPILOT_CONFIG.autoIdeas,
    };
  } catch {
    return { ...DEFAULT_AUTOPILOT_CONFIG };
  }
}

export function saveAutopilotConfig(cfg: AutopilotConfig): void {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch {
    /* private mode — okay */
  }
}

/** Intervall-Schnellauswahl für das Panel. */
export const AUTOPILOT_INTERVALS: { id: number; label: string }[] = [
  { id: 15, label: "15 MIN" },
  { id: 30, label: "30 MIN" },
  { id: 60, label: "1 STD" },
  { id: 120, label: "2 STD" },
  { id: 180, label: "3 STD" },
  { id: 360, label: "6 STD" },
];

/** Anzahl-Auswahl für „Videos pro Sendung". */
export const AUTOPILOT_PER_WAVE: number[] = [1, 2, 3, 4, 5, 10];

/* ------------------------------------------------------------------ */
/*  Laufzustand (nicht persistiert — Videos liegen im Arbeitsspeicher)   */
/* ------------------------------------------------------------------ */

export type AutopilotStage =
  | "idle"
  | "ideas"      // Ideen werden geschrieben
  | "prepare"    // Skripte + Stimmen
  | "render"     // Videos rendern
  | "ship-wait"  // wartet auf die nächste Sendewelle (Countdown läuft)
  | "ship"       // Welle wird gerade versendet
  | "done"       // Zyklus versendet (bei loop: kurzes Zwischenstadium)
  | "error"
  | "stopped";

export interface AutopilotLogEntry {
  at: number;
  msg: string;
  kind: "info" | "ok" | "warn" | "err";
}

export interface AutopilotState {
  running: boolean;
  /** 1-basierter Zähler im Loop-Modus */
  cycle: number;
  stage: AutopilotStage;
  /** gerade laufende Sendewelle (1-basiert) */
  wave: number;
  /** Gesamtzahl der Wellen des aktuellen Zyklus */
  waves: number;
  /** Unit-Indizes der Welle, die als Nächstes/gerade dran ist */
  waveUnits: number[];
  /** Zeitpunkt (epoch ms) der nächsten Sendewelle — null = läuft gerade */
  nextWaveAt: number | null;
  /** schon an Zernio gesendete Videos im aktuellen Zyklus */
  sent: number;
  /** zu versendende Videos im aktuellen Zyklus */
  sendTotal: number;
  log: AutopilotLogEntry[];
  error: string | null;
  /** Blocker, die den Start verhindern (werden einmal beim Klick geprüft) */
  blockers: string[];
  startedAt: number | null;
}

export const IDLE_AUTOPILOT: AutopilotState = {
  running: false,
  cycle: 0,
  stage: "idle",
  wave: 0,
  waves: 0,
  waveUnits: [],
  nextWaveAt: null,
  sent: 0,
  sendTotal: 0,
  log: [],
  error: null,
  blockers: [],
  startedAt: null,
};

/** Hängt eine Zeile ans Protokoll (neueste oben, maximal 80). */
export function pushLog(
  state: AutopilotState,
  msg: string,
  kind: AutopilotLogEntry["kind"] = "info"
): AutopilotLogEntry[] {
  return [{ at: Date.now(), msg, kind }, ...state.log].slice(0, 80);
}

/**
 * Schneidet die Versand-Wellen: `indices` (in Reihenfolge) werden in
 * Häppchen von `perWave` aufgeteilt.
 */
export function planWaves(indices: number[], perWave: number): number[][] {
  const size = Math.max(1, Math.min(10, Math.round(perWave)));
  const waves: number[][] = [];
  for (let i = 0; i < indices.length; i += size) waves.push(indices.slice(i, i + size));
  return waves;
}

/** "41:32" — mm:ss bzw. h:mm:ss für den Countdown. */
export function formatWait(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}
